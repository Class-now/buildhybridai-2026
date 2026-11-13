import './style.css';
import {
  checkDevice,
  checkVision,
  downloadDeviceModel,
  friendlyError,
  InferenceMode,
  InferenceSource,
  model,
  runOnce,
  runStream,
  type DeviceState,
  type Mode,
  type Source,
} from './ai';
import { addDoc, createCase, deleteCase, joinCase, loadCases, removeDoc, setReleased, type CaseFolder } from './cases';
import { ASSISTANT_SYSTEM, buildPrompt, CASE_ONLY, route, TASKS, TRIAGE_SCHEMA, TRIAGE_SYSTEM, type Policy, type Task } from './router';
import { CASE_DEMO, SAMPLES } from './samples';
import { renderLetterImage } from './letter';
import { ACCEPTED_IMAGE, prepareImage, transcribe, type PreparedImage } from './scan';
import { applyMask, buildEntities, bytes } from './shield/mask';
import { runShield } from './shield/shield';
import { ENTITY_LABEL, type Entity, type ShieldResult } from './shield/types';
import { esc, fmtBytes, fmtMs, highlightOriginal, highlightPlaceholders, renderMarkdown, restoreDecorator } from './render';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

interface LedgerEntry {
  id: number;
  at: Date;
  stage: string;
  mode: Mode | 'local';
  source: Source | 'rules';
  ms: number;
  sentBytes: number; // bytes that left the device
  withheld: number; // identifiers kept on device
  leaked: number; // identifiers sent as written (user un-masked)
  ok: boolean;
  note?: string;
}

interface Answer {
  task: Task;
  question?: string;
  prompt: string; // exactly what the model received
  raw: boolean;
  text: string;
  source?: Source;
  mode: Mode;
  ms?: number;
  error?: string;
  running: boolean;
}

interface Triage {
  category: string;
  urgency: string;
  deadline: string;
  headline: string;
  source: Source;
}

const state = {
  device: 'checking' as DeviceState,
  downloadPct: null as number | null,
  online: navigator.onLine,
  policy: 'auto' as Policy,
  doc: '',
  shield: null as ShieldResult | null,
  shielding: false,
  view: 'original' as 'original' | 'outbound',
  triage: null as Triage | null,
  triageState: 'idle' as 'idle' | 'running' | 'error' | 'needs-consent',
  task: TASKS[0] as Task,
  question: '',
  answer: null as Answer | null,
  showSeen: false,
  ledger: [] as LedgerEntry[],
  cases: loadCases() as CaseFolder[],
  caseId: '' as string,
  /** Id of the case whose documents are open together in the editor. */
  caseOpen: '' as string,
  naming: false,
  scan: null as null | { previewUrl: string; text: string; part: number; parts: number; running: boolean; error?: string; ms?: number },
};

let ledgerSeq = 0;
let abort: AbortController | null = null;

/* ------------------------------------------------------------------ */
/* Skeleton                                                            */
/* ------------------------------------------------------------------ */

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="topbar">
  <div class="brand">
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 20c7 16 14 27 22 27s15-11 22-27" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M19 20c4 9 9 15 13 15s9-6 13-15" fill="none" stroke="var(--cloud)" stroke-width="4" stroke-linecap="round"/></svg>
    <div><strong>Veil</strong><span>Ask AI about private documents — without handing over who you are.</span></div>
  </div>
  <div class="pills">
    <button type="button" class="pill" id="pill-device" aria-live="polite"></button>
    <span class="pill" id="pill-net" aria-live="polite"></span>
  </div>
</header>

<main class="layout">
  <section class="col-main">
    <article class="card" id="card-doc">
      <header class="card-h"><span class="step">1</span><div><h2>Your document</h2><p>Paste a letter, discharge note, bill or notice. It stays on this device.</p></div></header>
      <div class="samples" role="group" aria-label="Sample documents">
        <span>Try a sample:</span>
        ${SAMPLES.map((s) => `<button type="button" class="chip" data-sample="${s.id}">${esc(s.label)}</button>`).join('')}
        <button type="button" class="chip" id="btn-case-sample">Case folder: discharge + bill + insurer</button>
      </div>
      <div class="scan-row">
        <label class="btn" id="btn-scan">Scan a paper letter<input type="file" id="scan-file" accept="image/*" capture="environment" hidden /></label>
        <button type="button" class="chip" id="btn-scan-sample">Try a scanned letter</button>
        <span class="muted small">Photos are read by Gemini Nano on this device. Image bytes never go to the cloud.</span>
      </div>
      <div id="scan" hidden></div>
      <div class="case" id="case" aria-label="Case folder"></div>
      <textarea id="doc" spellcheck="false" placeholder="Paste the text of a document here…"></textarea>
      <div class="card-f">
        <span class="muted" id="doc-meta">0 characters</span>
        <button type="button" class="btn primary" id="btn-shield">Shield it on my device</button>
      </div>
    </article>

    <article class="card" id="card-review" hidden>
      <header class="card-h"><span class="step">2</span><div><h2>Review what could leave your device</h2><p>Highlighted values are replaced with placeholders before anything is sent. Click one to keep or release it.</p></div></header>
      <div class="stats" id="stats"></div>
      <div id="triage"></div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-view="original">Your text</button>
        <button type="button" role="tab" data-view="outbound">What the cloud would see</button>
      </div>
      <pre class="doc-view" id="doc-view"></pre>
      <div class="entities" id="entities"></div>
    </article>

    <article class="card" id="card-ask" hidden>
      <header class="card-h"><span class="step">3</span><div><h2>Ask</h2><p>Veil picks where each request runs. You can see — and override — the route.</p></div></header>
      <div class="policy" role="radiogroup" aria-label="Routing policy" id="policy">
        <button type="button" role="radio" data-policy="auto"><b>Auto</b><span>Light tasks on device, heavy tasks in the cloud — always masked</span></button>
        <button type="button" role="radio" data-policy="private"><b>Private</b><span>Gemini Nano only. Nothing leaves this device</span></button>
        <button type="button" role="radio" data-policy="cloud"><b>Cloud</b><span>Best quality. Masked text only</span></button>
      </div>
      <div class="tasks" id="tasks">
        ${TASKS.map((t) => `<button type="button" class="task" data-task="${t.id}"><b>${esc(t.label)}</b><span>${esc(t.hint)}</span><em class="w-${t.weight}">${t.weight}</em></button>`).join('')}
      </div>
      <input type="text" id="question" placeholder="e.g. Can I still take ibuprofen with these medicines?" hidden />
      <div class="route" id="route"></div>
      <div class="card-f">
        <span class="muted" id="ask-note"></span>
        <div class="row">
          <button type="button" class="btn ghost" id="btn-stop" hidden>Stop</button>
          <button type="button" class="btn primary" id="btn-run">Run</button>
        </div>
      </div>
    </article>

    <article class="card answer" id="card-answer" hidden aria-live="polite"></article>
  </section>

  <aside class="col-side">
    <article class="card" id="card-receipt">
      <header class="card-h compact"><div><h2>Privacy receipt</h2><p>Every inference this session, and where it ran.</p></div></header>
      <div class="totals" id="totals"></div>
      <ol class="ledger" id="ledger"></ol>
    </article>
    <article class="card" id="card-device"></article>
  </aside>
</main>

<section class="how" id="how">
  <h2>How Veil uses hybrid inference</h2>
  <div class="flow">
    <div class="node device"><b>1 · Detect</b><span>Rules + Gemini Nano find names, IDs, addresses</span><code>ONLY_ON_DEVICE</code></div>
    <div class="arrow">→</div>
    <div class="node device"><b>2 · Mask</b><span>Values become [PERSON_1], [ID_1]… The map never leaves memory</span><code>local</code></div>
    <div class="arrow">→</div>
    <div class="node split"><b>3 · Route</b><span>Light → device first<br/>Heavy → cloud first<br/>Private → device only</span><code>PREFER_ON_DEVICE · PREFER_IN_CLOUD · ONLY_*</code></div>
    <div class="arrow">→</div>
    <div class="node device"><b>4 · Restore</b><span>Placeholders are swapped back for the real values on your screen</span><code>local</code></div>
  </div>
  <p class="muted">Raw text only ever goes to a model in <code>ONLY_ON_DEVICE</code> mode. Anything sent with a hybrid mode is masked first, so it is safe whichever way Firebase AI Logic routes it. Built with Firebase AI Logic (Gemini Developer API) and Chrome's built-in Gemini Nano.</p>
</section>
<footer class="foot">Veil is a demo for #BuildHybridAI. Not medical, legal or financial advice. <a href="https://github.com/Class-now/buildhybridai-2026" target="_blank" rel="noopener">Source on GitHub</a></footer>
`;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const docEl = $<HTMLTextAreaElement>('#doc');
const questionEl = $<HTMLInputElement>('#question');

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const DEVICE_TEXT: Record<DeviceState, [string, string]> = {
  checking: ['Checking on-device AI…', 'neutral'],
  'no-api': ['On-device AI: not in this browser', 'warn'],
  unavailable: ['On-device AI: unavailable', 'warn'],
  downloadable: ['On-device AI: download needed', 'info'],
  downloading: ['On-device AI: downloading…', 'info'],
  available: ['Gemini Nano ready', 'ok'],
};

function renderStatus() {
  const [label, tone] = DEVICE_TEXT[state.device];
  const pd = $('#pill-device');
  pd.className = `pill tone-${tone}`;
  pd.innerHTML = `<i></i>${esc(state.downloadPct != null && state.device !== 'available' ? `Downloading Gemini Nano ${state.downloadPct}%` : label)}`;
  const pn = $('#pill-net');
  pn.className = `pill tone-${state.online ? 'ok' : 'warn'}`;
  pn.innerHTML = `<i></i>${state.online ? 'Online' : 'Offline'}`;
  renderDeviceCard();
}

function renderDeviceCard() {
  const el = $('#card-device');
  const s = state.device;
  let body = '';
  if (s === 'available') {
    body = `<p><b>Gemini Nano is ready.</b> Detection, private mode and light tasks run on this device, offline too.</p>`;
  } else if (s === 'downloadable' || s === 'downloading') {
    const pct = state.downloadPct;
    body = `<p>This browser supports Gemini Nano, but the model is not on this device yet (a one-time download managed by Chrome).</p>
      ${pct != null ? `<div class="bar"><span style="width:${pct}%"></span></div><p class="muted">${pct}% — you can keep using Veil; requests use the masked cloud path until it finishes.</p>` : `<button type="button" class="btn" id="btn-download">Download Gemini Nano</button>`}`;
  } else if (s === 'checking') {
    body = `<p class="muted">Checking…</p>`;
  } else {
    body = `<p><b>No on-device model here</b>, so Veil uses its rule-based shield and the masked cloud path. Identifiers are still detected and removed locally.</p>
      <details><summary>Enable Gemini Nano</summary><ol class="small">
        <li>Use Chrome 139+ on desktop (Windows, macOS, Linux or ChromeOS) with ~22&nbsp;GB free disk.</li>
        <li>Open <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code> (and <code>#prompt-api-for-gemini-nano</code> if listed) and set it to <b>Enabled</b>.</li>
        <li>Restart Chrome and reload this page, then press “Download Gemini Nano”.</li>
      </ol></details>`;
  }
  el.innerHTML = `<header class="card-h compact"><div><h2>This device</h2></div></header>${body}`;
  el.querySelector('#btn-download')?.addEventListener('click', onDownload);
}

function maskedDoc(): string {
  return state.shield ? applyMask(state.shield.original, state.shield.spans, state.shield.entities) : state.doc;
}

function renderReview() {
  const card = $('#card-review');
  const sh = state.shield;
  card.hidden = !sh;
  $('#card-ask').hidden = !sh;
  if (!sh) return;
  const masked = sh.entities.filter((e) => e.masked);
  const open = sh.entities.filter((e) => !e.masked);
  const out = maskedDoc();
  $('#stats').innerHTML = `
    <div><b>${sh.entities.length}</b><span>identifiers found</span></div>
    <div><b>${masked.length}</b><span>will be masked</span></div>
    <div class="${open.length ? 'warn' : ''}"><b>${open.length}</b><span>released by you</span></div>
    <div><b>${sh.nanoUsed ? 'Nano + rules' : 'Rules'}</b><span>${state.shielding ? '<span class="spinner"></span> Gemini Nano still reading…' : `detector · ${fmtMs(sh.ms)} · on device`}</span></div>`;
  card.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
  $('#doc-view').innerHTML =
    state.view === 'original' ? highlightOriginal(sh.original, sh.spans, sh.entities) : highlightPlaceholders(out);
  $('#doc-view').classList.toggle('outbound', state.view === 'outbound');

  const groups = new Map<string, Entity[]>();
  for (const e of sh.entities) groups.set(e.type, [...(groups.get(e.type) ?? []), e]);
  $('#entities').innerHTML = sh.entities.length
    ? [...groups.entries()]
        .map(
          ([type, list]) => `<div class="eg"><span class="eg-h">${esc(ENTITY_LABEL[list[0].type])}</span>${list
            .map(
              (e) => `<button type="button" class="ent ${e.masked ? 'is-masked' : 'is-open'} t-${type.toLowerCase()}" data-key="${esc(e.key)}" aria-pressed="${e.masked}">
                <span class="ent-v">${esc(e.value)}</span><span class="ent-p">${e.masked ? esc(e.placeholder) : 'sent as written'}</span>${e.detector === 'nano' ? '<span class="nano" title="Found by Gemini Nano">AI</span>' : ''}</button>`,
            )
            .join('')}</div>`,
        )
        .join('')
    : `<p class="muted">No identifiers detected. Check the text yourself before using the cloud.</p>`;
  if (sh.nanoNote) $('#entities').insertAdjacentHTML('beforeend', `<p class="muted small">${esc(sh.nanoNote)}</p>`);
  renderTriage();
}

const URGENCY: Record<string, string> = {
  'act-now': 'Act now',
  'this-week': 'This week',
  'this-month': 'This month',
  informational: 'For information',
};

function renderTriage() {
  const el = $('#triage');
  const t = state.triage;
  if (state.triageState === 'running') {
    el.innerHTML = `<div class="triage loading"><span class="spinner"></span> Triage on device…</div>`;
  } else if (t) {
    const restore = restoreDecorator(state.shield?.entities ?? []);
    el.innerHTML = `<div class="triage u-${esc(t.urgency)}">
      <span class="tag">${esc(t.category)}</span><span class="tag urg">${esc(URGENCY[t.urgency] ?? t.urgency)}</span>
      ${t.deadline && t.deadline.toLowerCase() !== 'none' ? `<span class="tag dl">Deadline: ${restore(esc(t.deadline))}</span>` : ''}
      <p>${restore(esc(t.headline))}</p>${sourceBadge(t.source, 'small')}</div>`;
  } else if (state.triageState === 'needs-consent') {
    el.innerHTML = `<div class="triage muted-box"><p>Quick triage runs automatically only on your device. ${state.online ? '' : 'You are offline.'}</p>
      ${state.online ? `<button type="button" class="btn small" id="btn-triage-cloud">Triage in the cloud (masked text)</button>` : ''}</div>`;
    el.querySelector('#btn-triage-cloud')?.addEventListener('click', () => void runTriage(true));
  } else if (state.triageState === 'error') {
    el.innerHTML = `<div class="triage muted-box"><p>Triage unavailable right now.</p></div>`;
  } else el.innerHTML = '';
}

function sourceBadge(source: Source | undefined, size = ''): string {
  if (!source) return '';
  return source === InferenceSource.ON_DEVICE
    ? `<span class="src dev ${size}"><i></i>Ran on device · Gemini Nano</span>`
    : `<span class="src cld ${size}"><i></i>Ran in cloud · Gemini · masked</span>`;
}

const MODE_LABEL: Record<string, string> = {
  [InferenceMode.ONLY_ON_DEVICE]: 'ONLY_ON_DEVICE',
  [InferenceMode.PREFER_ON_DEVICE]: 'PREFER_ON_DEVICE',
  [InferenceMode.PREFER_IN_CLOUD]: 'PREFER_IN_CLOUD',
  [InferenceMode.ONLY_IN_CLOUD]: 'ONLY_IN_CLOUD',
  local: 'local rules',
};

function currentRoute() {
  return route(state.task, state.policy, state.device, state.online, state.doc.length);
}

function renderAsk() {
  document.querySelectorAll<HTMLButtonElement>('[data-policy]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.policy === state.policy)));
  document.querySelectorAll<HTMLButtonElement>('[data-task]').forEach((b) => b.classList.toggle('active', b.dataset.task === state.task.id));
  const multi = !!state.caseOpen;
  document.querySelectorAll<HTMLButtonElement>('[data-task]').forEach((b) => (b.hidden = !multi && CASE_ONLY.includes(b.dataset.task as Task['id'])));
  if (!multi && CASE_ONLY.includes(state.task.id)) state.task = TASKS[0];
  questionEl.hidden = state.task.id !== 'ask';
  const r = currentRoute();
  const dest =
    r.expected === 'device'
      ? `<span class="dot dev"></span>Expected: on this device`
      : r.expected === 'cloud'
        ? `<span class="dot cld"></span>Expected: Gemini in the cloud`
        : `<span class="dot off"></span>Can't run right now`;
  const sent = r.raw ? 'original text (stays local)' : `masked text · ${fmtBytes(bytes(maskedDoc()))}`;
  $('#route').innerHTML = `<div class="route-top">${dest}<code>${MODE_LABEL[r.mode]}</code><span class="muted">${esc(sent)}</span></div><p>${esc(r.blockedReason ?? r.why)}</p>`;
  $('#route').className = `route ${r.expected}`;
  const running = !!state.answer?.running;
  const btn = $<HTMLButtonElement>('#btn-run');
  btn.disabled = running || state.shielding || r.expected === 'blocked' || (state.task.id === 'ask' && !state.question.trim());
  btn.textContent = running ? 'Working…' : r.expected === 'cloud' ? 'Send masked text' : 'Run';
  $('#btn-stop').hidden = !running;
  const leaks = state.shield?.entities.filter((e) => !e.masked).length ?? 0;
  $('#ask-note').innerHTML = !r.raw && leaks ? `<span class="warn-t">${leaks} identifier${leaks > 1 ? 's' : ''} released — will be sent as written.</span>` : '';
}

function renderAnswer() {
  const card = $('#card-answer');
  const a = state.answer;
  card.hidden = !a;
  if (!a) return;
  const entities = state.shield?.entities ?? [];
  const body = a.error
    ? `<div class="error">${esc(a.error)}</div>`
    : a.text
      ? state.showSeen
        ? `<div class="md seen">${renderMarkdown(a.text, (s) => s.replace(/\[([A-Z]+)_(\d+)\]/g, '<span class="ph">[$1_$2]</span>'))}</div>`
        : `<div class="md">${renderMarkdown(a.text, a.raw ? undefined : restoreDecorator(entities))}</div>`
      : `<div class="md"><p class="muted"><span class="spinner"></span> ${a.mode === InferenceMode.ONLY_ON_DEVICE || currentRoute().expected === 'device' ? 'Thinking on your device…' : 'Waiting for the cloud…'}</p></div>`;
  card.innerHTML = `
    <header class="ans-h">
      <div><h2>${esc(a.task.label)}</h2>${a.question ? `<p class="muted">“${esc(a.question)}”</p>` : ''}</div>
      <div class="ans-meta">${sourceBadge(a.source)}<code>${MODE_LABEL[a.mode]}</code>${a.ms ? `<span class="muted">${fmtMs(a.ms)}</span>` : ''}</div>
    </header>
    ${body}
    ${a.text && !a.raw ? `<div class="ans-f"><label class="switch"><input type="checkbox" id="seen" ${state.showSeen ? 'checked' : ''}/> Show exactly what the model saw and wrote</label><span class="muted small">Highlighted values were restored on your device.</span></div>` : ''}
    ${a.text && !a.running ? `<div class="ans-f"><button type="button" class="btn small ghost" id="btn-copy">Copy answer</button></div>` : ''}
    ${state.showSeen && !a.raw ? `<details class="prompt"><summary>Full prompt that was sent</summary><pre>${highlightPlaceholders(a.prompt)}</pre></details>` : ''}`;
  card.querySelector('#seen')?.addEventListener('change', (e) => {
    state.showSeen = (e.target as HTMLInputElement).checked;
    renderAnswer();
  });
  card.querySelector('#btn-copy')?.addEventListener('click', async () => {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderMarkdown(a.text, a.raw ? undefined : restoreDecorator(entities));
    await navigator.clipboard.writeText(tmp.innerText);
    (card.querySelector('#btn-copy') as HTMLButtonElement).textContent = 'Copied';
  });
}

function renderLedger() {
  const L = state.ledger;
  const sent = L.reduce((n, e) => n + e.sentBytes, 0);
  const local = L.filter((e) => e.source !== InferenceSource.IN_CLOUD).length;
  const cloud = L.filter((e) => e.source === InferenceSource.IN_CLOUD).length;
  const leaked = L.reduce((n, e) => n + e.leaked, 0);
  $('#totals').innerHTML = `
    <div><b>${local}</b><span>on device</span></div>
    <div><b>${cloud}</b><span>in cloud</span></div>
    <div><b>${fmtBytes(sent)}</b><span>sent, all masked</span></div>
    <div class="${leaked ? 'warn' : 'good'}"><b>${leaked}</b><span>identifiers sent</span></div>`;
  $('#ledger').innerHTML = L.length
    ? [...L]
        .reverse()
        .map(
          (e) => `<li class="${e.ok ? '' : 'fail'}">
            <span class="dot ${e.source === InferenceSource.IN_CLOUD ? 'cld' : 'dev'}"></span>
            <div><b>${esc(e.stage)}</b><span>${e.source === InferenceSource.IN_CLOUD ? 'Cloud' : e.source === 'rules' ? 'Local rules' : 'On device'} · <code>${MODE_LABEL[e.mode]}</code> · ${fmtMs(e.ms)}</span>
            <span>${e.sentBytes ? `${fmtBytes(e.sentBytes)} masked text sent` : 'nothing sent'} · ${e.withheld} kept local${e.leaked ? ` · <em class="warn-t">${e.leaked} released</em>` : ''}</span>
            ${e.note ? `<span class="muted">${esc(e.note)}</span>` : ''}</div>
            <time>${e.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></li>`,
        )
        .join('')
    : `<li class="empty">Nothing has run yet.</li>`;
}

function log(e: Omit<LedgerEntry, 'id' | 'at'>) {
  state.ledger.push({ ...e, id: ++ledgerSeq, at: new Date() });
  renderLedger();
}

function renderScan() {
  const el = $('#scan');
  const sc = state.scan;
  el.hidden = !sc;
  if (!sc) return;
  const head = sc.running
    ? `Reading the photo on device${sc.parts > 1 ? ` — part ${sc.part} of ${sc.parts}` : ''}…`
    : sc.error
      ? 'Could not read the photo'
      : `Read on device in ${fmtMs(sc.ms ?? 0)} — check the text below, then shield it.`;
  el.className = `scan ${sc.error ? 'fail' : ''}`;
  el.innerHTML = `<img src="${sc.previewUrl}" alt="Photo of the letter" />
    <div><b>${esc(head)}</b>${sc.error ? `<p>${esc(sc.error)}</p>` : sc.running ? `<pre>${esc(sc.text.slice(-600))}</pre>` : ''}
    <p class="muted small"><code>ONLY_ON_DEVICE</code> · the image model has no cloud fallback.</p></div>`;
}

function currentCase(): CaseFolder | undefined {
  return state.cases.find((c) => c.id === state.caseId);
}

function renderCase() {
  const el = $('#case');
  const c = currentCase();
  const options = state.cases.map((x) => `<option value="${esc(x.id)}" ${x.id === state.caseId ? 'selected' : ''}>${esc(x.name)} (${x.docs.length})</option>`).join('');
  const head = state.naming
    ? `<input type="text" id="case-name" placeholder="Name the case, e.g. Dad’s hospital stay" maxlength="40" />
       <button type="button" class="btn small" id="case-create">Create</button>
       <button type="button" class="btn small ghost" id="case-cancel">Cancel</button>`
    : `<label for="case-select">Case folder</label>
       <select id="case-select"><option value="">None</option>${options}<option value="__new">+ New case…</option></select>`;
  const inCase = c?.docs.some((d) => d.text.trim() === state.doc.trim());
  const body = c
    ? `<div class="case-docs">${
        c.docs.length
          ? c.docs
              .map(
                (d, i) => `<span class="case-doc"><button type="button" class="chip" data-open-doc="${esc(d.id)}" title="Open this document alone">${i + 1}. ${esc(d.title)}</button><button type="button" class="x" data-remove-doc="${esc(d.id)}" aria-label="Remove ${esc(d.title)} from the case">×</button></span>`,
              )
              .join('')
          : '<span class="muted small">Empty. Paste, pick or scan a document, then save it here.</span>'
      }</div>
      <div class="case-actions">
        <button type="button" class="btn small" id="case-save" ${!state.doc.trim() || inCase || state.caseOpen ? 'disabled' : ''}>${inCase ? 'Saved in this case' : 'Save this document to the case'}</button>
        <button type="button" class="btn small primary" id="case-open" ${c.docs.length < 2 ? 'disabled' : ''}>Open the whole case${c.docs.length ? ` (${c.docs.length})` : ''}</button>
        <button type="button" class="btn small ghost" id="case-delete">Delete case</button>
      </div>`
    : '';
  el.innerHTML = `<div class="case-h">${head}<span class="muted small">Kept in this browser only. Opening a whole case masks every document together — one placeholder per person across all of them.</span></div>${body}`;
  el.classList.toggle('active', !!c);
}

function renderAll() {
  renderScan();
  renderStatus();
  renderReview();
  renderAsk();
  renderAnswer();
  renderLedger();
  renderCase();
  $('#doc-meta').textContent = `${state.doc.length.toLocaleString()} characters${state.caseOpen ? ` · whole case “${state.cases.find((c) => c.id === state.caseOpen)?.name ?? ''}”` : ''}`;
  $<HTMLButtonElement>('#btn-shield').disabled = state.shielding || !state.doc.trim();
  $<HTMLButtonElement>('#btn-shield').textContent = state.shielding ? 'Shielding on device…' : state.shield ? 'Re-scan' : 'Shield it on my device';
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function refreshDevice() {
  state.device = await checkDevice();
  renderStatus();
  renderAsk();
}

async function onDownload() {
  state.downloadPct = 0;
  state.device = 'downloading';
  renderStatus();
  try {
    await downloadDeviceModel((p) => {
      state.downloadPct = Math.round(p * 100);
      renderStatus();
    });
  } catch (e) {
    alert(friendlyError(e, state.online));
  }
  state.downloadPct = null;
  await refreshDevice();
}

async function onShield() {
  if (!state.doc.trim()) return;
  state.shielding = true;
  state.answer = null;
  state.triage = null;
  renderAll();
  const useNano = state.device === 'available';
  const t0 = performance.now();
  const c = state.caseOpen ? state.cases.find((x) => x.id === state.caseOpen) : undefined;
  const previous = state.shield?.entities ?? (c ? c.released.map((key) => ({ key, masked: false }) as Entity) : []);
  let res = await runShield(state.doc, false, previous);
  if (useNano) {
    // Show the instant rule-based result while Nano reads; sending stays locked until it finishes.
    state.shield = res;
    renderAll();
    document.querySelector('#card-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    res = await runShield(state.doc, true, res.entities);
    res.ms = performance.now() - t0;
  }
  state.shield = res;
  state.shielding = false;
  log({
    stage: 'Shield · detect identifiers',
    mode: res.nanoUsed ? InferenceMode.ONLY_ON_DEVICE : 'local',
    source: res.nanoUsed ? InferenceSource.ON_DEVICE : 'rules',
    ms: res.ms,
    sentBytes: 0,
    withheld: res.entities.length,
    leaked: 0,
    ok: true,
    note: res.nanoNote,
  });
  renderAll();
  document.querySelector('#card-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  void runTriage(false);
}

/** Triage with structured output. Auto-runs only on device; the cloud needs a click. */
async function runTriage(cloudConsent: boolean) {
  if (!state.shield) return;
  if (!cloudConsent && state.device !== 'available') {
    state.triageState = 'needs-consent';
    renderTriage();
    return;
  }
  state.triageState = 'running';
  renderTriage();
  const mode = cloudConsent ? InferenceMode.ONLY_IN_CLOUD : InferenceMode.PREFER_ON_DEVICE;
  const text = maskedDoc();
  const m = model(mode, { system: TRIAGE_SYSTEM, schema: TRIAGE_SCHEMA, maxOutputTokens: 300 });
  const counts = maskCounts();
  try {
    const r = await runOnce(m, `--- DOCUMENT ---\n${text}\n--- END ---`);
    const j = JSON.parse(r.text) as Omit<Triage, 'source'>;
    state.triage = { ...j, source: r.source };
    state.triageState = 'idle';
    log({ stage: 'Triage · structured output', mode, source: r.source, ms: r.ms, sentBytes: r.source === InferenceSource.IN_CLOUD ? bytes(text) : 0, ...counts, ok: true });
  } catch (e) {
    state.triageState = 'error';
    log({ stage: 'Triage', mode, source: cloudConsent ? InferenceSource.IN_CLOUD : InferenceSource.ON_DEVICE, ms: 0, sentBytes: 0, ...counts, ok: false, note: friendlyError(e, state.online) });
  }
  renderTriage();
}

function maskCounts() {
  const es = state.shield?.entities ?? [];
  return { withheld: es.filter((e) => e.masked).length, leaked: es.filter((e) => !e.masked).length };
}

async function onRun() {
  if (!state.shield) return;
  const r = currentRoute();
  if (r.expected === 'blocked') return;
  const text = r.raw ? state.shield.original : maskedDoc();
  const prompt = buildPrompt(state.task, text, state.question);
  const m = model(r.mode, { system: ASSISTANT_SYSTEM });
  abort = new AbortController();
  state.showSeen = false;
  state.answer = { task: state.task, question: state.task.id === 'ask' ? state.question : undefined, prompt, raw: r.raw, text: '', mode: r.mode, running: true };
  renderAnswer();
  renderAsk();
  document.querySelector('#card-answer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const a = state.answer;
  const counts = r.raw ? { withheld: state.shield.entities.length, leaked: 0 } : maskCounts();
  try {
    const res = await runStream(
      m,
      prompt,
      (t, src) => {
        a.text = t;
        a.source = src;
        renderAnswer();
      },
      abort.signal,
    );
    a.text = res.text;
    a.source = res.source;
    a.ms = res.ms;
    log({
      stage: state.task.label,
      mode: r.mode,
      source: res.source,
      ms: res.ms,
      sentBytes: res.source === InferenceSource.IN_CLOUD ? bytes(prompt) : 0,
      ...counts,
      ok: true,
      note: fallbackNote(r.mode, res.source),
    });
  } catch (e) {
    const aborted = abort?.signal.aborted;
    a.error = aborted ? 'Stopped.' : friendlyError(e, state.online);
    log({ stage: state.task.label, mode: r.mode, source: r.expected === 'cloud' ? InferenceSource.IN_CLOUD : InferenceSource.ON_DEVICE, ms: 0, sentBytes: 0, ...counts, ok: false, note: a.error });
  }
  a.running = false;
  abort = null;
  renderAnswer();
  renderAsk();
}

function fallbackNote(mode: Mode, source: Source): string | undefined {
  if (mode === InferenceMode.PREFER_ON_DEVICE && source === InferenceSource.IN_CLOUD) return 'Fell back to cloud: no on-device model';
  if (mode === InferenceMode.PREFER_IN_CLOUD && source === InferenceSource.ON_DEVICE) return 'Fell back to device: cloud unreachable';
  return undefined;
}

function resetDoc(text: string, caseOpen = '') {
  state.caseOpen = caseOpen;
  docEl.value = text;
  state.doc = text;
  state.shield = null;
  state.answer = null;
  state.triage = null;
  state.triageState = 'idle';
}

async function onScan(file: Blob) {
  if (state.scan?.running) return;
  if (state.scan) URL.revokeObjectURL(state.scan.previewUrl);
  let img: PreparedImage;
  try {
    img = await prepareImage(file);
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
    return;
  }
  state.scan = { previewUrl: img.previewUrl, text: '', part: 1, parts: img.tiles.length, running: true };
  renderAll();
  const vision = await checkVision();
  if (vision !== 'available') {
    state.scan.running = false;
    state.scan.error =
      vision === 'downloadable' || vision === 'downloading'
        ? 'Gemini Nano needs to finish downloading before it can read photos. Veil will not send the photo to the cloud instead.'
        : 'Reading photos needs Gemini Nano with image input (Chrome 139+ with the multimodal Prompt API enabled). Veil will not send the photo to the cloud instead — paste the text, or try on a device with Gemini Nano.';
    log({ stage: 'Scan · read photo', mode: InferenceMode.ONLY_ON_DEVICE, source: InferenceSource.ON_DEVICE, ms: 0, sentBytes: 0, withheld: 0, leaked: 0, ok: false, note: 'Image input unavailable — photo stayed on device, nothing sent.' });
    renderAll();
    return;
  }
  abort = new AbortController();
  try {
    const r = await transcribe(
      img,
      (text, part, parts) => {
        if (!state.scan) return;
        Object.assign(state.scan, { text, part, parts });
        renderScan();
      },
      abort.signal,
    );
    resetDoc(r.text);
    Object.assign(state.scan, { running: false, ms: r.ms, text: r.text });
    log({ stage: 'Scan · read photo', mode: InferenceMode.ONLY_ON_DEVICE, source: InferenceSource.ON_DEVICE, ms: r.ms, sentBytes: 0, withheld: 0, leaked: 0, ok: true, note: `${fmtBytes(img.bytes)} photo, ${r.tiles} part(s), ${r.text.length.toLocaleString()} characters read.` });
  } catch (e) {
    Object.assign(state.scan, { running: false, error: friendlyError(e, state.online) });
    log({ stage: 'Scan · read photo', mode: InferenceMode.ONLY_ON_DEVICE, source: InferenceSource.ON_DEVICE, ms: 0, sentBytes: 0, withheld: 0, leaked: 0, ok: false, note: 'Reading failed — nothing was sent.' });
  }
  abort = null;
  renderAll();
  docEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function toggleEntity(key: string) {
  const sh = state.shield;
  if (!sh) return;
  const e = sh.entities.find((x) => x.key === key);
  if (!e) return;
  e.masked = !e.masked;
  if (state.caseOpen) setReleased(state.caseOpen, sh.entities.filter((x) => !x.masked).map((x) => x.key));
  renderReview();
  renderAsk();
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

docEl.addEventListener('input', () => {
  state.doc = docEl.value;
  if (state.caseOpen && !state.doc.trim()) state.caseOpen = '';
  if (state.shield && state.shield.original !== state.doc) {
    state.shield = null;
    state.triage = null;
    state.triageState = 'idle';
    state.answer = null;
  }
  renderAll();
});

document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((b) =>
  b.addEventListener('click', () => {
    const s = SAMPLES.find((x) => x.id === b.dataset.sample)!;
    resetDoc(s.text);
    renderAll();
  }),
);

$<HTMLInputElement>('#scan-file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  if (!ACCEPTED_IMAGE.test(f.type)) {
    alert('Use a JPEG or PNG photo of the letter.');
    return;
  }
  void onScan(f);
});
$('#btn-scan-sample').addEventListener('click', async () => {
  const s = SAMPLES.find((x) => x.id === 'eviction') ?? SAMPLES[0];
  void onScan(await renderLetterImage(s.text));
});
$('#btn-shield').addEventListener('click', () => void onShield());

$('#btn-case-sample').addEventListener('click', () => {
  const name = 'Mom’s hospital stay (sample)';
  let c = loadCases().find((x) => x.name === name);
  if (!c) {
    c = createCase(name);
    for (const s of [SAMPLES.find((x) => x.id === 'discharge')!, ...CASE_DEMO]) addDoc(c.id, s.text);
  }
  refreshCases(c.id);
  const fresh = currentCase()!;
  resetDoc(joinCase(fresh), fresh.id);
  renderAll();
  void onShield();
});

function refreshCases(selectId = state.caseId) {
  state.cases = loadCases();
  state.caseId = state.cases.some((c) => c.id === selectId) ? selectId : '';
}
$('#case').addEventListener('change', (ev) => {
  const t = ev.target as HTMLSelectElement;
  if (t.id !== 'case-select') return;
  if (t.value === '__new') state.naming = true;
  else state.caseId = t.value;
  renderAll();
  if (state.naming) $<HTMLInputElement>('#case-name').focus();
});
function finishNaming(create: boolean) {
  const name = (document.querySelector<HTMLInputElement>('#case-name')?.value ?? '').trim();
  state.naming = false;
  if (create) {
    const c = createCase(name);
    if (state.doc.trim() && !state.caseOpen) addDoc(c.id, state.doc);
    refreshCases(c.id);
  }
  renderAll();
}
$('#case').addEventListener('keydown', (ev) => {
  if ((ev.target as HTMLElement).id !== 'case-name') return;
  if (ev.key === 'Enter') finishNaming(true);
  if (ev.key === 'Escape') finishNaming(false);
});
$('#case').addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('button');
  if (!t) return;
  const c = currentCase();
  if (t.id === 'case-create') finishNaming(true);
  else if (t.id === 'case-cancel') finishNaming(false);
  else if (!c) return;
  else if (t.id === 'case-save') {
    addDoc(c.id, state.doc);
    refreshCases();
    renderAll();
  } else if (t.id === 'case-open') {
    resetDoc(joinCase(c), c.id);
    renderAll();
    void onShield();
  } else if (t.id === 'case-delete') {
    deleteCase(c.id);
    if (state.caseOpen === c.id) state.caseOpen = '';
    refreshCases('');
    renderAll();
  } else if (t.dataset.openDoc) {
    const d = c.docs.find((x) => x.id === t.dataset.openDoc);
    if (d) resetDoc(d.text);
    renderAll();
  } else if (t.dataset.removeDoc) {
    removeDoc(c.id, t.dataset.removeDoc);
    refreshCases();
    renderAll();
  }
});
$('#btn-run').addEventListener('click', () => void onRun());
$('#btn-stop').addEventListener('click', () => abort?.abort());
$('#pill-device').addEventListener('click', () => document.querySelector('#card-device')?.scrollIntoView({ behavior: 'smooth' }));

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    state.view = b.dataset.view as typeof state.view;
    renderReview();
  }),
);
$('#doc-view').addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-key]');
  if (t) toggleEntity(t.dataset.key!);
});
$('#entities').addEventListener('click', (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-key]');
  if (t) toggleEntity(t.dataset.key!);
});
document.querySelectorAll<HTMLButtonElement>('[data-policy]').forEach((b) =>
  b.addEventListener('click', () => {
    state.policy = b.dataset.policy as Policy;
    renderAsk();
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-task]').forEach((b) =>
  b.addEventListener('click', () => {
    state.task = TASKS.find((t) => t.id === b.dataset.task)!;
    renderAsk();
    if (state.task.id === 'ask') questionEl.focus();
  }),
);
questionEl.addEventListener('input', () => {
  state.question = questionEl.value;
  renderAsk();
});
questionEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void onRun();
});

const onNet = () => {
  state.online = navigator.onLine;
  renderStatus();
  renderAsk();
  if (state.triageState === 'needs-consent') renderTriage();
};
window.addEventListener('online', onNet);
window.addEventListener('offline', onNet);

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

renderAll();
void refreshDevice();
// Chrome may finish a background download while the page is open.
setInterval(() => {
  if (state.device === 'downloadable' || state.device === 'downloading') void refreshDevice();
}, 5000);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

// Exposed for automated tests only (no user data is reachable through it beyond what is on screen).
(window as unknown as { __veil: unknown }).__veil = { state, buildEntities };
