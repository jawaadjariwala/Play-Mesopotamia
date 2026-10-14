import ur from '../../../content/city/ur.json';
import type { GroveSpec } from '../props/palm';
import type { ZigguratSpec } from '../generator/buildings';

export type Rect = [number, number, number, number]; // x0, z0, x1, z1

export interface CityPlan {
  wall: { radiusX: number; radiusZ: number; height: number; baseWidth: number; topWidth: number; gates: number[] };
  temenos: { rect: Rect; wallHeight: number; wallThickness: number; gate: { side: 'east'; at: number } };
  ziggurat: ZigguratSpec;
  water: {
    river: { x: number; width: number };
    harbours: { name: string; rect: Rect }[];
    /** Links from the harbours out through the wall to the river and canal. */
    channels: { name: string; rect: Rect }[];
    canal: { offset: number; width: number; fromDeg: number; toDeg: number };
  };
  streets: { spacing: number; jitter: number; laneWidth: number; avenueEvery: number; avenueWidth: number; edgeMargin: number };
  spawn: { near: [number, number]; lookAt: [number, number] };
  palmGroves: GroveSpec[];
}

export const plan = ur as unknown as CityPlan;

export function insideEllipse(x: number, z: number, rx: number, rz: number): boolean {
  return (x / rx) ** 2 + (z / rz) ** 2 <= 1;
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a[0] < b[2] + margin && a[2] > b[0] - margin && a[1] < b[3] + margin && a[3] > b[1] - margin;
}

/** Can a building stand on this footprint? Inside the wall, clear of the temenos and harbours. */
export function buildable(r: Rect, p: CityPlan = plan): boolean {
  const m = p.streets.edgeMargin;
  const rx = p.wall.radiusX - m;
  const rz = p.wall.radiusZ - m;
  for (const [x, z] of [
    [r[0], r[1]],
    [r[2], r[1]],
    [r[2], r[3]],
    [r[0], r[3]],
  ]) {
    if (!insideEllipse(x, z, rx, rz)) return false;
  }
  if (rectsOverlap(r, p.temenos.rect, 12)) return false;
  for (const h of p.water.harbours) if (rectsOverlap(r, h.rect, 8)) return false;
  return true;
}

/** Distance from a point to a rectangle (0 inside). */
export function distanceToRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dz = Math.max(r[1] - z, 0, z - r[3]);
  return Math.hypot(dx, dz);
}
