import type { Entity, Span } from './shield/types';
import { ENTITY_LABEL } from './shield/types';
import { entityForSpan } from './shield/mask';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Original text with every detection rendered as a toggleable highlight. */
export function highlightOriginal(text: string, spans: Span[], entities: Entity[]): string {
  let html = '';
  let cursor = 0;
  for (const s of spans) {
    const e = entityForSpan(s, entities);
    if (!e) continue;
    html += esc(text.slice(cursor, s.start));
    html += `<button type="button" class="hl hl-${e.type.toLowerCase()} ${e.masked ? 'is-masked' : 'is-open'}" data-key="${esc(e.key)}" title="${esc(
      `${ENTITY_LABEL[e.type]} · ${e.masked ? `sent as ${e.placeholder}` : 'will be sent as written'} · found by ${e.detector === 'nano' ? 'Gemini Nano' : 'local rules'} — click to toggle`,
    )}">${esc(text.slice(s.start, s.end))}<span class="hl-tag">${e.masked ? esc(e.placeholder) : 'visible'}</span></button>`;
    cursor = s.end;
  }
  return html + esc(text.slice(cursor));
}

/** Masked text with placeholders emphasised. */
export function highlightPlaceholders(text: string): string {
  return esc(text).replace(/\[([A-Z]+)_(\d+)\]/g, (_m, t: string, n: string) => `<span class="ph ph-${t.toLowerCase()}">[${t}_${n}]</span>`);
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/**
 * Tiny Markdown renderer for model answers (bullets, checklists, numbered lists,
 * headings, bold). `decorate` runs on escaped text, before inline formatting.
 */
export function renderMarkdown(md: string, decorate: (escaped: string) => string = (s) => s): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = decorate(esc(line));
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      close();
      continue;
    }
    if ((m = t.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/))) {
      if (list !== 'ul') {
        close();
        out.push('<ul class="md-check">');
        list = 'ul';
      }
      out.push(`<li><span class="box ${m[1].trim() ? 'done' : ''}"></span><span>${inline(m[2])}</span></li>`);
    } else if ((m = t.match(/^\s*[-*•]\s+(.*)$/))) {
      if (list !== 'ul') {
        close();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = t.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') {
        close();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = t.match(/^#{1,4}\s+(.*)$/))) {
      close();
      out.push(`<h4>${inline(m[1])}</h4>`);
    } else {
      close();
      out.push(`<p>${inline(t)}</p>`);
    }
  }
  close();
  return out.join('');
}

/** Rehydrate placeholders inside escaped HTML, marking restored values. */
export function restoreDecorator(entities: Entity[]) {
  const map = new Map(entities.map((e) => [e.placeholder.slice(1, -1), e]));
  return (escaped: string) =>
    escaped.replace(/\[([A-Z]+_\d+)\]/g, (m, k: string) => {
      const e = map.get(k);
      return e
        ? `<span class="restored" title="${esc(e.placeholder)} restored on your device">${esc(e.value)}</span>`
        : m;
    });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
