import { detectWithRules } from './rules';
import { detectWithNano } from './nano';
import { buildEntities, resolveSpans } from './mask';
import type { Entity, ShieldResult } from './types';

/** Detect identifiers locally: rules always, Gemini Nano when the device has it. */
export async function runShield(text: string, useNano: boolean, previous: Entity[] = []): Promise<ShieldResult> {
  const t0 = performance.now();
  const raw = detectWithRules(text);
  let nanoUsed = false;
  let nanoNote: string | undefined;
  if (useNano) {
    try {
      raw.push(...(await detectWithNano(text)));
      nanoUsed = true;
    } catch (e) {
      nanoNote = `Gemini Nano detection skipped: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const spans = resolveSpans(text, raw);
  const entities = buildEntities(spans, previous);
  return { original: text, spans, entities, nanoUsed, nanoNote, ms: performance.now() - t0 };
}
