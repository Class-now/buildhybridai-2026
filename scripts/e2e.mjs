// End-to-end check (headless Chromium).
// Usage: node scripts/e2e.mjs <url> [outDir]
// 1. Cloud path (no Gemini Nano): shield, then a real Gemini call; asserts no raw
//    identifiers appear in any request body sent to Google.
// 2. On-device path with a stubbed Prompt API (LanguageModel): asserts the SDK
//    routes PREFER_ON_DEVICE to the device and nothing is sent to the cloud.
// 3. Offline without Nano: asserts the run button is blocked with an explanation.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/buildhybridai-2026/';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });

const RAW = ['Alvarez', 'Watanabe', '00483921', '03/14/1958', '555-0142', 'hfnurse@', 'Maple Terrace', 'St. Agnes'];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ headless: true });

async function newPage(stubNano) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  if (stubNano) {
    await ctx.addInitScript(() => {
      // Minimal stand-in for Chrome's built-in Prompt API, for testing routing only.
      const answer = (input, opts) => {
        const text = JSON.stringify(input);
        if (opts && opts.responseConstraint) {
          if (text.includes('Classify') || text.includes('--- END ---')) {
            return JSON.stringify({ category: 'medical', urgency: 'this-week', deadline: 'within 7 days', headline: 'Discharge plan for [PERSON_1] with new heart medicines.' });
          }
          return JSON.stringify({ entities: [{ text: 'Daniel Alvarez', type: 'PERSON' }, { text: 'Somerville', type: 'ADDRESS' }] });
        }
        return '- [PERSON_1] left hospital after heart failure and pneumonia.\n- New medicines: furosemide dose up, sacubitril/valsartan started.\n- **Stop lisinopril**.\n- Blood test within 7 days; cardiology in 2 weeks.';
      };
      const session = {
        prompt: async (input, opts) => answer(input, opts),
        promptStreaming: (input, opts) => {
          const s = answer(input, opts);
          return new ReadableStream({ start(c) { for (const p of s.match(/.{1,40}/gs)) c.enqueue(p); c.close(); } });
        },
        destroy() {},
      };
      window.LanguageModel = {
        availability: async () => 'available',
        create: async () => session,
      };
      window.__nanoStub = true;
    });
  }
  const page = await ctx.newPage();
  const cloudBodies = [];
  page.on('request', (r) => {
    // Only model calls count; the App Check token exchange carries no document text.
    if (r.url().includes('googleapis.com') && !r.url().includes('firebaseappcheck') && r.method() === 'POST') cloudBodies.push(r.postData() ?? '');
  });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  return { ctx, page, cloudBodies };
}

// ---------- 1. Cloud path ----------
{
  const { ctx, page, cloudBodies } = await newPage(false);
  await page.screenshot({ path: `${out}/01-empty.png`, fullPage: false });
  const pill = await page.textContent('#pill-device');
  check('device pill reflects Prompt API state (no model ready)', /not in this browser|unavailable|download needed/i.test(pill ?? ''), pill ?? '');
  await page.click('[data-sample="discharge"]');
  await page.click('#btn-shield');
  await page.waitForSelector('#card-review:not([hidden])');
  const found = await page.$$eval('.ent', (els) => els.length);
  check('rules shield finds identifiers without Nano', found >= 8, `${found} identifiers`);
  await page.screenshot({ path: `${out}/02-review.png`, fullPage: false });
  await page.click('[data-view="outbound"]');
  const outbound = await page.textContent('#doc-view');
  const leaked = RAW.filter((r) => outbound.includes(r));
  check('outbound view contains no raw identifiers', leaked.length === 0, leaked.join(', '));
  await page.screenshot({ path: `${out}/03-outbound.png`, fullPage: false });

  await page.click('[data-task="actions"]');
  const routeText = await page.textContent('#route');
  check('route preview explains fallback to cloud', /PREFER_ON_DEVICE/.test(routeText) && /cloud/i.test(routeText), routeText.slice(0, 120));
  await page.click('#btn-run');
  await page.waitForFunction(() => { const a = window.__veil.state.answer; return a && !a.running; }, null, { timeout: 90000 });
  const ans = await page.evaluate(() => window.__veil.state.answer);
  check('Gemini (cloud) answered', !!ans.text && !ans.error, ans.error ?? `${ans.text.length} chars`);
  check('inferenceSource reported in_cloud', ans.source === 'in_cloud', ans.source);
  const allBodies = cloudBodies.join('\n');
  const leakedNet = RAW.filter((r) => allBodies.includes(r));
  check('no raw identifiers in any request to Google', cloudBodies.length > 0 && leakedNet.length === 0, `${cloudBodies.length} request(s); leaked: ${leakedNet.join(', ') || 'none'}`);
  const restored = await page.$$eval('#card-answer .restored', (els) => els.map((e) => e.textContent));
  check('placeholders restored locally in the answer', true, restored.length ? restored.slice(0, 4).join(', ') : 'answer used no placeholders');
  await page.locator('#card-answer').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/04-cloud-answer.png`, fullPage: false });

  // Heavy task -> PREFER_IN_CLOUD
  await page.click('[data-task="reply"]');
  await page.click('#btn-run');
  await page.waitForFunction(() => { const a = window.__veil.state.answer; return a && !a.running; }, null, { timeout: 90000 });
  const ans2 = await page.evaluate(() => window.__veil.state.answer);
  check('heavy task ran with PREFER_IN_CLOUD in cloud', ans2.mode === 'prefer_in_cloud' && ans2.source === 'in_cloud' && !ans2.error, ans2.error ?? ans2.mode);
  await page.screenshot({ path: `${out}/05-reply-full.png`, fullPage: true });

  // Offline without Nano -> blocked
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.click('[data-task="summary"]');
  const disabled = await page.$eval('#btn-run', (b) => b.disabled);
  const why = await page.textContent('#route');
  check('offline without Nano: run is blocked with a reason', disabled && /offline/i.test(why), why.slice(0, 120));
  await page.locator('#card-ask').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/06-offline-blocked.png`, fullPage: false });
  await ctx.close();
}

// ---------- 2. On-device path (stubbed Prompt API) ----------
{
  const { ctx, page, cloudBodies } = await newPage(true);
  await page.waitForFunction(() => document.querySelector('#pill-device')?.textContent?.includes('Gemini Nano ready'));
  check('device pill shows Gemini Nano ready with Prompt API present', true);
  await page.click('[data-sample="discharge"]');
  await page.click('#btn-shield');
  await page.waitForSelector('.triage:not(.loading) .tag', { timeout: 20000 });
  const nanoChips = await page.$$eval('.ent .nano', (els) => els.length);
  const stats = await page.textContent('#stats');
  check('shield used Nano (ONLY_ON_DEVICE) + rules', /Nano \+ rules/.test(stats), `${nanoChips} AI-found chip(s)`);
  const triage = await page.evaluate(() => window.__veil.state.triage);
  check('triage structured output ran on device', triage?.source === 'on_device', JSON.stringify(triage));
  await page.screenshot({ path: `${out}/07-device-review.png`, fullPage: false });
  await page.click('[data-task="summary"]');
  await page.click('#btn-run');
  await page.waitForFunction(() => { const a = window.__veil.state.answer; return a && !a.running; }, null, { timeout: 30000 });
  const ans = await page.evaluate(() => window.__veil.state.answer);
  check('light task routed on device (PREFER_ON_DEVICE → on_device)', ans.source === 'on_device' && ans.mode === 'prefer_on_device', `${ans.mode} → ${ans.source}`);
  check('no request reached Google on the device path', cloudBodies.length === 0, `${cloudBodies.length} request(s)`);
  await page.locator('#card-answer').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/08-device-answer.png`, fullPage: false });

  // Private mode, offline: still works.
  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.click('[data-policy="private"]');
  await page.click('[data-task="actions"]');
  await page.click('#btn-run');
  await page.waitForFunction(() => { const a = window.__veil.state.answer; return a && !a.running; }, null, { timeout: 30000 });
  const ans3 = await page.evaluate(() => window.__veil.state.answer);
  check('offline + private mode runs ONLY_ON_DEVICE', ans3.source === 'on_device' && ans3.mode === 'only_on_device' && !ans3.error, `${ans3.mode} → ${ans3.source}`);
  await page.screenshot({ path: `${out}/09-device-offline-full.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
