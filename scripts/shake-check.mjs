// Walks (or runs, with `run`) for 8 s in headless Chrome and reports frame pacing and how
// much the camera moves vertically per frame. Spikes in vertical speed read as camera shake.
//   node scripts/shake-check.mjs [walk|run] [url]
import puppeteer from 'puppeteer-core';
const run = process.argv[2] === 'run';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  await page.goto(process.argv[3] ?? 'http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 180000 });
  await page.waitForFunction(() => window.__stats && window.__stats.fps > 0);
// Press "Start walking" (scripts can't click it with a real gesture).
await page.evaluate(() => window.__ui?.start());
  await page.evaluate(() => {
    window.__rec = []; let last = performance.now();
    const cam = window.__camera;
    const loop = (t) => { window.__rec.push([t - last, cam.position.x, cam.position.y, cam.position.z, window.__quality.level]); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  if (run) await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW'); await new Promise((r) => setTimeout(r, 8000)); await page.keyboard.up('KeyW');
  if (run) await page.keyboard.up('ShiftLeft');
  const rec = await page.evaluate(() => window.__rec);
  // Per-frame: dt, horizontal speed, vertical velocity; flag spikes.
  const rows = [];
  for (let i = 2; i < rec.length; i++) {
    const [dt, x, y, z, q] = rec[i];
    const [, px, py, pz] = rec[i - 1];
    rows.push({ i, dt: +dt.toFixed(1), v: +(Math.hypot(x - px, z - pz) / (dt / 1000)).toFixed(2), vy: +((y - py) / (dt / 1000)).toFixed(3), q });
  }
  const dts = rows.map((r) => r.dt);
  console.log('frames', rows.length, 'dt max', Math.max(...dts), 'frames over 25 ms:', rows.filter((r) => r.dt > 25).map((r) => `${r.i}:${r.dt}`).join(' '));
  const vs = rows.slice(60).map((r) => r.v);
  console.log('speed min/max after 1 s:', Math.min(...vs), Math.max(...vs));
  const vys = rows.map((r) => Math.abs(r.vy));
  console.log('vertical speed max', Math.max(...vys), 'frames with |vy|>0.6:', rows.filter((r) => Math.abs(r.vy) > 0.6).map((r) => `${r.i}:${r.vy}`).slice(0, 20).join(' '));
  console.log('quality levels seen:', [...new Set(rows.map((r) => r.q))].join(','));
  console.log('sample speeds 120-160:', rows.slice(120, 160).map((r) => r.v).join(' '));
} finally {
  await browser.close();
}
