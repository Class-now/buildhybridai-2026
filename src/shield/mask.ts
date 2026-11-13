import type { Entity, EntityType, Span } from './types';

const PRIORITY: Record<EntityType, number> = {
  EMAIL: 9, URL: 9, ACCOUNT: 8, ID: 8, DOB: 8, PHONE: 7, ADDRESS: 6, PERSON: 5, ORG: 5.5, OTHER: 3,
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Find every occurrence of a value as a whole word/phrase. */
function occurrences(text: string, value: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const pattern = escapeRe(value).replace(/ +/g, '\\s+');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of text.matchAll(re)) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return out;
}

/**
 * Turn raw detections into a clean, non-overlapping span list, expanding each
 * detected value to all of its occurrences (a name found once after "Dear" is
 * also masked everywhere else, including the surname on its own).
 */
export function resolveSpans(text: string, raw: Span[]): Span[] {
  const seeds = new Map<string, Span>();
  for (const s of raw) {
    const k = norm(s.text);
    if (k.length < 2) continue;
    const prev = seeds.get(k);
    if (!prev || PRIORITY[s.type] > PRIORITY[prev.type]) seeds.set(k, s);
  }
  // Surnames / first names of multi-word people names.
  for (const s of [...seeds.values()]) {
    if (s.type !== 'PERSON') continue;
    const parts = s.text.split(/\s+/).filter((p) => p.length >= 3 && !/\.$/.test(p));
    if (parts.length < 2) continue;
    for (const p of [parts[0], parts[parts.length - 1]]) {
      const k = norm(p);
      if (!seeds.has(k)) seeds.set(k, { ...s, text: p });
    }
  }

  const all: Span[] = [];
  for (const s of seeds.values()) {
    for (const [start, end] of occurrences(text, s.text)) {
      all.push({ ...s, start, end, text: text.slice(start, end) });
    }
  }
  // Longest / highest priority wins on overlap.
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || PRIORITY[b.type] - PRIORITY[a.type]);
  const out: Span[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      const longer = s.end - s.start > last.end - last.start;
      if (longer) out[out.length - 1] = s;
      continue;
    }
    out.push(s);
  }
  return out;
}

/** Assign stable placeholders ([PERSON_1], [ID_2] ...) to unique values. */
export function buildEntities(spans: Span[], previous: Entity[] = []): Entity[] {
  const prevMasked = new Map(previous.map((e) => [e.key, e.masked]));
  const byKey = new Map<string, Entity>();
  const counters: Partial<Record<EntityType, number>> = {};
  // Surname-only mentions share the full name's placeholder.
  const personFull = spans.filter((s) => s.type === 'PERSON' && /\s/.test(s.text.trim()));
  const aliasOf = (s: Span): string => {
    if (s.type === 'PERSON' && /\s/.test(s.text.trim())) {
      // "Maria E. Alvarez" and "Maria Elena Alvarez" are one person (same first and last name, compatible middle).
      const same = [...byKey.values()].find((e) => e.type === 'PERSON' && e.key !== norm(s.text) && samePerson(e.value, s.text));
      if (same) {
        same.aliases = [...new Set([...(same.aliases ?? []), norm(s.text)])];
        return same.key;
      }
      return norm(s.text);
    }
    if (s.type !== 'PERSON') return norm(s.text);
    const hit = personFull.find((p) => p.text.split(/\s+/).some((w) => norm(w) === norm(s.text)));
    return hit ? norm(hit.text) : norm(s.text);
  };
  const ordered = [...spans].sort((a, b) => {
    const af = /\s/.test(a.text.trim()) ? 0 : 1;
    const bf = /\s/.test(b.text.trim()) ? 0 : 1;
    return af - bf || a.start - b.start;
  });
  for (const s of ordered) {
    const key = aliasOf(s);
    const existing = byKey.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    counters[s.type] = (counters[s.type] ?? 0) + 1;
    byKey.set(key, {
      key,
      value: s.text,
      type: s.type,
      placeholder: `[${s.type}_${counters[s.type]}]`,
      detector: s.detector,
      masked: prevMasked.get(key) ?? true,
      count: 1,
    });
  }
  return [...byKey.values()].sort((a, b) => a.type.localeCompare(b.type) || a.placeholder.localeCompare(b.placeholder, undefined, { numeric: true }));
}

const nameWords = (s: string) => s.split(/\s+/).map((w) => norm(w).replace(/\.$/, '')).filter(Boolean);

/** Same first and last name, and every middle name matches or is its initial. */
export function samePerson(a: string, b: string): boolean {
  const x = nameWords(a);
  const y = nameWords(b);
  if (x.length < 2 || y.length < 2 || x[0] !== y[0] || x[x.length - 1] !== y[y.length - 1]) return false;
  const mx = x.slice(1, -1);
  const my = y.slice(1, -1);
  if (!mx.length || !my.length) return true;
  if (mx.length !== my.length) return false;
  return mx.every((w, i) => w === my[i] || (w.length === 1 && my[i].startsWith(w)) || (my[i].length === 1 && w.startsWith(my[i])));
}

export function entityForSpan(span: Span, entities: Entity[]): Entity | undefined {
  const k = norm(span.text);
  return (
    entities.find((e) => e.key === k) ??
    entities.find((e) => e.aliases?.includes(k)) ??
    entities.find((e) => e.type === 'PERSON' && e.value.split(/\s+/).some((w) => norm(w) === k))
  );
}

export function applyMask(text: string, spans: Span[], entities: Entity[]): string {
  let out = '';
  let cursor = 0;
  for (const s of spans) {
    const e = entityForSpan(s, entities);
    if (!e || !e.masked) continue;
    out += text.slice(cursor, s.start) + e.placeholder;
    cursor = s.end;
  }
  return out + text.slice(cursor);
}

/** Put the real values back into a model answer — only ever done locally. */
export function rehydrate(text: string, entities: Entity[]): string {
  const map = new Map(entities.map((e) => [e.placeholder.slice(1, -1), e.value]));
  return text.replace(/\[([A-Z]+_\d+)\]/g, (m, k: string) => map.get(k) ?? m);
}

export function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
