import * as THREE from 'three/webgpu';
import type { Materials } from '../materials';
import { MeshBuilder, footprint, rectCorners } from './meshBuilder';

/** How sure we are about a piece of the reconstruction. Shown to players in the codex. */
export type Evidence = 'excavated' | 'textual' | 'inferred' | 'invented';

type XZ = [number, number];

export interface DoorSpec {
  /** Distance along the wall from `from` to the door's centre, metres. */
  at: number;
  width: number;
  height: number;
  /** A wooden door leaf hung on the inside face, opened by `open` degrees. */
  leaf?: { hinge: 'start' | 'end'; open: number };
  /** Timber jambs either side of the doorway, on the outside face. */
  frame?: boolean;
}

export interface WallSpec {
  from: XZ;
  to: XZ;
  /** Overrides the building's wall height (parapets, low courtyard walls). */
  height?: number;
  /** Where the wall starts, for upper-storey rooms standing on the roof. */
  base?: number;
  /** The wall gets an eroded cap if it rises above this (defaults to the roof height). */
  capAbove?: number;
  /** An outside wall: gets beam-ends, windows, bands and door frames when the building asks for them. */
  outer?: boolean;
  doors?: DoorSpec[];
}

export interface RoofSpec {
  /** Axis-aligned [x0, z0, x1, z1] in building coordinates. */
  rect: [number, number, number, number];
  /** Overrides the building's roof height (upper-storey rooms). */
  height?: number;
}

export interface FloorSpec {
  /** Axis-aligned [x0, z0, x1, z1] in building coordinates. */
  rect: [number, number, number, number];
  /** Courtyards at Ur were often paved with baked brick. */
  material: 'brick';
}

export interface BuildingSpec {
  id: string;
  name?: string;
  evidence: Evidence;
  note?: string;
  position: XZ;
  /** Rotation about the vertical axis, degrees. */
  rotation?: number;
  wallHeight: number;
  thickness: number;
  /** Height of the baked-brick footing; mudbrick above it is plastered. */
  footingHeight: number;
  roofHeight: number;
  walls: WallSpec[];
  roofs?: RoofSpec[];
  floors?: FloorSpec[];
  /** Brightness of this building's plaster and brick (1 = as scanned). */
  shade?: number;
  /** Exterior details on outer walls. */
  details?: {
    /** Ends of the roof beams poking out just below the roof line. */
    beams?: boolean;
    /** Heights of small window openings (each gets a timber lintel). */
    windows?: number[];
    /** Height of a horizontal timber tie-beam band. */
    band?: number;
  };
  /** Reed-mat sunshades on poles, on the roof terraces. */
  awnings?: { rect: [number, number, number, number]; base: number }[];
  /** Ladders leaning against a wall: foot on the ground, top against the wall. */
  ladders?: { foot: XZ; top: XZ; height: number }[];
}

/** Oriented box for the physics world (Phase 1). */
export interface ColliderBox {
  center: THREE.Vector3;
  halfExtents: THREE.Vector3;
  rotationY: number;
  /** Full rotation, when a box is tilted (ramps); overrides rotationY. */
  rotation?: { x: number; y: number; z: number; w: number };
}

export interface BuiltObject {
  group: THREE.Group;
  colliders: ColliderBox[];
}

const LINTEL_DEPTH = 0.18;
const ROOF_THICKNESS = 0.32;
const PAVING_HEIGHT = 0.05;
const LEAF_THICKNESS = 0.06;

/** Eroded wall tops: built from short segments whose corners rise and fall with a smooth noise. */
const CAP_DEPTH = 0.16;
const CAP_STEP = 0.45;
const CAP_EDGE = 0.1;

function erosion(x: number, z: number, seed: number): number {
  return (
    0.5 * Math.sin(1.7 * x + 0.9 * z + seed) +
    0.3 * Math.sin(3.7 * z - 2.9 * x + seed * 1.7) +
    0.2 * Math.sin(8.3 * x + 6.1 * z + seed * 0.3)
  );
}

function seedFrom(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return h / 100;
}

/**
 * Rounded, uneven top for a wall run: a raised middle with edges that slump outward,
 * the way rain wears down the top of an unprotected mudbrick wall.
 */
function erodedCap(
  b: MeshBuilder,
  from: THREE.Vector2,
  along: THREE.Vector2,
  a0: number,
  a1: number,
  ht: number,
  y: number,
  seed: number,
) {
  const across = new THREE.Vector2(-along.y, along.x);
  const offsets = [-ht, -ht + CAP_EDGE, ht - CAP_EDGE, ht];
  const corner = (a: number, s: number, top: boolean) => {
    const p = from.clone().addScaledVector(along, a).addScaledVector(across, s);
    if (!top) return new THREE.Vector3(p.x, y - CAP_DEPTH, p.y);
    const e = erosion(p.x, p.y, seed);
    const isEdge = Math.abs(Math.abs(s) - ht) < 1e-6;
    const h = isEdge ? y - 0.07 + e * 0.035 : y + 0.015 + e * 0.05;
    return new THREE.Vector3(p.x, h, p.y);
  };
  const n = Math.max(1, Math.round((a1 - a0) / CAP_STEP));
  const ks = Array.from({ length: n + 1 }, (_, k) => a0 + ((a1 - a0) * k) / n);
  for (let k = 0; k < n; k++) {
    const [k0, k1] = [ks[k], ks[k + 1]];
    // Top surface in three strips: slumped edge, raised middle, slumped edge.
    for (let j = 0; j < 3; j++) {
      const lo = offsets[j];
      const hi = offsets[j + 1];
      b.quad(corner(k0, hi, true), corner(k1, hi, true), corner(k1, lo, true), corner(k0, lo, true));
    }
    // The two long faces, from the wall top down to the cap's base.
    b.quad(corner(k0, ht, false), corner(k1, ht, false), corner(k1, ht, true), corner(k0, ht, true));
    b.quad(corner(k1, -ht, false), corner(k0, -ht, false), corner(k0, -ht, true), corner(k1, -ht, true));
  }
  // Close both ends of the run.
  for (const [a, dir] of [
    [a0, -1],
    [a1, 1],
  ] as const) {
    const pts = offsets.map((s) => [corner(a, s, false), corner(a, s, true)] as const);
    for (let j = 0; j < 3; j++) {
      const [lb, lt] = pts[j];
      const [hb, htop] = pts[j + 1];
      // Same winding as prism(): low-to-high across at the start, high-to-low at the end.
      if (dir < 0) b.quad(lb, hb, htop, lt);
      else b.quad(hb, lb, lt, htop);
    }
  }
}

/** One set of builders per material; many buildings can be added before building meshes. */
export interface BuildingBuilders {
  plaster: MeshBuilder;
  brick: MeshBuilder;
  roof: MeshBuilder;
  timber: MeshBuilder;
  /** Window and vent openings: a dark, shadowed recess. */
  dark: MeshBuilder;
  /** Reed matting for sunshades. */
  reed: MeshBuilder;
  /** Small timber details (beam-ends, window lintels, bands, frames, ladders, poles): drawn only up close. */
  detail: MeshBuilder;
}

export function createBuilders(): BuildingBuilders {
  return {
    plaster: new MeshBuilder(2.4),
    brick: new MeshBuilder(1.6),
    roof: new MeshBuilder(3.0),
    timber: new MeshBuilder(1.0),
    dark: new MeshBuilder(1.0),
    reed: new MeshBuilder(1.2),
    detail: new MeshBuilder(1.0),
  };
}

/** Which builder uses which material; detail layers are hidden at a distance and cast no shadows. */
export function builderLayers(b: BuildingBuilders, mats: Materials) {
  return [
    { builder: b.plaster, material: mats.plaster, detail: false },
    { builder: b.brick, material: mats.bakedBrick, detail: false },
    { builder: b.roof, material: mats.mudRoof, detail: false },
    { builder: b.timber, material: mats.timber, detail: false },
    { builder: b.reed, material: mats.reed, detail: false },
    { builder: b.dark, material: mats.opening, detail: true },
    { builder: b.detail, material: mats.timber, detail: true },
  ];
}

export function layerMesh(layer: ReturnType<typeof builderLayers>[number], shadows = true): THREE.Mesh | null {
  if (layer.builder.empty) return null;
  const mesh = new THREE.Mesh(layer.builder.build(), layer.material);
  mesh.castShadow = shadows && !layer.detail;
  mesh.receiveShadow = true;
  mesh.userData.detail = layer.detail;
  return mesh;
}

/** Meshes for whatever has been added to the builders, in world coordinates. */
export function meshesFrom(b: BuildingBuilders, mats: Materials, shadows = true): THREE.Mesh[] {
  return builderLayers(b, mats)
    .map((l) => layerMesh(l, shadows))
    .filter((m): m is THREE.Mesh => m !== null);
}

export function buildBuilding(spec: BuildingSpec, mats: Materials): BuiltObject {
  const b = createBuilders();
  const colliders = addBuilding(spec, b);
  const group = new THREE.Group();
  group.name = spec.id;
  group.userData = { evidence: spec.evidence, note: spec.note };
  group.add(...meshesFrom(b, mats));
  return { group, colliders };
}

/** Adds one building's geometry to shared builders (in world space) and returns its wall colliders. */
export function addBuilding(spec: BuildingSpec, builders: BuildingBuilders): ColliderBox[] {
  const { plaster, brick, roof, timber, dark, reed, detail } = builders;
  const rotation = THREE.MathUtils.degToRad(spec.rotation ?? 0);
  const world = new THREE.Matrix4().compose(
    new THREE.Vector3(spec.position[0], 0, spec.position[1]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
    new THREE.Vector3(1, 1, 1),
  );
  for (const m of [plaster, brick, roof, timber, dark, reed, detail]) {
    m.transform = world;
    m.shade = spec.shade ?? 1;
  }
  const colliders: ColliderBox[] = [];

  const ht = spec.thickness / 2;
  const seed = seedFrom(spec.id);

  for (const wall of spec.walls) {
    const from = new THREE.Vector2(...wall.from);
    const to = new THREE.Vector2(...wall.to);
    const length = from.distanceTo(to);
    const along = to.clone().sub(from).normalize();
    const height = wall.height ?? spec.wallHeight;
    const base = wall.base ?? 0;
    const capAbove = wall.capAbove ?? spec.roofHeight;
    const doors = [...(wall.doors ?? [])].sort((a, b) => a.at - b.at);

    // Extend past both ends by half a thickness so corners and T-junctions close up.
    const start = -ht;
    const end = length + ht;

    // Solid runs between doors, full height.
    let cursor = start;
    const runs: [number, number, number, number][] = []; // a0, a1, y0, y1
    for (const d of doors) {
      const d0 = d.at - d.width / 2;
      const d1 = d.at + d.width / 2;
      if (d0 > cursor) runs.push([cursor, d0, base, height]);
      runs.push([d0, d1, base + d.height, height]); // wall above the doorway
      cursor = d1;

      // Palm-log lintel, a touch proud of the wall face so it reads.
      timber.prism(
        footprint(from, along, d0 - 0.2, d1 + 0.2, ht + 0.03, base + d.height),
        footprint(from, along, d0 - 0.2, d1 + 0.2, ht + 0.03, base + d.height + LINTEL_DEPTH),
      );
      if (d.frame) {
        slab(detail, from, along, d0 - 0.13, d0, -ht - 0.05, -ht + 0.05, base, base + d.height);
        slab(detail, from, along, d1, d1 + 0.13, -ht - 0.05, -ht + 0.05, base, base + d.height);
      }

      if (d.leaf) {
        // Hung on the inside face (+across is inside for walls listed counter-clockwise).
        const across = new THREE.Vector2(-along.y, along.x);
        const theta = THREE.MathUtils.degToRad(d.leaf.open);
        const sign = d.leaf.hinge === 'start' ? 1 : -1;
        const hingeAt = d.leaf.hinge === 'start' ? d0 : d1;
        const hinge = from.clone().addScaledVector(along, hingeAt).addScaledVector(across, ht - LEAF_THICKNESS);
        const lb = base;
        const dir = along.clone().multiplyScalar(sign * Math.cos(theta)).addScaledVector(across, Math.sin(theta)).normalize();
        const w = d.width - 0.04;
        timber.prism(
          footprint(hinge, dir, 0, w, LEAF_THICKNESS / 2, lb + 0.02),
          footprint(hinge, dir, 0, w, LEAF_THICKNESS / 2, lb + d.height - 0.03),
        );
      }
    }
    if (end > cursor) runs.push([cursor, end, base, height]);

    for (const [a0, a1, y0, y1] of runs) {
      // Baked-brick footing, slightly thicker so it casts a shadow line.
      if (y0 < spec.footingHeight) {
        const fy1 = Math.min(y1, spec.footingHeight);
        brick.prism(footprint(from, along, a0, a1, ht + 0.025, y0), footprint(from, along, a0, a1, ht + 0.025, fy1));
      }
      if (y1 > spec.footingHeight) {
        const py0 = Math.max(y0, spec.footingHeight);
        // Only tops that stand clear of the roofs are seen, so only those get eroded caps.
        const capped = y1 > capAbove;
        const top = capped ? y1 - CAP_DEPTH : y1;
        plaster.prism(footprint(from, along, a0, a1, ht, py0), footprint(from, along, a0, a1, ht, top));
        if (capped) erodedCap(plaster, from, along, a0, a1, ht, y1, seed);
      }
      if (wall.outer && spec.details) addDetails(spec, builders, from, along, a0, a1, y0 === base, base, capAbove, ht);
      // Upper-storey walls are out of reach, so they need no physics.
      if (base > 0) continue;
      const mid = from.clone().addScaledVector(along, (a0 + a1) / 2);
      colliders.push({
        center: new THREE.Vector3(mid.x, (y0 + y1) / 2, mid.y),
        halfExtents: new THREE.Vector3((a1 - a0) / 2, (y1 - y0) / 2, ht),
        rotationY: -Math.atan2(along.y, along.x),
      });
    }
  }

  for (const r of spec.roofs ?? []) {
    const [x0, z0, x1, z1] = r.rect;
    const rh = r.height ?? spec.roofHeight;
    roof.prism(rectCorners(x0, z0, x1, z1, rh - ROOF_THICKNESS), rectCorners(x0, z0, x1, z1, rh), false);
  }

  for (const f of spec.floors ?? []) {
    const [x0, z0, x1, z1] = f.rect;
    brick.prism(rectCorners(x0, z0, x1, z1, 0), rectCorners(x0, z0, x1, z1, PAVING_HEIGHT));
  }

  for (const a of spec.awnings ?? []) addAwning(detail, reed, a.rect, a.base);
  for (const l of spec.ladders ?? []) addLadder(detail, l.foot, l.top, l.height);

  for (const m of [plaster, brick, roof, timber, dark, reed, detail]) {
    m.transform = null;
    m.shade = 1;
  }
  for (const c of colliders) {
    c.center.applyMatrix4(world);
    c.rotationY += rotation;
  }
  return colliders;
}

/** A box against a wall line: `a` along the wall, `s` across it (+ is inside), `y` up. */
function slab(b: MeshBuilder, from: THREE.Vector2, along: THREE.Vector2, a0: number, a1: number, s0: number, s1: number, y0: number, y1: number) {
  const across = new THREE.Vector2(-along.y, along.x);
  const at = (a: number, s: number, y: number) => {
    const p = from.clone().addScaledVector(along, a).addScaledVector(across, s);
    return new THREE.Vector3(p.x, y, p.y);
  };
  b.prism([at(a0, s1, y0), at(a1, s1, y0), at(a1, s0, y0), at(a0, s0, y0)], [at(a0, s1, y1), at(a1, s1, y1), at(a1, s0, y1), at(a0, s0, y1)], false);
}

/** Beam-ends, windows and a timber band on one run of an outside wall (outside is -across). */
function addDetails(
  spec: BuildingSpec,
  b: BuildingBuilders,
  from: THREE.Vector2,
  along: THREE.Vector2,
  a0: number,
  a1: number,
  fullHeight: boolean,
  base: number,
  roofLine: number,
  ht: number,
) {
  const d = spec.details!;
  const inner0 = a0 + ht + 0.4;
  const inner1 = a1 - ht - 0.4;
  if (d.beams) {
    const y = roofLine - 0.32;
    for (let a = inner0 + 0.2; a < inner1; a += 1.15) slab(b.detail, from, along, a - 0.08, a + 0.08, -ht - 0.3, -ht + 0.05, y, y + 0.16);
  }
  if (!fullHeight) return;
  if (d.band !== undefined) slab(b.detail, from, along, a0 + 0.02, a1 - 0.02, -ht - 0.035, -ht + 0.02, base + d.band, base + d.band + 0.12);
  for (const wy of d.windows ?? []) {
    const y = base + wy;
    if (y + 0.55 > roofLine - 0.35) continue;
    for (let a = inner0 + 0.9; a < inner1 - 0.5; a += 3.1) {
      slab(b.dark, from, along, a - 0.19, a + 0.19, -ht - 0.006, -ht + 0.03, y, y + 0.42);
      slab(b.detail, from, along, a - 0.3, a + 0.3, -ht - 0.05, -ht + 0.02, y + 0.42, y + 0.52);
    }
  }
}

/** Four poles and a sagging reed mat, on a roof at height `base`. */
function addAwning(timber: MeshBuilder, reed: MeshBuilder, r: [number, number, number, number], base: number) {
  const [x0, z0, x1, z1] = r;
  const hFront = base + 1.8;
  const hBack = base + 2.05;
  const pole = (x: number, z: number, h: number) =>
    timber.prism(rectCorners(x - 0.04, z - 0.04, x + 0.04, z + 0.04, base), rectCorners(x - 0.04, z - 0.04, x + 0.04, z + 0.04, h), false);
  pole(x0, z0, hBack);
  pole(x1, z0, hBack);
  pole(x0, z1, hFront);
  pole(x1, z1, hFront);
  const mid = (z0 + z1) / 2;
  const sag = (hFront + hBack) / 2 - 0.12;
  const P = (x: number, z: number, y: number) => new THREE.Vector3(x, y, z);
  // Two quads per side so the mat sags in the middle; both windings so it shows from below.
  for (const [za, ya, zb, yb] of [
    [z0, hBack, mid, sag],
    [mid, sag, z1, hFront],
  ] as const) {
    reed.quad(P(x0, zb, yb), P(x1, zb, yb), P(x1, za, ya), P(x0, za, ya));
    reed.quad(P(x0, za, ya), P(x1, za, ya), P(x1, zb, yb), P(x0, zb, yb));
  }
}

/** Two rails and rungs from a foot on the ground to the top of a wall. */
function addLadder(timber: MeshBuilder, foot: XZ, top: XZ, height: number) {
  const f = new THREE.Vector2(...foot);
  const t = new THREE.Vector2(...top);
  const dir = t.clone().sub(f).normalize();
  const side = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(0.22);
  const box = (c: THREE.Vector2, y: number, r: number) => rectCorners(c.x - r, c.y - r, c.x + r, c.y + r, y);
  for (const s of [1, -1]) {
    const fb = f.clone().addScaledVector(side, s);
    const tb = t.clone().addScaledVector(side, s);
    timber.prism(box(fb, 0, 0.035), box(tb, height, 0.035), false);
  }
  for (let y = 0.3; y < height - 0.1; y += 0.32) {
    const c = f.clone().lerp(t, y / height);
    const a = c.clone().add(side);
    const b = c.clone().sub(side);
    const rung = b.clone().sub(a).normalize();
    timber.prism(footprint(a, rung, 0, a.distanceTo(b), 0.025, y), footprint(a, rung, 0, a.distanceTo(b), 0.025, y + 0.04), false);
  }
}

export interface ZigguratSpec {
  position: XZ;
  rotation?: number;
  /** Bottom-up terraces: footprint size and height of each. */
  terraces: { width: number; depth: number; height: number; batter: number }[];
  evidence: Evidence;
}

/**
 * Stepped, battered terraces with the shallow buttresses that broke up each face.
 * The first terrace's dimensions are well established; upper terraces are reconstruction.
 */
/** The central stairway, shared with the physics so players can climb to the first terrace. */
export const ZIGGURAT_STAIR = { halfWidth: 3.5, run: 34 };

export function buildZiggurat(spec: ZigguratSpec, mats: Materials): THREE.Group {
  const brick = new MeshBuilder(2.2);
  let y = 0;
  for (const t of spec.terraces) {
    const hw = t.width / 2;
    const hd = t.depth / 2;
    brick.prism(rectCorners(-hw, -hd, hw, hd, y), rectCorners(-hw + t.batter, -hd + t.batter, hw - t.batter, hd - t.batter, y + t.height));

    // Shallow buttresses on the long faces, leaning back with the batter.
    const count = Math.floor(t.width / 4.5);
    for (let i = 1; i < count; i++) {
      const x = -hw + (i * t.width) / count;
      for (const side of [-1, 1]) {
        const inner = side * (hd - 0.1);
        const outer = side * (hd + 0.35);
        const shift = -side * t.batter * 0.98;
        const [zb0, zb1] = [Math.min(inner, outer), Math.max(inner, outer)];
        brick.prism(
          rectCorners(x - 0.6, zb0, x + 0.6, zb1, y),
          rectCorners(x - 0.6, zb0 + shift, x + 0.6, zb1 + shift, y + t.height * 0.98),
        );
      }
    }
    y += t.height;
  }

  // Central stairway up the front face to the first terrace, as a sloped wedge.
  const first = spec.terraces[0];
  const sw = ZIGGURAT_STAIR.halfWidth;
  const front = first.depth / 2;
  const run = ZIGGURAT_STAIR.run;
  brick.prism(rectCorners(-sw, front - 1, sw, front + run, 0), [
    new THREE.Vector3(-sw, 0.25, front + run),
    new THREE.Vector3(sw, 0.25, front + run),
    new THREE.Vector3(sw, first.height, front - 1),
    new THREE.Vector3(-sw, first.height, front - 1),
  ]);

  const mesh = new THREE.Mesh(brick.build(), mats.bakedBrick);
  mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = 'ziggurat';
  group.userData = { evidence: spec.evidence };
  group.add(mesh);
  group.position.set(spec.position[0], 0, spec.position[1]);
  group.rotation.y = THREE.MathUtils.degToRad(spec.rotation ?? 0);
  return group;
}
