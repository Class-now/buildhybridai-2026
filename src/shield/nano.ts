import { Schema } from 'firebase/ai';
import { InferenceMode, model, runOnce } from '../ai';
import type { EntityType, Span } from './types';

const TYPES: EntityType[] = ['PERSON', 'ORG', 'ADDRESS', 'EMAIL', 'PHONE', 'ID', 'ACCOUNT', 'DOB', 'OTHER'];

const schema = Schema.object({
  properties: {
    entities: Schema.array({
      items: Schema.object({
        properties: {
          text: Schema.string(),
          type: Schema.enumString({ enum: TYPES }),
        },
      }),
    }),
  },
});

const SYSTEM = `You are a privacy filter that runs entirely on the user's device.
Find every value in the document that could identify a specific person:
people's names, organizations tied to the person (clinics, hospitals, employers, landlords, banks, insurers, schools),
street addresses, phone numbers, email addresses, ID / account / policy / case / claim numbers, and dates of birth.
Copy each value exactly as it is written in the document.
Do not include generic dates, deadlines, money amounts, medical or legal terms, job titles, or common words.`;

const CHUNK = 2500;

function chunks(text: string): string[] {
  if (text.length <= CHUNK) return [text];
  const out: string[] = [];
  let buf = '';
  for (const para of text.split(/(\n\s*\n)/)) {
    if ((buf + para).length > CHUNK && buf) {
      out.push(buf);
      buf = '';
    }
    buf += para;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * Ask Gemini Nano for identifiers the regexes cannot see (names without a
 * title, clinic names, unusual ID formats). Mode is ONLY_ON_DEVICE on purpose:
 * this step reads the raw document, so it must never fall back to the cloud.
 */
export async function detectWithNano(text: string): Promise<Span[]> {
  const m = model(InferenceMode.ONLY_ON_DEVICE, { system: SYSTEM, schema });
  const spans: Span[] = [];
  for (const part of chunks(text)) {
    const r = await runOnce(m, `Document:\n"""\n${part}\n"""`);
    let parsed: { entities?: Array<{ text?: string; type?: string }> };
    try {
      parsed = JSON.parse(r.text);
    } catch {
      continue;
    }
    for (const e of parsed.entities ?? []) {
      const value = (e.text ?? '').trim();
      const type = (TYPES as string[]).includes(e.type ?? '') ? (e.type as EntityType) : 'OTHER';
      if (value.length < 2 || value.length > 120) continue;
      // Only trust values that literally appear in the text (no hallucinated PII).
      const idx = text.indexOf(value);
      if (idx < 0) continue;
      spans.push({ start: idx, end: idx + value.length, text: value, type, detector: 'nano' });
    }
  }
  return spans;
}
