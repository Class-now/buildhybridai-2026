import { Schema } from 'firebase/ai';
import { InferenceMode, type DeviceState, type Mode } from './ai';

export type Policy = 'auto' | 'private' | 'cloud';

export type TaskId = 'summary' | 'actions' | 'explain' | 'reply' | 'ask';

export interface Task {
  id: TaskId;
  label: string;
  hint: string;
  weight: 'light' | 'heavy';
  instruction: (q?: string) => string;
}

export const TASKS: Task[] = [
  {
    id: 'summary',
    label: 'Summarize',
    hint: 'The gist in 30 seconds',
    weight: 'light',
    instruction: () =>
      'Summarize this document in 3 to 5 short bullet points that a stressed reader can understand in 30 seconds. Put the single most important point first.',
  },
  {
    id: 'actions',
    label: 'What do I need to do?',
    hint: 'Checklist with deadlines',
    weight: 'light',
    instruction: () =>
      'List what the reader needs to do as a checklist ("- [ ] ..."). For each item give the deadline if one is stated and who to contact. If something important is unclear, add an item saying what to ask.',
  },
  {
    id: 'explain',
    label: 'Explain the jargon',
    hint: 'Plain-language glossary',
    weight: 'heavy',
    instruction: () =>
      'Find the medical, legal, financial or bureaucratic terms in this document and explain each in one or two plain sentences (a short bulleted glossary). Then, in a short paragraph, explain what the document means for the reader overall.',
  },
  {
    id: 'reply',
    label: 'Draft a reply',
    hint: 'A polite, firm response',
    weight: 'heavy',
    instruction: () =>
      'Draft a polite, firm reply the reader could send in response to this document. Address the sender and sign with the reader using the same placeholders. Ask for anything that is missing or unclear. Keep it under 200 words.',
  },
  {
    id: 'ask',
    label: 'Ask a question',
    hint: 'Anything about the document',
    weight: 'light',
    instruction: (q) => `Answer the reader's question about this document. Question: ${q ?? ''}`,
  },
];

export const ASSISTANT_SYSTEM = `You help a person understand an official document they received (medical, legal, housing, financial, or government).
Personal identifiers may have been replaced by placeholders such as [PERSON_1], [ORG_1], [ID_2]. When you refer to them, copy the placeholder exactly; never guess or invent the real values.
Write plain, warm, concise English. Use short bullet points where it helps. Do not invent facts that are not in the document.
You are not a doctor or lawyer: when a decision has real consequences, say who the reader should confirm it with.`;

export const TRIAGE_SCHEMA = Schema.object({
  properties: {
    category: Schema.enumString({ enum: ['medical', 'housing', 'financial', 'legal', 'employment', 'government', 'insurance', 'other'] }),
    urgency: Schema.enumString({ enum: ['act-now', 'this-week', 'this-month', 'informational'] }),
    deadline: Schema.string(),
    headline: Schema.string(),
  },
});

export const TRIAGE_SYSTEM = `Classify the document. "deadline" is the earliest date or time limit the reader must act by, copied from the text, or "none". "headline" is one plain sentence (max 15 words) saying what the document is about. Keep placeholders like [PERSON_1] as they are.`;

export interface Route {
  mode: Mode;
  /** true: the raw document is used (only allowed with ONLY_ON_DEVICE) */
  raw: boolean;
  /** human explanation shown before running */
  why: string;
  /** where it will most likely run given the current device + network */
  expected: 'device' | 'cloud' | 'blocked';
  blockedReason?: string;
}

const TOKEN_BUDGET_CHARS = 20000; // ~5k tokens of document, leaves room in Nano's 9,216-token window

export function route(task: Task, policy: Policy, device: DeviceState, online: boolean, docChars: number): Route {
  const deviceReady = device === 'available';
  if (policy === 'private') {
    return {
      mode: InferenceMode.ONLY_ON_DEVICE,
      raw: true,
      why: 'Private mode: Gemini Nano reads the original text. Nothing leaves this device.',
      expected: deviceReady ? 'device' : 'blocked',
      blockedReason: deviceReady ? undefined : 'Private mode needs on-device AI, which is not ready in this browser.',
    };
  }
  if (policy === 'cloud') {
    return {
      mode: InferenceMode.ONLY_IN_CLOUD,
      raw: false,
      why: 'Cloud mode: only the masked text is sent to Gemini in the cloud.',
      expected: online ? 'cloud' : 'blocked',
      blockedReason: online ? undefined : 'You are offline. Cloud mode needs a connection.',
    };
  }
  // Auto: light tasks prefer the device, heavy or very long ones prefer the cloud.
  const tooLong = docChars > TOKEN_BUDGET_CHARS;
  if (task.weight === 'light' && !tooLong) {
    const expected = deviceReady ? 'device' : online ? 'cloud' : 'blocked';
    return {
      mode: InferenceMode.PREFER_ON_DEVICE,
      raw: false,
      why: deviceReady
        ? 'Light task: runs on Gemini Nano on this device. The masked text is used, so even a fallback to the cloud would not expose identifiers.'
        : 'Light task, but on-device AI is not ready here, so Firebase AI Logic falls back to the cloud with the masked text.',
      expected,
      blockedReason: expected === 'blocked' ? 'You are offline and this browser has no on-device model.' : undefined,
    };
  }
  const expected = online ? 'cloud' : deviceReady ? 'device' : 'blocked';
  return {
    mode: InferenceMode.PREFER_IN_CLOUD,
    raw: false,
    why: tooLong
      ? 'Long document: it exceeds the on-device context window, so the masked text goes to the cloud model.'
      : online
        ? 'Heavier task: the masked text goes to Gemini in the cloud for a better answer. If the network drops, it falls back to Gemini Nano.'
        : 'Offline: this cloud-preferred task falls back to Gemini Nano on your device.',
    expected,
    blockedReason: expected === 'blocked' ? 'You are offline and this browser has no on-device model.' : undefined,
  };
}

export function buildPrompt(task: Task, doc: string, question?: string): string {
  return `${task.instruction(question)}\n\n--- DOCUMENT ---\n${doc}\n--- END OF DOCUMENT ---`;
}
