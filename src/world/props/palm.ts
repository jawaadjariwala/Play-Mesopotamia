import * as THREE from 'three/webgpu';
import type { Materials } from '../materials';
import { mulberry32 } from './random';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  /** Dead fronds hanging under the crown (default 6). */
  dead?: number;
  seed: number;
}

const UP = new THREE.Vector3(0, 1, 0);
/**
 * Foliage sits on its own layer. (Skipping it in the AO prepass with PassNode.setLayers
 * crashed three r186's render list, so for now the layer is only bookkeeping.)
 */
export const FOLIAGE_LAYER = 1;
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

  const total = shape.fronds + (shape.dead ?? 6);
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

    // Far palms have fewer, wider leaflets that catch more light; darken them so they match.
    const farDim = shape.far ? 0.72 : 1;
    const tint = (dead ? DEAD : LIVE.clone().lerp(OLD, Math.max(0, age - 0.55) * 1.6)).clone().multiplyScalar(farDim);
    const tipTint = (dead ? DEAD : LIVE_TIP).clone().multiplyScalar(farDim);

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
/** Even lighter far palms for inside the city, where there are hundreds of them. */
const CITY_FAR_SHAPES: PalmShape[] = [
  { height: 10, lean: 0.8, fronds: 12, pairs: 5, leafWidth: 0.2, far: true, seed: 61 },
  { height: 13, lean: 1.4, fronds: 12, pairs: 5, leafWidth: 0.2, far: true, seed: 67 },
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
  impostor?: PalmImpostor,
  heightAt: (x: number, z: number) => number = () => 0,
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
        mesh.layers.set(FOLIAGE_LAYER);
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
      pos.y = heightAt(pos.x, pos.z) - 0.1;
      const rot = new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2);
      const sc = 0.8 + rand() * 0.45;
      matrices.push(new THREE.Matrix4().compose(pos, rot, new THREE.Vector3(sc, sc, sc)));
    }
    const near = instanced(nearGeoms, matrices, true);
    const far = impostor ? (() => {
      const g = new THREE.Group();
      g.add(impostorMesh(impostor, matrices));
      return g;
    })() : instanced(farGeoms, matrices, false);
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

/**
 * Palms inside the city (canal banks, squares, gardens). All of them are drawn with the
 * cheap far shapes in one instanced set; the ones near the player move into a small pool
 * of detailed, shadow-casting palms. Moving slots around never creates GPU objects.
 */
export class CityPalms {
  readonly group = new THREE.Group();
  private far: { meshes: THREE.InstancedMesh[]; slot: number }[] = [];
  private nearMeshes: THREE.InstancedMesh[][] = [];
  private nearFree: number[][] = [];
  private nearSlot = new Map<number, number>();
  private matrices: THREE.Matrix4[];
  private lastUpdate = -Infinity;
  private static readonly HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
  private static readonly NEAR = 60;

  constructor(
    private points: [number, number][],
    mats: Materials,
    impostor?: PalmImpostor,
    seed = 21,
  ) {
    this.group.name = 'city-palms';
    const rand = mulberry32(seed);
    this.matrices = points.map(([x, z]) => {
      const rot = new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2);
      const s = 0.8 + rand() * 0.4;
      return new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), rot, new THREE.Vector3(s, s, s));
    });
    const make = (shapes: PalmShape[], counts: number[], shadows: boolean) =>
      shapes.map((shape, si) =>
        [
          [trunkGeometry(shape), mats.bark],
          [frondGeometry(shape), mats.frond],
        ].map(([g, m]) => {
          const mesh = new THREE.InstancedMesh(g as THREE.BufferGeometry, m as THREE.Material, Math.max(1, counts[si]));
          mesh.castShadow = shadows;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
          mesh.layers.set(FOLIAGE_LAYER);
          this.group.add(mesh);
          return mesh;
        }),
      );
    // Far: every palm, as a cut-out card when we have one, otherwise a light 3D palm.
    if (impostor) {
      const mesh = impostorMesh(impostor, this.matrices);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      points.forEach((_, i) => this.far.push({ meshes: [mesh], slot: i }));
    } else {
      const farCounts = CITY_FAR_SHAPES.map((_, si) => points.filter((_, i) => i % CITY_FAR_SHAPES.length === si).length);
      const farMeshes = make(CITY_FAR_SHAPES, farCounts, false);
      const used = CITY_FAR_SHAPES.map(() => 0);
      points.forEach((_, i) => {
        const si = i % CITY_FAR_SHAPES.length;
        const slot = used[si]++;
        for (const m of farMeshes[si]) m.setMatrixAt(slot, this.matrices[i]);
        this.far.push({ meshes: farMeshes[si], slot });
      });
    }
    // Near: a fixed pool per shape.
    const POOL = 60;
    this.nearMeshes = make(NEAR_SHAPES, NEAR_SHAPES.map(() => POOL), true);
    for (const meshes of this.nearMeshes)
      for (const m of meshes) {
        for (let i = 0; i < POOL; i++) m.setMatrixAt(i, CityPalms.HIDDEN);
        m.count = 0;
      }
    this.nearFree = NEAR_SHAPES.map(() => Array.from({ length: POOL }, (_, i) => POOL - 1 - i));
  }

  /** Swap palms between the far set and the detailed pool, a couple of times a second. */
  update(x: number, z: number) {
    const now = performance.now();
    if (now - this.lastUpdate < 400) return;
    this.lastUpdate = now;
    const dirty = new Set<THREE.InstancedMesh>();
    this.points.forEach(([px, pz], i) => {
      const near = Math.hypot(px - x, pz - z) < CityPalms.NEAR;
      const has = this.nearSlot.has(i);
      if (near === has) return;
      const si = i % NEAR_SHAPES.length;
      const far = this.far[i];
      if (near) {
        const slot = this.nearFree[si].pop();
        if (slot === undefined) return;
        this.nearSlot.set(i, slot);
        for (const m of this.nearMeshes[si]) (m.setMatrixAt(slot, this.matrices[i]), dirty.add(m));
        for (const m of far.meshes) (m.setMatrixAt(far.slot, CityPalms.HIDDEN), dirty.add(m));
      } else {
        const slot = this.nearSlot.get(i)!;
        this.nearSlot.delete(i);
        this.nearFree[si].push(slot);
        for (const m of this.nearMeshes[si]) (m.setMatrixAt(slot, CityPalms.HIDDEN), dirty.add(m));
        for (const m of far.meshes) (m.setMatrixAt(far.slot, this.matrices[i]), dirty.add(m));
      }
    });
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
    // Only draw the near pool up to its highest occupied slot (low slots are reused first).
    NEAR_SHAPES.forEach((_, si) => {
      this.nearFree[si].sort((a, b) => b - a);
      let top = 0;
      for (const slot of this.nearSlot.values()) top = Math.max(top, slot + 1);
      for (const m of this.nearMeshes[si]) m.count = top;
    });
  }
}

/**
 * A cut-out picture of one detailed palm, rendered once at startup, used on three crossed
 * cards for distant palms: 6 triangles instead of hundreds, and fuller-looking at range.
 */
export interface PalmImpostor {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export function makePalmImpostor(renderer: THREE.WebGPURenderer, mats: Materials): PalmImpostor {
  // Broader leaflets than the 3D palms: at a distance thin leaflets fade out of the cut-out
  // and the palm turns into a bare stick.
  const shape: PalmShape = { height: 9.5, lean: 0, fronds: 30, pairs: 22, leafWidth: 0.3, dead: 0, seed: 77 };
  const W = 12;
  const H = 14.4;
  const scene = new THREE.Scene();
  const palm = new THREE.Group();
  palm.add(new THREE.Mesh(trunkGeometry(shape), mats.bark), new THREE.Mesh(frondGeometry(shape), mats.frond));
  scene.add(palm);
  // Lit like midday in the game: sun from the front and above, warm sky fill.
  const sun = new THREE.DirectionalLight(0xffe6c4, 5.5);
  sun.position.set(2, 6, 5);
  scene.add(sun, new THREE.HemisphereLight(0xcfe0ff, 0x9a8462, 3));
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H - 0.3, -0.3, 0.1, 50);
  cam.position.set(0, 0, 20);
  cam.lookAt(0, 0, 0);
  // No mipmaps: averaging the sparse crown down to small sizes erases the fronds and leaves
  // only the trunk. Without them distant palms keep their crowns (at the cost of a little shimmer).
  const rt = new THREE.RenderTarget(256, Math.round((256 * H) / W), { generateMipmaps: false, minFilter: THREE.LinearFilter });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.toneMapping = prevTone;

  const material = new THREE.MeshBasicNodeMaterial({ map: rt.texture, alphaTest: 0.22, side: THREE.DoubleSide });
  // The captured image comes out upside down (on both backends), so flip the cards to match.
  const flip = true;
  const cards = [0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => {
    const g = new THREE.PlaneGeometry(W, H);
    if (flip) {
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    }
    g.translate(0, H / 2 - 0.3, 0);
    g.rotateY(a);
    return g;
  });
  const geometry = mergeGeometries(cards)!;
  return { geometry, material };
}

/** Instanced cut-out palms at the given placements. */
export function impostorMesh(imp: PalmImpostor, matrices: THREE.Matrix4[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(imp.geometry, imp.material, Math.max(1, matrices.length));
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.layers.set(FOLIAGE_LAYER);
  mesh.computeBoundingSphere();
  return mesh;
}

/** Belts of palms along the river and canal banks, all as cut-out cards. */
export function buildPalmBelt(
  points: [number, number][],
  imp: PalmImpostor,
  heightAt: (x: number, z: number) => number = () => 0,
  seed = 5,
): THREE.InstancedMesh {
  const rand = mulberry32(seed);
  const matrices = points.map(([x, z]) => {
    const s = 0.75 + rand() * 0.5;
    return new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) - 0.1, z), new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2), new THREE.Vector3(s, s, s));
  });
  const mesh = impostorMesh(imp, matrices);
  mesh.name = 'palm-belts';
  return mesh;
}
