// Loads the running dev server in headless Chrome, prints frame stats and any
// console errors per camera view, and saves a small screenshot of each.
//
//   node scripts/shoot.mjs [url] [view,view,...] [outDir]
//
// Set NO_WEBGPU=1 to test the WebGL 2 fallback.
// Headless numbers are only a smoke test; real fps targets are measured in a normal browser.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const views = (process.argv[3] ?? 'street,courtyard,aerial').split(',');
const outDir = process.argv[4] ?? 'shots';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});

for (const view of views) {
  const page = await browser.newPage();
  await page.setViewport({ width: Number(process.env.W ?? 960), height: Number(process.env.H ?? 540), deviceScaleFactor: Number(process.env.DPR ?? 1) });
  const problems = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));

  // NO_WEBGPU=1 hides WebGPU so we can check the WebGL 2 fallback path.
  if (process.env.NO_WEBGPU) await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'gpu', { get: () => undefined }));
  await page.goto(`${url}?view=${view}`, { waitUntil: 'networkidle0', timeout: 60000 });
  try {
    await page.waitForFunction(() => window.__stats && window.__stats.fps > 0, { timeout: 30000 });
  } catch {
    problems.push('no frame stats after 30 s');
  }
  await new Promise((r) => setTimeout(r, 2500));
  // SAMPLE=n records n one-second windows (e.g. with ?autopilot) and reports the worst hitch.
  const samples = [];
  for (let i = 0; i < Number(process.env.SAMPLE ?? 0); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    samples.push(await page.evaluate(() => ({ ...window.__stats })));
  }
  if (samples.length) {
    const fps = samples.map((s) => s.fps);
    console.log(`   sampled ${samples.length}s: fps min ${Math.min(...fps)} avg ${Math.round(fps.reduce((a, b) => a + b) / fps.length)}, worst frame ${Math.max(...samples.map((s) => s.worstMs))} ms, draws max ${Math.max(...samples.map((s) => s.drawCalls))}`);
  }
  const stats = await page.evaluate(() => window.__stats ?? null);
  const cpu = await page.evaluate(() => window.__cpu ?? null);
  if (cpu) console.log('   cpu ms:', JSON.stringify(cpu, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v)));
  const city = await page.evaluate(() => window.__city?.worst ?? null);
  if (city) console.log('   city worst ms:', JSON.stringify(city, (k, v) => (typeof v === 'number' ? +v.toFixed(1) : v)));
  const loading = await page.evaluate(() => document.getElementById('loading')?.textContent ?? null);
  await page.screenshot({ path: `${outDir}/${view.replace(/[^a-z0-9.]+/gi, "_")}.jpg`, type: 'jpeg', quality: 80 });

  console.log(`[${view}]`, JSON.stringify(stats), loading ? `loading text: ${loading}` : '');
  for (const p of [...new Set(problems)].slice(0, 8)) console.log('   ', p.slice(0, 300));
  await page.close();
}
await browser.close();
