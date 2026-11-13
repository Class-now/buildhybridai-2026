import { Schema } from 'firebase/ai';
import { InferenceMode, type DeviceState, type Mode } from './ai';
import { DOC_MARK } from './cases';
import { routing } from './config';
import { answerInstruction, type Lang } from './lang';

export type Policy = 'auto' | 'private' | 'cloud';

export type TaskId = 'summary' | 'actions' | 'explain' | 'reply' | 'ask' | 'connect';

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
  {
    id: 'connect',
    label: 'Connect the case',
    hint: 'One timeline across documents',
    weight: 'heavy',
    instruction: () =>
      'Build one timeline of events, amounts and deadlines across all the documents, oldest first ("- **date** — event (Document k)"). Then list, under "Does not add up", every place where the documents disagree or something expected is missing (for example a charge the insurer did not mention, or a follow-up with no appointment). End with the single next step that matters most.',
  },
];

/** Tasks that only make sense when several documents are open together. */
export const CASE_ONLY: TaskId[] = ['connect'];

export const ASSISTANT_SYSTEM = `You help a person understand an official document they received (medical, legal, housing, financial, or government).
Personal identifiers may have been replaced by placeholders such as [PERSON_1], [ORG_1], [ID_2]. When you refer to them, copy the placeholder exactly; never guess or invent the real values.
Write plainly, warmly and concisely. Use short bullet points where it helps. Do not invent facts that are not in the document.
You are not a doctor or lawyer: when a decision has real consequences, say who the reader should confirm it with.`;

/** The assistant instruction with the answer language added (the document itself may be in English, Spanish or Japanese). */
export function assistantSystem(lang: Lang): string {
  return `${ASSISTANT_SYSTEM}\nThe document may be written in English, Spanish or Japanese. ${answerInstruction(lang)}`;
}

export const TRIAGE_SCHEMA = Schema.object({
  properties: {
    category: Schema.enumString({ enum: ['medical', 'housing', 'financial', 'legal', 'employment', 'government', 'insurance', 'other'] }),
    urgency: Schema.enumString({ enum: ['act-now', 'this-week', 'this-month', 'informational'] }),
    deadline: Schema.string(),
    headline: Schema.string(),
  },
});

export const TRIAGE_SYSTEM = `Classify the document. "deadline" is the earliest date or time limit the reader must act by, copied from the text, or "none". "headline" is one plain sentence (max 15 words) saying what the document is about. Keep placeholders like [PERSON_1] as they are.`;

export function triageSystem(lang: Lang): string {
  return lang === 'en' ? TRIAGE_SYSTEM : `${TRIAGE_SYSTEM} Write "headline" and "deadline" in the reader's language: ${answerInstruction(lang)}`;
}

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

/** Light or heavy, as set by the routing policy in Remote Config (falls back to the shipped default). */
export function weightOf(task: Task): Task['weight'] {
  return routing.cloudPreferred.has(task.id) ? 'heavy' : 'light';
}

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
    if (!routing.cloudEnabled) {
      return {
        mode: InferenceMode.ONLY_IN_CLOUD,
        raw: false,
        why: 'Cloud mode is paused by the operator (Remote Config).',
        expected: 'blocked',
        blockedReason: 'The cloud path is switched off right now. Use Auto or Private to run on this device.',
      };
    }
    return {
      mode: InferenceMode.ONLY_IN_CLOUD,
      raw: false,
      why: 'Cloud mode: only the masked text is sent to Gemini in the cloud.',
      expected: online ? 'cloud' : 'blocked',
      blockedReason: online ? undefined : 'You are offline. Cloud mode needs a connection.',
    };
  }
  if (!routing.cloudEnabled) {
    // Operator switch (Remote Config): keep every request on the device. Still masked text,
    // so nothing changes for the privacy invariant; only the cloud fallback is removed.
    return {
      mode: InferenceMode.ONLY_ON_DEVICE,
      raw: false,
      why: 'The cloud path is paused (Remote Config), so this runs on Gemini Nano only, with the masked text.',
      expected: deviceReady ? 'device' : 'blocked',
      blockedReason: deviceReady ? undefined : 'The cloud path is paused right now and this browser has no on-device model.',
    };
  }
  // Auto: light tasks prefer the device, heavy or very long ones prefer the cloud.
  // Both the task split and the length budget come from Remote Config (see config.ts).
  const tooLong = docChars > routing.deviceCharBudget;
  if (weightOf(task) === 'light' && !tooLong) {
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
  const m = doc.match(DOC_MARK);
  const caseNote = m
    ? `

The text below is a case folder of ${m[2]} related documents about the same matter, each starting with a "=== Document k of ${m[2]}: ... ===" header. The same placeholder means the same person or thing in every document. Use all of them and say which document a fact comes from (e.g. "Document 2").`
    : '';
  return `${task.instruction(question)}${caseNote}\n\n--- DOCUMENT ---\n${doc}\n--- END OF DOCUMENT ---`;
}
