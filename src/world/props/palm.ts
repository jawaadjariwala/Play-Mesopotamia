import * as THREE from 'three/webgpu';
import type { Materials } from '../materials';
import { mulberry32 } from './random';

/**
 * Procedural date palms (Phoenix dactylifera): a ringed, slightly leaning trunk,
 * a crown of grey-green pinnate fronds, and a skirt of dead brown fronds below it.
 * Everything is real geometry, no alpha cut-outs, so it works with shadows and AO.
 */

interface PalmShape {
  height: number;
  lean: number;
  fronds: number;
  /** Leaflet pairs per frond; distant palms use fewer. */
  pairs: number;
  /** Leaflet half-width at its base; distant palms get wider leaflets so the crown still reads. */
  leafWidth: number;
  /** Geometry detail: trunk sides and rachis segments. */
  far?: boolean;
  seed: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const GOLDEN_ANGLE = 2.39996;

const LIVE = new THREE.Color(0x76845a);
const LIVE_TIP = new THREE.Color(0x9aa37a);
const OLD = new THREE.Color(0x8c8452);
const DEAD = new THREE.Color(0x6e5638);

function trunkGeometry(shape: PalmShape): THREE.BufferGeometry {
  const g = shape.far
    ? new THREE.CylinderGeometry(0.2, 0.27, shape.height, 6, 6, true)
    : new THREE.CylinderGeometry(0.2, 0.27, shape.height, 10, Math.round(shape.height * 2.5), true);
  g.translate(0, shape.height / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uvs = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / shape.height;
    // Leaf-base scars make the trunk ridged every 15 cm or so.
    const ridge = 1 + 0.08 * Math.abs(Math.sin(y * Math.PI * 6.5));
    pos.setX(i, pos.getX(i) * ridge + shape.lean * t * t);
    pos.setZ(i, pos.getZ(i) * ridge);
    uvs.setXY(i, uvs.getX(i) * 1.6, y / 1.2);
  }
  g.computeVertexNormals();
  return g;
}

function frondGeometry(shape: PalmShape): THREE.BufferGeometry {
  const rand = mulberry32(shape.seed);
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const sway: number[] = [];
  const crown = new THREE.Vector3(shape.lean, shape.height, 0);

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color, w: [number, number, number]) => {
    // Bend face normals toward the sky so the crown lights softly instead of flickering.
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.y < 0) n.negate();
    n.multiplyScalar(0.35).addScaledVector(UP, 0.65).normalize();
    for (const [p, s] of [
      [a, w[0]],
      [b, w[1]],
      [c, w[2]],
    ] as const) {
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      colors.push(col.r, col.g, col.b);
      sway.push(s);
    }
  };

  const total = shape.fronds + 6;
  for (let i = 0; i < total; i++) {
    const dead = i >= shape.fronds;
    const age = dead ? 1 : i / shape.fronds; // 0 = young and upright, 1 = old and drooping
    const azimuth = i * GOLDEN_ANGLE + rand() * 0.3;
    const elevation = dead
      ? THREE.MathUtils.degToRad(-72 - rand() * 12)
      : THREE.MathUtils.degToRad(68 - age * 95 + (rand() - 0.5) * 12);
    const length = dead ? 2.2 + rand() * 0.6 : 2.6 + (1 - Math.abs(age - 0.5)) * 1.4 + rand() * 0.5;
    const droop = dead ? 0.01 : 0.05 + age * 0.07;
    const out = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const base = crown.clone().addScaledVector(out, 0.15);

    const at = (t: number) =>
      base
        .clone()
        .addScaledVector(out, length * t * Math.cos(elevation))
        .addScaledVector(UP, length * t * Math.sin(elevation) - droop * (length * t) ** 2);

    const tint = dead ? DEAD : LIVE.clone().lerp(OLD, Math.max(0, age - 0.55) * 1.6);
    const tipTint = dead ? DEAD : LIVE_TIP;

    // Rachis: a thin tapering ribbon.
    const segments = shape.far ? 4 : 10;
    for (let s = 0; s < segments; s++) {
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      const p0 = at(t0);
      const p1 = at(t1);
      const side = new THREE.Vector3().subVectors(p1, p0).cross(UP).normalize();
      const w0 = 0.05 * (1 - t0 * 0.8);
      const w1 = 0.05 * (1 - t1 * 0.8);
      const a = p0.clone().addScaledVector(side, w0);
      const b = p0.clone().addScaledVector(side, -w0);
      const c = p1.clone().addScaledVector(side, -w1);
      const d = p1.clone().addScaledVector(side, w1);
      pushTri(a, b, c, tint, [t0, t0, t1]);
      pushTri(a, c, d, tint, [t0, t1, t1]);
    }

    // Leaflets in pairs, forming a shallow V along the rachis.
    const pairs = dead ? Math.round(shape.pairs * 0.5) : shape.pairs;
    for (let k = 0; k < pairs; k++) {
      const t = 0.22 + (0.76 * k) / pairs;
      const p = at(t);
      const tangent = at(Math.min(1, t + 0.02)).sub(p).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, UP).normalize();
      const leafLen = (dead ? 0.4 : 0.78) * Math.sqrt(Math.sin(Math.PI * Math.min(0.98, t + 0.05))) * (0.85 + rand() * 0.3);
      const colour = tint.clone().lerp(tipTint, t * 0.6);
      for (const dirSign of [-1, 1]) {
        const dir = side
          .clone()
          .multiplyScalar(dirSign * 0.82)
          .addScaledVector(tangent, 0.5)
          .addScaledVector(UP, dead ? -0.1 : 0.22)
          .normalize();
        const tip = p.clone().addScaledVector(dir, leafLen).addScaledVector(UP, -0.12 * leafLen);
        const w = shape.leafWidth;
        const a = p.clone().addScaledVector(tangent, -w);
        const b = p.clone().addScaledVector(tangent, w);
        const c = tip.clone().addScaledVector(tangent, w * 0.15);
        pushTri(a, b, c, colour, [t, t, Math.min(1, t + 0.15)]);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.computeBoundingSphere();
  return g;
}

export interface GroveSpec {
  center: [number, number];
  radius: number;
  count: number;
}

const NEAR_SHAPES: PalmShape[] = [
  { height: 9, lean: 0.6, fronds: 30, pairs: 30, leafWidth: 0.05, seed: 11 },
  { height: 12, lean: 1.3, fronds: 28, pairs: 30, leafWidth: 0.05, seed: 23 },
  { height: 7, lean: 0.3, fronds: 32, pairs: 30, leafWidth: 0.05, seed: 37 },
];
const FAR_SHAPES: PalmShape[] = [
  { height: 10, lean: 0.8, fronds: 16, pairs: 7, leafWidth: 0.16, far: true, seed: 41 },
  { height: 13, lean: 1.5, fronds: 15, pairs: 7, leafWidth: 0.16, far: true, seed: 53 },
];
/** A grove switches to full-detail palms when the player is this close to its edge. */
const NEAR_DISTANCE = 110;

export interface Palms {
  group: THREE.Group;
  update(x: number, z: number): void;
}

/**
 * Every grove has a cheap far version (always there) and a detailed near version
 * (shown, with shadows, only when the player is close). Geometry is shared across groves.
 */
export function buildPalms(
  groves: GroveSpec[],
  mats: Materials,
  exclude?: (x: number, z: number) => boolean,
  seed = 7,
): Palms {
  const rand = mulberry32(seed);
  const geoms = (shapes: PalmShape[]) => shapes.map((s) => [trunkGeometry(s), frondGeometry(s)] as const);
  const nearGeoms = geoms(NEAR_SHAPES);
  const farGeoms = geoms(FAR_SHAPES);
  const group = new THREE.Group();
  group.name = 'palms';
  const entries: { grove: GroveSpec; near: THREE.Group; far: THREE.Group }[] = [];

  const instanced = (pairs: (readonly [THREE.BufferGeometry, THREE.BufferGeometry])[], matrices: THREE.Matrix4[], shadows: boolean) => {
    const out = new THREE.Group();
    pairs.forEach(([trunk, fronds], si) => {
      const mine = matrices.filter((_, i) => i % pairs.length === si);
      if (mine.length === 0) return;
      for (const [geometry, material] of [
        [trunk, mats.bark],
        [fronds, mats.frond],
      ] as const) {
        const mesh = new THREE.InstancedMesh(geometry, material, mine.length);
        mine.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        out.add(mesh);
      }
    });
    return out;
  };

  for (const grove of groves) {
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < grove.count; i++) {
      const r = grove.radius * Math.sqrt(rand());
      const a = rand() * Math.PI * 2;
      const pos = new THREE.Vector3(grove.center[0] + Math.cos(a) * r, 0, grove.center[1] + Math.sin(a) * r);
      // Palms grow on the banks, not in the water or on the city wall.
      if (exclude?.(pos.x, pos.z)) continue;
      const rot = new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2);
      const sc = 0.8 + rand() * 0.45;
      matrices.push(new THREE.Matrix4().compose(pos, rot, new THREE.Vector3(sc, sc, sc)));
    }
    const near = instanced(nearGeoms, matrices, true);
    const far = instanced(farGeoms, matrices, false);
    near.visible = false;
    group.add(near, far);
    entries.push({ grove, near, far });
  }

  return {
    group,
    update(x, z) {
      for (const e of entries) {
        const d = Math.hypot(x - e.grove.center[0], z - e.grove.center[1]) - e.grove.radius;
        const close = d < NEAR_DISTANCE;
        e.near.visible = close;
        e.far.visible = !close;
      }
    },
  };
}
