// Walks the player in headless Chrome and checks streaming and physics:
// massing is hidden exactly where detailed blocks are loaded, walls stop you,
// and the ziggurat stair can be climbed. Run with the dev server up:
//   node scripts/walk-check.mjs [url]

import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 450 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(process.argv[2] ?? 'http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => window.__stats && window.__stats.fps > 0, { timeout: 30000 });
const c = await page.evaluate(() => {
  const city = window.__city;
  const hidden = city.hidden.array.reduce((a, b) => a + b, 0);
  return { loaded: city.loadedCount, hidden };
});
console.log('loaded vs hidden flags:', JSON.stringify(c));
// Walk forward (into the street) for 4 s, then hold W into a wall direction for 3 s and check we stop.
const pos = () => page.evaluate(() => { const p = window.__player.position; return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; });
console.log('start', await pos());
await page.keyboard.down('KeyW'); await new Promise((r) => setTimeout(r, 4000)); await page.keyboard.up('KeyW');
console.log('after 4 s walking forward', await pos());
await page.keyboard.down('KeyA'); await new Promise((r) => setTimeout(r, 4000)); await page.keyboard.up('KeyA');
const a = await pos();
await page.keyboard.down('KeyA'); await new Promise((r) => setTimeout(r, 2000)); await page.keyboard.up('KeyA');
const b = await pos();
console.log('strafe into wall: moved', Math.hypot(b[0] - a[0], b[2] - a[2]).toFixed(2), 'm in the last 2 s (expect ~0)');
// Teleport to the foot of the ziggurat stair and walk up it.
await page.evaluate(async () => {
  const pl = window.__player;
  pl.teleport(window.__stairFoot.x, window.__stairFoot.z, window.__stairFoot.yaw);

});
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await new Promise((r) => setTimeout(r, 12000)); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
console.log('after running up the ziggurat stair', await pos(), '(expect y near 11.9)');
console.log('errors:', errs.slice(0, 3));
await browser.close();
