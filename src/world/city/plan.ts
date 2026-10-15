import ur from '../../../content/city/ur.json';
import type { GroveSpec } from '../props/palm';
import type { ZigguratSpec } from '../generator/buildings';

export type Rect = [number, number, number, number]; // x0, z0, x1, z1

export interface CityPlan {
  wall: {
    radiusX: number;
    radiusZ: number;
    height: number;
    baseWidth: number;
    topWidth: number;
    gates: number[];
    shape: { vertices: number; waves: [number, number, number][] };
    towerSize: number;
  };
  temenos: {
    rect: Rect;
    wallHeight: number;
    wallThickness: number;
    gate: { side: 'north' | 'south' | 'east' | 'west'; at: number };
    zigguratCourt: Rect;
    altar: { center: [number, number]; size: [number, number]; height: number };
    temples: TempleSpec[];
  };
  ziggurat: ZigguratSpec;
  water: {
    river: { name: string; width: number; path: [number, number][] };
    harbours: { name: string; rect: Rect }[];
    /** Links from the harbours out through the wall to the river and canal. */
    channels: { name: string; rect: Rect }[];
    canal: { offset: number; width: number; fromDeg: number; toDeg: number };
    innerCanal: { name: string; width: number; path: [number, number][]; bridgeEvery: number };
  };
  streets: { spacing: number; jitter: number; laneWidth: number; avenueEvery: number; avenueWidth: number; edgeMargin: number };
  spawn: { near: [number, number]; lookAt: [number, number] };
  palmGroves: GroveSpec[];
}

export interface TempleSpec {
  name: string;
  rect: Rect;
  /** Courtyard cells across x and z; each cell is a court with rooms around it. */
  cells: [number, number];
  door: 'north' | 'south' | 'east' | 'west' | ('north' | 'south' | 'east' | 'west')[];
  evidence: string;
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
  for (const [x, z] of [
    [r[0], r[1]],
    [r[2], r[1]],
    [r[2], r[3]],
    [r[0], r[3]],
  ]) {
    if (!insideWallShape(x, z, m, p)) return false;
  }
  // Keep a quay-side strip clear along the canal through the city.
  const c = p.water.innerCanal;
  const cx = (r[0] + r[2]) / 2;
  const cz = (r[1] + r[3]) / 2;
  const half = Math.hypot(r[2] - r[0], r[3] - r[1]) / 2;
  if (distanceToPath(cx, cz, c.path) < c.width / 2 + 6 + half) {
    for (const [x, z] of [
      [r[0], r[1]],
      [r[2], r[1]],
      [r[2], r[3]],
      [r[0], r[3]],
      [cx, cz],
    ]) {
      if (distanceToPath(x, z, c.path) < c.width / 2 + 6) return false;
    }
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

/** Is this point on water (river, canal, harbours, channels)? Used to keep props off it. */
export function onWater(x: number, z: number, margin = 0, p: CityPlan = plan): boolean {
  const r = p.water.river;
  if (distanceToPath(x, z, r.path) < r.width / 2 + margin) return true;
  for (const h of [...p.water.harbours, ...p.water.channels]) {
    const [x0, z0, x1, z1] = h.rect;
    if (x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin) return true;
  }
  if (distanceToPath(x, z, p.water.innerCanal.path) < p.water.innerCanal.width / 2 + margin) return true;
  // The outer canal follows the wall's outline at a fixed distance outside it.
  const c = p.water.canal;
  const th = Math.atan2(z / p.wall.radiusZ, x / p.wall.radiusX);
  const deg = (th * 180) / Math.PI;
  if (deg >= c.fromDeg && deg <= c.toDeg) {
    const f = wallFactor(th, p);
    const ring = Math.hypot((p.wall.radiusX * f + c.offset) * Math.cos(th), (p.wall.radiusZ * f + c.offset) * Math.sin(th));
    if (Math.abs(Math.hypot(x, z) - ring) < c.width / 2 + margin) return true;
  }
  return false;
}

/** Inside the city wall's footprint, rampart included. */
export function insideWall(x: number, z: number, margin = 0, p: CityPlan = plan): boolean {
  return insideWallShape(x, z, -(p.wall.baseWidth / 2 + margin), p);
}

/** Multiplier on the oval radius at angle theta (radians): the wall's irregular outline. */
export function wallFactor(theta: number, p: CityPlan = plan): number {
  let f = 1;
  for (const [k, amp, phase] of p.wall.shape.waves) f += amp * Math.sin(k * theta + phase);
  return f;
}

/** The wall's vertices (towers stand on them), counter-clockwise from angle -180 degrees. */
export function wallVertices(p: CityPlan = plan): [number, number][] {
  const n = p.wall.shape.vertices;
  return Array.from({ length: n }, (_, k) => {
    const th = -Math.PI + (2 * Math.PI * k) / n;
    const f = wallFactor(th, p);
    return [p.wall.radiusX * f * Math.cos(th), p.wall.radiusZ * f * Math.sin(th)];
  });
}

/** Is a point at least `inset` metres inside the wall line? (Negative inset reaches outside it.) */
export function insideWallShape(x: number, z: number, inset = 0, p: CityPlan = plan): boolean {
  const { radiusX: rx, radiusZ: rz } = p.wall;
  const th = Math.atan2(z / rz, x / rx);
  const k = Math.hypot(x / rx, z / rz);
  const localRadius = Math.hypot(rx * Math.cos(th), rz * Math.sin(th));
  return k < wallFactor(th, p) - inset / localRadius;
}

/** Shortest distance from a point to a polyline. */
export function distanceToPath(x: number, z: number, path: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}

/** Distance from the outer canal's centre line (Infinity outside its arc). */
export function distanceToOuterCanal(x: number, z: number, p: CityPlan = plan): number {
  const c = p.water.canal;
  const th = Math.atan2(z / p.wall.radiusZ, x / p.wall.radiusX);
  const deg = (th * 180) / Math.PI;
  if (deg < c.fromDeg || deg > c.toDeg) return Infinity;
  const f = wallFactor(th, p);
  const ring = Math.hypot((p.wall.radiusX * f + c.offset) * Math.cos(th), (p.wall.radiusZ * f + c.offset) * Math.sin(th));
  return Math.abs(Math.hypot(x, z) - ring);
}
