import * as THREE from 'three/webgpu';
import type { Materials } from '../materials';
import { mulberry32 } from './random';

/**
 * Wheel-thrown pottery made by spinning a profile, the same way a potter makes it.
 * Profiles are [radius, height] in metres, outside surface first, then a short way
 * back down the inside of the rim so the mouth has thickness.
 */
const PROFILES = {
  // Tall storage jar with a rounded base, often set into the floor or propped against a wall.
  storageJar: [
    [0, 0], [0.07, 0.015], [0.17, 0.09], [0.25, 0.26], [0.275, 0.42], [0.255, 0.58],
    [0.19, 0.7], [0.11, 0.77], [0.095, 0.8], [0.12, 0.84], [0.118, 0.865], [0.09, 0.86], [0.082, 0.8],
  ],
  // Round-bodied cooking pot with a short everted rim.
  cookingPot: [
    [0, 0], [0.09, 0.012], [0.16, 0.06], [0.195, 0.14], [0.185, 0.23], [0.13, 0.29],
    [0.125, 0.305], [0.145, 0.33], [0.138, 0.338], [0.115, 0.31], [0.11, 0.28],
  ],
  // Simple conical bowl.
  bowl: [
    [0, 0], [0.05, 0], [0.13, 0.07], [0.155, 0.105], [0.15, 0.112], [0.125, 0.08], [0.045, 0.012], [0, 0.012],
  ],
} as const;

export type PotType = keyof typeof PROFILES;

export interface PropSpec {
  type: PotType;
  position: [number, number];
  /** Height of the surface it stands on (courtyard paving is 5 cm up). */
  y?: number;
  /** Lean in degrees, for jars propped against a wall. */
  tilt?: number;
  scale?: number;
}

function potGeometry(type: PotType): THREE.BufferGeometry {
  const points = PROFILES[type].map(([r, h]) => new THREE.Vector2(r, h));
  const g = new THREE.LatheGeometry(points, 14);
  // Lathe UVs run 0..1 around and along; stretch them toward real-world size.
  const uvs = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 1.4, uvs.getY(i) * 0.9);
  return g;
}

export function buildPottery(props: PropSpec[], mats: Materials, seed = 3): THREE.Group {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'pottery';
  for (const type of Object.keys(PROFILES) as PotType[]) {
    const mine = props.filter((p) => p.type === type);
    if (mine.length === 0) continue;
    const mesh = new THREE.InstancedMesh(potGeometry(type), mats.pottery, mine.length);
    mine.forEach((p, i) => {
      const yaw = rand() * Math.PI * 2;
      const tilt = THREE.MathUtils.degToRad(p.tilt ?? 0);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ'));
      const s = (p.scale ?? 1) * (0.9 + rand() * 0.2);
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(p.position[0], p.y ?? 0, p.position[1]), rot, new THREE.Vector3(s, s, s)));
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/**
 * One instanced mesh per pot type for the whole city. Streamed blocks borrow slots
 * and give them back, so loading a block never creates new GPU objects (that caused
 * visible hitches while walking).
 */
export class PotteryPool {
  readonly group = new THREE.Group();
  private meshes = new Map<PotType, THREE.InstancedMesh>();
  private free = new Map<PotType, number[]>();
  private used = new Map<PotType, Uint8Array>();
  private static readonly HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(mats: Materials, capacity = 600) {
    this.group.name = 'pottery';
    for (const type of Object.keys(PROFILES) as PotType[]) {
      const mesh = new THREE.InstancedMesh(potGeometry(type), mats.pottery, capacity);
      for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, PotteryPool.HIDDEN);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false; // contents move around the city as blocks stream
      this.meshes.set(type, mesh);
      this.free.set(type, Array.from({ length: capacity }, (_, i) => capacity - 1 - i));
      this.used.set(type, new Uint8Array(capacity));
      mesh.count = 0;
      this.group.add(mesh);
    }
  }

  /** Place pots; returns a handle for remove(). Pots beyond capacity are skipped. */
  add(props: PropSpec[], seed: number): [PotType, number][] {
    const rand = mulberry32(seed);
    const used: [PotType, number][] = [];
    for (const p of props) {
      const slot = this.free.get(p.type)!.pop();
      if (slot === undefined) continue;
      const yaw = rand() * Math.PI * 2;
      const tilt = THREE.MathUtils.degToRad(p.tilt ?? 0);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ'));
      const s = (p.scale ?? 1) * (0.9 + rand() * 0.2);
      const mesh = this.meshes.get(p.type)!;
      mesh.setMatrixAt(slot, new THREE.Matrix4().compose(new THREE.Vector3(p.position[0], p.y ?? 0, p.position[1]), rot, new THREE.Vector3(s, s, s)));
      mesh.instanceMatrix.needsUpdate = true;
      this.used.get(p.type)![slot] = 1;
      used.push([p.type, slot]);
    }
    this.trim();
    return used;
  }

  remove(handle: [PotType, number][]) {
    for (const [type, slot] of handle) {
      const mesh = this.meshes.get(type)!;
      mesh.setMatrixAt(slot, PotteryPool.HIDDEN);
      mesh.instanceMatrix.needsUpdate = true;
      this.used.get(type)![slot] = 0;
      this.free.get(type)!.push(slot);
    }
    // Reuse low slots first so the drawn range stays short.
    for (const f of this.free.values()) f.sort((a, b) => b - a);
    this.trim();
  }

  /** Only draw up to the highest slot in use. */
  private trim() {
    for (const [type, mesh] of this.meshes) {
      const used = this.used.get(type)!;
      let top = used.length;
      while (top > 0 && !used[top - 1]) top--;
      mesh.count = top;
    }
  }
}
