import {
  AIError,
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  type GenerativeModel,
  type LanguageModelCreateOptions,
} from 'firebase/ai';
import { ai } from './firebase';

export { InferenceMode, InferenceSource };
export type Mode = (typeof InferenceMode)[keyof typeof InferenceMode];
export type Source = (typeof InferenceSource)[keyof typeof InferenceSource];

/* ------------------------------------------------------------------ */
/* Device capability                                                   */
/* ------------------------------------------------------------------ */

export type DeviceState = 'checking' | 'no-api' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

// Text-only, English. Asking only for what we use keeps availability() honest:
// the SDK default also asks for image input, which needs an extra Chrome flag.
const CREATE_BASE: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

interface PromptApi {
  availability(opts?: unknown): Promise<string>;
}
const promptApi = (): PromptApi | undefined => (globalThis as unknown as { LanguageModel?: PromptApi }).LanguageModel;

export async function checkDevice(): Promise<DeviceState> {
  const api = promptApi();
  if (!api) return 'no-api';
  try {
    const a = await api.availability(CREATE_BASE);
    if (a === 'available' || a === 'downloadable' || a === 'downloading') return a;
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Must be called from a user gesture. Resolves when the model is ready. */
export async function downloadDeviceModel(onProgress: (p: number) => void): Promise<void> {
  const m = model(InferenceMode.ONLY_ON_DEVICE, { system: 'You are ready.' });
  await m.initializeDeviceModel(onProgress);
  // initializeDeviceModel starts the download; wait until Chrome reports ready.
  for (let i = 0; i < 1800; i++) {
    const s = await checkDevice();
    if (s === 'available') return;
    if (s === 'unavailable' || s === 'no-api') throw new Error('This device cannot run Gemini Nano.');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/* ------------------------------------------------------------------ */
/* Model factory                                                       */
/* ------------------------------------------------------------------ */

interface ModelOpts {
  system: string;
  schema?: ReturnType<typeof Schema.object>;
  maxOutputTokens?: number;
}

const cache = new Map<string, GenerativeModel>();

export function model(mode: Mode, opts: ModelOpts): GenerativeModel {
  const key = JSON.stringify([mode, opts.system, !!opts.schema, opts.maxOutputTokens]);
  const hit = cache.get(key);
  if (hit) return hit;
  const m = getGenerativeModel(ai, {
    mode,
    inCloudParams: {
      // Default hybrid cloud model; listed explicitly so the README and the UI agree.
      model: 'gemini-3.5-flash-lite',
      systemInstruction: opts.system,
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: opts.maxOutputTokens ?? 1200,
        ...(opts.schema ? { responseMimeType: 'application/json', responseSchema: opts.schema } : {}),
      },
    },
    onDeviceParams: {
      createOptions: {
        ...CREATE_BASE,
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: opts.system }] }],
      },
      ...(opts.schema ? { promptOptions: { responseConstraint: opts.schema } } : {}),
    },
  });
  cache.set(key, m);
  return m;
}

/* ------------------------------------------------------------------ */
/* Running a prompt                                                    */
/* ------------------------------------------------------------------ */

export interface RunResult {
  text: string;
  source: Source;
  ms: number;
}

export async function runStream(
  m: GenerativeModel,
  prompt: string,
  onDelta: (text: string, source: Source | undefined) => void,
  signal?: AbortSignal,
): Promise<RunResult> {
  const t0 = performance.now();
  const res = await m.generateContentStream(prompt, { signal });
  let text = '';
  let source: Source | undefined;
  for await (const chunk of res.stream) {
    source = chunk.inferenceSource ?? source;
    try {
      text += chunk.text();
    } catch {
      /* blocked or empty chunk */
    }
    onDelta(text, source);
  }
  const final = await res.response;
  source = final.inferenceSource ?? source ?? InferenceSource.IN_CLOUD;
  return { text, source, ms: performance.now() - t0 };
}

export async function runOnce(m: GenerativeModel, prompt: string): Promise<RunResult> {
  const t0 = performance.now();
  const r = await m.generateContent(prompt);
  return { text: r.response.text(), source: r.response.inferenceSource ?? InferenceSource.IN_CLOUD, ms: performance.now() - t0 };
}

export function friendlyError(e: unknown, online: boolean): string {
  if (e instanceof AIError) {
    if (/app check/i.test(e.message)) {
      return 'The cloud model rejected this request because App Check could not verify the app. On-device features keep working; the cloud path needs App Check to be configured for this site.';
    }
    if (/quota|429|RESOURCE_EXHAUSTED/i.test(e.message)) {
      return 'The free cloud quota for this demo is used up for the moment. Please try again later, or use Private mode with Gemini Nano.';
    }
    switch (e.code) {
      case 'fetch-error':
        return online
          ? 'The cloud model could not be reached. Please try again in a moment.'
          : 'You are offline and this request needed the cloud. Your shield still works offline; try a private (on-device) task or reconnect.';
      case 'unsupported':
      case 'api-not-enabled':
        return 'On-device AI is not available in this browser, and this task was set to stay on your device. Switch the routing policy to Auto to use the masked cloud path.';
      case 'response-error':
        return 'The model declined or returned an empty answer. Try rephrasing your question.';
      default:
        return e.message.replace(/^AI: /, '');
    }
  }
  return e instanceof Error ? e.message : String(e);
}
