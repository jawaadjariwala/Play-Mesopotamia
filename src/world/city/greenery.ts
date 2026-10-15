import { mulberry32 } from '../props/random';
import { canalBridges } from '../landmarks';
import type { Block } from './layout';
import { insideWall, onWater, plan, wallFactor, type CityPlan } from './plan';

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

/**
 * Belts of palms along the Euphrates and the outer canal, a few rows deep on each bank,
 * thinning out with distance from the city. Outside the walls only.
 */
export function bankPalmPoints(p: CityPlan = plan, seed = 7): [number, number][] {
  const rand = mulberry32(seed);
  const pts: [number, number][] = [];
  const along = (path: [number, number][], half: number, rows: number) => {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const [dx, dz] = [(bx - ax) / len, (bz - az) / len];
      for (let d = 0; d < len; d += 5 + rand() * 4) {
        for (const side of [-1, 1]) {
          for (let r = 0; r < rows; r++) {
            if (rand() < 0.15 + r * 0.12) continue;
            const off = side * (half + 9 + r * 9 + rand() * 7);
            const x = ax + dx * d - dz * off;
            const z = az + dz * d + dx * off;
            if (Math.hypot(x, z) > 2100) continue;
            if (insideWall(x, z, 12, p) || onWater(x, z, 8, p)) continue;
            pts.push([x, z]);
          }
        }
      }
    }
  };
  along(p.water.river.path, p.water.river.width / 2, 5);
  // The outer canal, sampled along its arc.
  const c = p.water.canal;
  const arc: [number, number][] = [];
  for (let k = 0; k <= 60; k++) {
    const deg = c.fromDeg + ((c.toDeg - c.fromDeg) * k) / 60;
    const th = (deg * Math.PI) / 180;
    const f = wallFactor(th, p);
    arc.push([(p.wall.radiusX * f + c.offset) * Math.cos(th), (p.wall.radiusZ * f + c.offset) * Math.sin(th)]);
  }
  along(arc, c.width / 2, 2);
  return pts;
}
