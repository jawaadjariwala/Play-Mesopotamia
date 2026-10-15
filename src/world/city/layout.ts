import { mulberry32 } from '../props/random';
import type { BuildingSpec, DoorSpec, WallSpec } from '../generator/buildings';
import type { PropSpec } from '../props/pottery';
import { buildable, plan, type CityPlan, type Rect } from './plan';

/**
 * Deterministic city layout. Everything here is plain data derived from the plan and
 * fixed seeds, so the same street, block and house come back every time the player
 * walks past, and the whole thing can be tested without a renderer.
 *
 * Streets: two families of jittered straight lines (every Nth one a wider avenue).
 * Blocks: the spaces between neighbouring lines. Plots: each block is cut into one or
 * two rows, then each row into house plots, so every plot touches a street.
 * Houses: rooms around a central court, the typical Old Babylonian plan at Ur.
 */

type Side = 'n' | 's' | 'e' | 'w';

export interface Plot {
  rect: Rect;
  street: Side;
  seed: number;
}

export interface Block {
  id: number;
  i: number;
  j: number;
  rect: Rect;
  plots: Plot[];
}

function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export class StreetGrid {
  constructor(private p: CityPlan = plan) {}

  /** Centre line of street number i in one family (axis 0 = lines of constant x, 1 = constant z). */
  line(axis: 0 | 1, i: number): number {
    const s = this.p.streets;
    return i * s.spacing + (hash2(i, axis + 17) - 0.5) * 2 * s.jitter;
  }

  width(axis: 0 | 1, i: number): number {
    const s = this.p.streets;
    return ((i % s.avenueEvery) + s.avenueEvery) % s.avenueEvery === 0 ? s.avenueWidth : s.laneWidth;
  }

  range(axis: 0 | 1): [number, number] {
    const r = axis === 0 ? this.p.wall.radiusX : this.p.wall.radiusZ;
    const n = Math.ceil(r / this.p.streets.spacing) + 1;
    return [-n, n];
  }

  /** Nearest street crossing to a point. */
  crossingNear(x: number, z: number): [number, number] {
    const s = this.p.streets.spacing;
    const i = Math.round(x / s);
    const j = Math.round(z / s);
    return [this.line(0, i), this.line(1, j)];
  }
}

const MIN_PLOT = 8;
const MAX_PLOT = 15;

export function generateBlocks(p: CityPlan = plan): Block[] {
  const grid = new StreetGrid(p);
  const [i0, i1] = grid.range(0);
  const [j0, j1] = grid.range(1);
  const blocks: Block[] = [];
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const rect: Rect = [
        grid.line(0, i) + grid.width(0, i) / 2,
        grid.line(1, j) + grid.width(1, j) / 2,
        grid.line(0, i + 1) - grid.width(0, i + 1) / 2,
        grid.line(1, j + 1) - grid.width(1, j + 1) / 2,
      ];
      // Each block sits back from the street by its own amount on every side, so street
      // widths vary and the frontage jogs from block to block instead of running ruler-straight.
      const r = mulberry32(Math.floor(hash2(i, j) * 1e9));
      rect[0] += r() * 1.6;
      rect[1] += r() * 1.6;
      rect[2] -= r() * 1.6;
      rect[3] -= r() * 1.6;
      const plots = splitBlock(rect, r).filter((pl) => buildable(pl.rect, p));
      if (plots.length > 0) blocks.push({ id: blocks.length, i, j, rect, plots });
    }
  }
  return blocks;
}

function splitBlock(r: Rect, rand: () => number): Plot[] {
  const [x0, z0, x1, z1] = r;
  const w = x1 - x0;
  const d = z1 - z0;
  const longIsX = w >= d;
  const short = longIsX ? d : w;
  // Deep blocks get two rows back to back, each facing its own street.
  const rows: { lo: number; hi: number; street: Side }[] = [];
  const s0 = longIsX ? z0 : x0;
  if (short > 22) {
    const cut = s0 + short * (0.42 + rand() * 0.16);
    rows.push({ lo: s0, hi: cut, street: longIsX ? 'n' : 'w' });
    rows.push({ lo: cut, hi: s0 + short, street: longIsX ? 's' : 'e' });
  } else {
    rows.push({ lo: s0, hi: s0 + short, street: rand() < 0.5 ? (longIsX ? 'n' : 'w') : longIsX ? 's' : 'e' });
  }

  const plots: Plot[] = [];
  const l0 = longIsX ? x0 : z0;
  const l1 = longIsX ? x1 : z1;
  for (const row of rows) {
    let a = l0;
    let first = true;
    while (l1 - a >= MIN_PLOT) {
      let len = MIN_PLOT + rand() * (MAX_PLOT - MIN_PLOT);
      if (l1 - a - len < MIN_PLOT) len = l1 - a; // absorb the leftover
      const b = a + len;
      const last = l1 - b < MIN_PLOT;
      // A corner plot left open now and then: a small square where streets meet.
      const square = (first || last) && rand() < 0.07;
      if (!square) {
        const rect: Rect = longIsX ? [a, row.lo, b, row.hi] : [row.lo, a, row.hi, b];
        plots.push({ rect, street: row.street, seed: Math.floor(rand() * 1e9) });
      }
      a = b;
      first = false;
      // In deep blocks, a narrow blind alley sometimes runs in between two houses.
      if (rows.length === 2 && !last && rand() < 0.12) a += 1.8;
    }
  }
  return plots;
}

const T = 0.6; // wall thickness

/**
 * A courtyard house filling a plot: outer walls inset by half a wall so neighbours
 * stand side by side (party walls read as one thick wall), a court in the middle,
 * eight rooms around it, and a street door into the room that opens onto the court.
 */
export interface House {
  spec: BuildingSpec;
  props: PropSpec[];
  /** Court in world coordinates, for the low-detail massing. */
  court: Rect;
}

export function houseForPlot(plot: Plot, id: string): House {
  const rand = mulberry32(plot.seed);
  const [x0, z0, x1, z1] = plot.rect;
  const W = x1 - x0;
  const D = z1 - z0;
  const t = T / 2;
  // Whether houses at Ur had upper floors is debated; most are kept to one storey.
  const twoStorey = rand() < 0.12;
  const wallHeight = twoStorey ? 6.3 + rand() * 0.4 : 3.7 + rand() * 0.6;
  const roofHeight = wallHeight - 0.4;
  const doorH = 1.9 + rand() * 0.25;
  const door = (at: number, width = 0.85): DoorSpec => ({ at, width, height: doorH });

  // Court: about 40% of each side, shifted a little off centre.
  const cw = Math.min(7, Math.max(2.8, W * (0.34 + rand() * 0.1)));
  const cd = Math.min(7, Math.max(2.8, D * (0.34 + rand() * 0.1)));
  const cx0 = Math.max(t + 2.4, Math.min(W - t - 2.4 - cw, (W - cw) / 2 + (rand() - 0.5) * 1.5));
  const cz0 = Math.max(t + 2.4, Math.min(D - t - 2.4 - cd, (D - cd) / 2 + (rand() - 0.5) * 1.5));
  const cx1 = cx0 + cw;
  const cz1 = cz0 + cd;
  const courtLip = roofHeight + 0.15;
  const inner = roofHeight - 0.1;

  // Street door goes in the middle stretch of the street wall, into the room that opens on the court.
  const streetLeaf = { hinge: (rand() < 0.5 ? 'start' : 'end') as 'start' | 'end', open: rand() < 0.35 ? 0 : 10 + rand() * 60 };
  const midDoor = (a: number, b: number) => a + (b - a) * (0.3 + rand() * 0.4);

  const outer: WallSpec[] = [
    { from: [t, t], to: [W - t, t] }, // n
    { from: [W - t, t], to: [W - t, D - t] }, // e
    { from: [W - t, D - t], to: [t, D - t] }, // s
    { from: [t, D - t], to: [t, t] }, // w
  ];
  const streetWall = { n: 0, e: 1, s: 2, w: 3 }[plot.street];
  const sw = outer[streetWall];
  // Distance along that wall to the middle stretch (walls run counter-clockwise).
  const along = {
    n: [cx0 - t, cx1 - t],
    e: [cz0 - t, cz1 - t],
    s: [W - t - cx1, W - t - cx0],
    w: [D - t - cz1, D - t - cz0],
  }[plot.street];
  sw.doors = [{ ...door(midDoor(along[0], along[1]), 0.9), leaf: streetLeaf }];

  const walls: WallSpec[] = [
    ...outer,
    // Court walls stand just above the roofs.
    { from: [cx0, cz0], to: [cx1, cz0], height: courtLip, doors: [door(cw / 2)] },
    { from: [cx1, cz0], to: [cx1, cz1], height: courtLip, doors: [door(cd / 2)] },
    { from: [cx1, cz1], to: [cx0, cz1], height: courtLip, doors: [door(cw / 2, 1.05)] },
    { from: [cx0, cz1], to: [cx0, cz0], height: courtLip, doors: [door(cd / 2)] },
    // Partitions carry the court lines out to the outer walls. Corner rooms open into the middle rooms.
    { from: [cx0, t], to: [cx0, cz0], height: inner, doors: [door((cz0 - t) / 2)] },
    { from: [cx1, t], to: [cx1, cz0], height: inner, doors: [door((cz0 - t) / 2)] },
    { from: [cx0, cz1], to: [cx0, D - t], height: inner, doors: [door((D - t - cz1) / 2)] },
    { from: [cx1, cz1], to: [cx1, D - t], height: inner, doors: [door((D - t - cz1) / 2)] },
    { from: [t, cz0], to: [cx0, cz0], height: inner },
    { from: [cx1, cz0], to: [W - t, cz0], height: inner },
    { from: [t, cz1], to: [cx0, cz1], height: inner },
    { from: [cx1, cz1], to: [W - t, cz1], height: inner },
  ];

  const spec: BuildingSpec = {
    id,
    evidence: 'invented',
    note: 'Generated house following the courtyard plan Woolley recorded across the residential quarters.',
    position: [x0, z0],
    rotation: 0,
    wallHeight,
    thickness: T,
    footingHeight: 0.7 + rand() * 0.4,
    roofHeight,
    walls,
    roofs: [
      { rect: [t, t, W - t, cz0] },
      { rect: [t, cz1, W - t, D - t] },
      { rect: [t, cz0, cx0, cz1] },
      { rect: [cx1, cz0, W - t, cz1] },
    ],
    floors: rand() < 0.65 ? [{ rect: [cx0, cz0, cx1, cz1], material: 'brick' }] : [],
    // Some houses freshly re-plastered and pale, others weathered and darker.
    shade: rand() < 0.15 ? 1.12 + rand() * 0.08 : 0.8 + rand() * 0.25,
  };

  // A few pots against the court walls, in world coordinates.
  const props: PropSpec[] = [];
  const pave = spec.floors!.length ? 0.05 : 0;
  const pots = Math.floor(rand() * 4);
  for (let k = 0; k < pots; k++) {
    const onX = rand() < 0.5;
    const px = onX ? cx0 + 0.65 + rand() * (cw - 1.3) : rand() < 0.5 ? cx0 + 0.55 : cx1 - 0.55;
    const pz = onX ? (rand() < 0.5 ? cz0 + 0.55 : cz1 - 0.55) : cz0 + 0.65 + rand() * (cd - 1.3);
    const type = rand() < 0.6 ? 'storageJar' : rand() < 0.5 ? 'cookingPot' : 'bowl';
    props.push({ type, position: [x0 + px, z0 + pz], y: pave, tilt: rand() < 0.3 ? 5 : 0 });
  }
  return { spec, props, court: [x0 + cx0, z0 + cz0, x0 + cx1, z0 + cz1] };
}
