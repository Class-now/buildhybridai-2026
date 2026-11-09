// Prints the raw response of the first Firebase AI Logic request (debug helper).
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://localhost:4173/buildhybridai-2026/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 400)));
page.on('response', async (r) => {
  if (r.url().includes('googleapis.com')) {
    console.log('URL', r.url().slice(0, 160), r.status());
    try { console.log((await r.text()).slice(0, 1500)); } catch (e) { console.log('no body', e.message); }
  }
});
page.on('requestfailed', (r) => console.log('FAILED', r.url().slice(0, 160), r.failure()?.errorText));
await page.goto(url, { waitUntil: 'networkidle' });
await page.click('[data-sample="eviction"]');
await page.click('#btn-shield');
await page.click('[data-policy="cloud"]');
await page.click('[data-task="summary"]');
await page.click('#btn-run');
await page.waitForFunction(() => { const a = window.__veil.state.answer; return a && !a.running; }, null, { timeout: 90000 });
console.log(JSON.stringify(await page.evaluate(() => window.__veil.state.answer), null, 1).slice(0, 1500));
await browser.close();
