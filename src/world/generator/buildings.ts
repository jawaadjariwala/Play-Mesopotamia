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
}

export interface WallSpec {
  from: XZ;
  to: XZ;
  /** Overrides the building's wall height (parapets, low courtyard walls). */
  height?: number;
  doors?: DoorSpec[];
}

export interface RoofSpec {
  /** Axis-aligned [x0, z0, x1, z1] in building coordinates. */
  rect: [number, number, number, number];
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
}

/** Oriented box for the physics world (Phase 1). */
export interface ColliderBox {
  center: THREE.Vector3;
  halfExtents: THREE.Vector3;
  rotationY: number;
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
const CAP_STEP = 0.3;
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
  for (let k = 0; k < n; k++) {
    const k0 = a0 + ((a1 - a0) * k) / n;
    const k1 = a0 + ((a1 - a0) * (k + 1)) / n;
    for (let j = 0; j < 3; j++) {
      const lo = offsets[j];
      const hi = offsets[j + 1];
      const quad = (top: boolean) => [corner(k0, hi, top), corner(k1, hi, top), corner(k1, lo, top), corner(k0, lo, top)];
      b.prism(quad(false), quad(true));
    }
  }
}

export function buildBuilding(spec: BuildingSpec, mats: Materials): BuiltObject {
  const plaster = new MeshBuilder(2.4);
  const brick = new MeshBuilder(1.6);
  const roof = new MeshBuilder(3.0);
  const timber = new MeshBuilder(1.0);
  const colliders: ColliderBox[] = [];

  const ht = spec.thickness / 2;
  const seed = seedFrom(spec.id);

  for (const wall of spec.walls) {
    const from = new THREE.Vector2(...wall.from);
    const to = new THREE.Vector2(...wall.to);
    const length = from.distanceTo(to);
    const along = to.clone().sub(from).normalize();
    const height = wall.height ?? spec.wallHeight;
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
      if (d0 > cursor) runs.push([cursor, d0, 0, height]);
      runs.push([d0, d1, d.height, height]); // wall above the doorway
      cursor = d1;

      // Palm-log lintel, a touch proud of the wall face so it reads.
      timber.prism(
        footprint(from, along, d0 - 0.2, d1 + 0.2, ht + 0.03, d.height),
        footprint(from, along, d0 - 0.2, d1 + 0.2, ht + 0.03, d.height + LINTEL_DEPTH),
      );

      if (d.leaf) {
        // Hung on the inside face (+across is inside for walls listed counter-clockwise).
        const across = new THREE.Vector2(-along.y, along.x);
        const theta = THREE.MathUtils.degToRad(d.leaf.open);
        const sign = d.leaf.hinge === 'start' ? 1 : -1;
        const hingeAt = d.leaf.hinge === 'start' ? d0 : d1;
        const hinge = from.clone().addScaledVector(along, hingeAt).addScaledVector(across, ht - LEAF_THICKNESS);
        const dir = along.clone().multiplyScalar(sign * Math.cos(theta)).addScaledVector(across, Math.sin(theta)).normalize();
        const w = d.width - 0.04;
        timber.prism(
          footprint(hinge, dir, 0, w, LEAF_THICKNESS / 2, 0.02),
          footprint(hinge, dir, 0, w, LEAF_THICKNESS / 2, d.height - 0.03),
        );
      }
    }
    if (end > cursor) runs.push([cursor, end, 0, height]);

    for (const [a0, a1, y0, y1] of runs) {
      // Baked-brick footing, slightly thicker so it casts a shadow line.
      if (y0 < spec.footingHeight) {
        const fy1 = Math.min(y1, spec.footingHeight);
        brick.prism(footprint(from, along, a0, a1, ht + 0.025, y0), footprint(from, along, a0, a1, ht + 0.025, fy1));
      }
      if (y1 > spec.footingHeight) {
        const py0 = Math.max(y0, spec.footingHeight);
        // Only tops that stand clear of the roofs are seen, so only those get eroded caps.
        const capped = y1 > spec.roofHeight;
        const top = capped ? y1 - CAP_DEPTH : y1;
        plaster.prism(footprint(from, along, a0, a1, ht, py0), footprint(from, along, a0, a1, ht, top));
        if (capped) erodedCap(plaster, from, along, a0, a1, ht, y1, seed);
      }
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
    roof.prism(
      rectCorners(x0, z0, x1, z1, spec.roofHeight - ROOF_THICKNESS),
      rectCorners(x0, z0, x1, z1, spec.roofHeight),
      false,
    );
    colliders.push({
      center: new THREE.Vector3((x0 + x1) / 2, spec.roofHeight - ROOF_THICKNESS / 2, (z0 + z1) / 2),
      halfExtents: new THREE.Vector3((x1 - x0) / 2, ROOF_THICKNESS / 2, (z1 - z0) / 2),
      rotationY: 0,
    });
  }

  for (const f of spec.floors ?? []) {
    const [x0, z0, x1, z1] = f.rect;
    brick.prism(rectCorners(x0, z0, x1, z1, 0), rectCorners(x0, z0, x1, z1, PAVING_HEIGHT));
  }

  const group = new THREE.Group();
  group.name = spec.id;
  group.userData = { evidence: spec.evidence, note: spec.note };
  for (const [builder, mat] of [
    [plaster, mats.plaster],
    [brick, mats.bakedBrick],
    [roof, mats.mudRoof],
    [timber, mats.timber],
  ] as const) {
    if (builder.empty) continue;
    const mesh = new THREE.Mesh(builder.build(), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  group.position.set(spec.position[0], 0, spec.position[1]);
  group.rotation.y = THREE.MathUtils.degToRad(spec.rotation ?? 0);
  return { group, colliders };
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
  const sw = 3.5;
  const front = first.depth / 2;
  const run = 34;
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
