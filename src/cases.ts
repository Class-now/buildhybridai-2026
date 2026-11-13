/**
 * Case folders: several related documents (a hospital discharge note, the bill
 * that followed, the insurer's letter…) kept together in this browser.
 *
 * Everything is stored in localStorage on this device only. Nothing here is
 * ever sent anywhere. When a whole case is opened, Veil shields the documents
 * together, so one person gets one placeholder across every document and the
 * cloud model can connect them without learning who they are.
 */

export interface CaseDoc {
  id: string;
  title: string;
  text: string;
  savedAt: number;
}

export interface CaseFolder {
  id: string;
  name: string;
  docs: CaseDoc[];
  /** Values the user chose to send as written (entity keys). */
  released: string[];
  updatedAt: number;
}

const KEY = 'veil.cases.v1';
const uid = () => Math.random().toString(36).slice(2, 10);

export function loadCases(): CaseFolder[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as CaseFolder[]) : [];
    return Array.isArray(list) ? list.filter((c) => c && Array.isArray(c.docs)) : [];
  } catch {
    return [];
  }
}

function save(list: CaseFolder[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function createCase(name: string): CaseFolder {
  const list = loadCases();
  const c: CaseFolder = { id: uid(), name: name.trim() || `Case ${list.length + 1}`, docs: [], released: [], updatedAt: Date.now() };
  save([...list, c]);
  return c;
}

export function deleteCase(id: string) {
  save(loadCases().filter((c) => c.id !== id));
}

function update(id: string, fn: (c: CaseFolder) => void): CaseFolder | undefined {
  const list = loadCases();
  const c = list.find((x) => x.id === id);
  if (!c) return undefined;
  fn(c);
  c.updatedAt = Date.now();
  save(list);
  return c;
}

/** Add a document, or replace the text of a document with the same text/title. */
export function addDoc(caseId: string, text: string, title?: string): CaseFolder | undefined {
  return update(caseId, (c) => {
    if (c.docs.some((d) => d.text.trim() === text.trim())) return;
    c.docs.push({ id: uid(), title: (title || guessTitle(text)).slice(0, 60), text, savedAt: Date.now() });
  });
}

export function removeDoc(caseId: string, docId: string): CaseFolder | undefined {
  return update(caseId, (c) => {
    c.docs = c.docs.filter((d) => d.id !== docId);
  });
}

export function setReleased(caseId: string, released: string[]) {
  update(caseId, (c) => {
    c.released = released;
  });
}

/** First meaningful line of a document, used as its title in the folder. */
export function guessTitle(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length >= 4 && !/^(dear|to|from|date)\b/i.test(l));
  return line ? line.replace(/\s+/g, ' ') : 'Untitled document';
}

export const DOC_MARK = /^=== Document (\d+) of (\d+): .* ===$/m;

/** All documents of a case as one text, each under a clear header the model can cite. */
export function joinCase(c: CaseFolder): string {
  const n = c.docs.length;
  return c.docs.map((d, i) => `=== Document ${i + 1} of ${n}: ${d.title} ===\n${d.text.trim()}`).join('\n\n');
}
