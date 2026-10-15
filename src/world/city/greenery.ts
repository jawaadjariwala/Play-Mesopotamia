import { mulberry32 } from '../props/random';
import { canalBridges } from '../landmarks';
import type { Block } from './layout';
import { insideWall, onWater, plan, type CityPlan } from './plan';

/**
 * Where palms grow inside the city: along the canal banks, in palm gardens, and now and
 * then in a small square. Deterministic, like the rest of the layout.
 */
export function cityPalmPoints(blocks: Block[], p: CityPlan = plan, seed = 99): [number, number][] {
  const rand = mulberry32(seed);
  const pts: [number, number][] = [];
  for (const b of blocks) {
    for (const pl of b.plots) {
      if (!pl.open) continue;
      const [x0, z0, x1, z1] = pl.rect;
      const count = pl.open === 'garden' ? 3 + Math.floor(rand() * 4) : rand() < 0.6 ? 1 : 0;
      for (let k = 0; k < count; k++) pts.push([x0 + 1.5 + rand() * (x1 - x0 - 3), z0 + 1.5 + rand() * (z1 - z0 - 3)]);
    }
  }
  const ic = p.water.innerCanal;
  const bridges = canalBridges(p);
  for (let i = 0; i < ic.path.length - 1; i++) {
    const [ax, az] = ic.path[i];
    const [bx, bz] = ic.path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const [dx, dz] = [(bx - ax) / len, (bz - az) / len];
    for (let d = rand() * 6; d < len; d += 6 + rand() * 5) {
      for (const side of [-1, 1]) {
        if (rand() < 0.35) continue;
        const off = side * (ic.width / 2 + 1.8 + rand() * 2.2);
        const x = ax + dx * d - dz * off;
        const z = az + dz * d + dx * off;
        if (!insideWall(x, z, 25, p) || onWater(x, z, 1, p)) continue;
        if (bridges.some((br) => Math.hypot(br.center.x - x, br.center.y - z) < br.halfLength + 2)) continue;
        pts.push([x, z]);
      }
    }
  }
  return pts;
}
