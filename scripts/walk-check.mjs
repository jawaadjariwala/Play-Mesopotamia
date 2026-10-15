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
await page.goto(process.argv[2] ?? 'http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 180000 });
await page.waitForFunction(() => window.__stats && window.__stats.fps > 0, { timeout: 30000 });
// Press "Start walking" (scripts can't click it with a real gesture).
await page.evaluate(() => window.__ui?.start());
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
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await new Promise((r) => setTimeout(r, 16000)); await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
console.log('after running up the ziggurat stair', await pos(), '(expect y near 11.9)');
// Try to leave the city: from just inside the wall, run straight out at every gate, every
// opening where water passes through, and a sample of plain wall. Nobody should get out.
const tests = await page.evaluate(() => window.__wallTests);
let escapes = 0;
for (const t of tests) {
  await page.evaluate((x, z, yaw) => window.__player.teleport(x, z, yaw), t.x, t.z, t.yaw);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 4500));
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  const p = await pos();
  const inside = await page.evaluate((x, z) => window.__insideWall(x, z), p[0], p[2]);
  if (!inside) escapes++;
  if (!inside) console.log(`ESCAPED at a ${t.kind}:`, p);
}
console.log(escapes === 0 ? `wall holds at all ${tests.length} tested spots (gates, water openings, wall)` : `${escapes} ESCAPES of ${tests.length}`);
// Walk across a canal bridge: start on one bank, end up on the other.
const br = await page.evaluate(() => window.__bridges[2] ?? window.__bridges[0]);
if (br) {
  const sx = br.x - br.ax * (br.half + 3), sz = br.z - br.az * (br.half + 3);
  await page.evaluate((x, z, yaw) => window.__player.teleport(x, z, yaw), sx, sz, Math.atan2(-br.ax, -br.az));
  await page.keyboard.down('KeyW'); await new Promise((r) => setTimeout(r, Math.ceil(((br.half + 3) * 2 / 1.7) * 1000) + 800)); await page.keyboard.up('KeyW');
  const p = await pos();
  const progressed = (p[0] - sx) * br.ax + (p[2] - sz) * br.az;
  console.log(`bridge crossing: moved ${progressed.toFixed(1)} m along the bridge (span ${(br.half * 2).toFixed(1)} m)`, progressed > br.half * 2 ? 'crossed (good)' : 'BLOCKED');
}
console.log('errors:', errs.slice(0, 3));
await browser.close();
