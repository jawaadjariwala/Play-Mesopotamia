import * as THREE from 'three/webgpu';
import type { Materials } from '../materials';
import { MeshBuilder, rectCorners } from '../generator/meshBuilder';
import { addBuilding, builderLayers, createBuilders, layerMesh, type ColliderBox } from '../generator/buildings';
import { PotteryPool, type PotType, type PropSpec } from '../props/pottery';
import { attribute, float, int, positionLocal, uniformArray } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { generateBlocks, houseForPlot, type Block, type House } from './layout';
import { distanceToRect, type Rect } from './plan';

/** Massing is merged per sector of SECTOR x SECTOR blocks, keeping far draw calls low. */
const SECTOR = 4;


/** Blocks closer than this are built in full detail; farther ones fall back to massing. */
const LOAD_RADIUS = 75;
/** Hysteresis so a block on the boundary doesn't rebuild every step. */
const UNLOAD_RADIUS = 95;

export interface ColliderSink {
  add(boxes: ColliderBox[]): unknown;
  remove(handle: unknown): void;
}

interface Job {
  id: number;
  k: number;
  builders: ReturnType<typeof createBuilders>;
  colliders: ColliderBox[];
  props: PropSpec[];
  /** Mesh building happens one material layer per step, after all houses are added. */
  layers?: ReturnType<typeof builderLayers>;
  meshes: THREE.Mesh[];
}

/** Small details (beam-ends, windows, ladders) are only drawn within this distance of a block. */
const DETAIL_RADIUS = 40;

function disposeGroup(group: THREE.Group) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
}

interface Loaded {
  group: THREE.Group;
  colliders: unknown;
  pots: [PotType, number][];
  /** Whether detail meshes are currently shown. */
  near: boolean;
}

function tagBlock(g: THREE.BufferGeometry, id: number): THREE.BufferGeometry {
  g.setAttribute('blockId', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(id), 1));
  return g;
}

/**
 * Streams the residential city around the player.
 *
 * Far: every block exists all the time as low-detail massing (outer walls, roofs and
 * the court opening), merged per sector, so the skyline is complete from anywhere.
 * Near: blocks within LOAD_RADIUS are generated in full detail and get physics, a few
 * milliseconds per frame so walking never stalls. A block's massing is hidden while its
 * detailed version is loaded.
 */
export class CityStreamer {
  readonly group = new THREE.Group();
  readonly blocks: Block[];
  private houses: House[][];
  private hidden!: ReturnType<typeof uniformArray>;
  readonly pottery: PotteryPool;
  private loaded = new Map<number, Loaded>();
  /** Milliseconds spent building in the last update, for the stats overlay. */
  lastBuildMs = 0;
  /** Slowest single operations seen, for profiling streaming hitches. */
  readonly worst = { house: 0, finish: 0, attach: 0, colliders: 0 };
  private job: Job | null = null;
  private attaching = new Set<number>();
  private lastX = 0;
  private lastZ = 0;
  /** Optional async pipeline warm-up (renderer.compileAsync) before a block appears. */
  compile: ((group: THREE.Group) => Promise<unknown>) | null = null;

  constructor(
    private mats: Materials,
    private physics: ColliderSink,
  ) {
    this.group.name = 'city';
    this.blocks = generateBlocks();
    this.houses = this.blocks.map((b) => b.plots.map((p, k) => houseForPlot(p, `house-${b.i}-${b.j}-${k}`)));
    this.pottery = new PotteryPool(mats);
    this.group.add(this.pottery.group);
    this.buildMassing();
  }

  private setHidden(id: number, value: number) {
    (this.hidden.array as number[])[id] = value;
  }

  get houseCount() {
    return this.houses.reduce((n, h) => n + h.length, 0);
  }

  get loadedCount() {
    return this.loaded.size;
  }

  private buildMassing() {
    // Massing materials are clones whose vertices collapse when their block is shown in full detail.
    this.hidden = uniformArray(new Array(this.blocks.length).fill(0), 'float');
    const hide = (m: THREE.MeshStandardNodeMaterial) => {
      const c = m.clone();
      const shown = float(1).sub(this.hidden.element(int(attribute('blockId', 'float'))) as unknown as ReturnType<typeof float>);
      c.positionNode = positionLocal.mul(shown);
      return c;
    };
    const wallMat = hide(this.mats.plaster);
    const roofMat = hide(this.mats.mudRoof);

    const bySector = new Map<string, number[]>();
    this.blocks.forEach((block, i) => {
      const key = `${Math.floor(block.i / SECTOR)},${Math.floor(block.j / SECTOR)}`;
      if (!bySector.has(key)) bySector.set(key, []);
      bySector.get(key)!.push(i);
    });
    for (const ids of bySector.values()) {
      const walls: THREE.BufferGeometry[] = [];
      const roofs: THREE.BufferGeometry[] = [];
      for (const i of ids) {
        const w = new MeshBuilder(2.4);
        const r = new MeshBuilder(3.0);
        for (const h of this.houses[i]) massHouse(h, w, r);
        walls.push(tagBlock(w.build(), i));
        roofs.push(tagBlock(r.build(), i));
      }
      for (const [geoms, material] of [
        [walls, wallMat],
        [roofs, roofMat],
      ] as const) {
        const merged = mergeGeometries(geoms);
        geoms.forEach((g) => g.dispose());
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material);
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
  }

  /** Call every frame with the player's position. */
  update(x: number, z: number, budgetMs = 3) {
    const start = performance.now();
    const sync = budgetMs === Infinity;
    this.lastX = x;
    this.lastZ = z;
    const wanted: { id: number; d: number }[] = [];
    for (const b of this.blocks) {
      const d = distanceToRect(x, z, b.rect);
      if (this.loaded.has(b.id)) {
        if (d > UNLOAD_RADIUS) this.unload(b.id);
      } else if (d < LOAD_RADIUS && !this.attaching.has(b.id) && this.job?.id !== b.id) {
        wanted.push({ id: b.id, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);

    // Build house by house, nearest block first, until this frame's budget is spent.
    while (performance.now() - start < budgetMs) {
      if (!this.job) {
        const next = wanted.shift();
        if (!next) break;
        this.job = { id: next.id, k: 0, builders: createBuilders(), colliders: [], props: [], meshes: [] };
      }
      const job = this.job;
      const houses = this.houses[job.id];
      const t0 = performance.now();
      if (job.k < houses.length) {
        const h = houses[job.k++];
        job.colliders.push(...addBuilding(h.spec, job.builders));
        job.props.push(...h.props);
        this.worst.house = Math.max(this.worst.house, performance.now() - t0);
        continue;
      }
      // All houses added: turn one material layer into a mesh per step.
      job.layers ??= builderLayers(job.builders, this.mats);
      const layer = job.layers.shift();
      if (layer) {
        const mesh = layerMesh(layer);
        if (mesh) job.meshes.push(mesh);
        this.worst.finish = Math.max(this.worst.finish, performance.now() - t0);
        continue;
      }
      this.job = null;
      this.finish(job, sync);
    }
    // Details only up close.
    for (const [id, l] of this.loaded) {
      const near = distanceToRect(x, z, this.blocks[id].rect) < DETAIL_RADIUS;
      if (l.near !== near) {
        l.near = near;
        for (const m of l.group.children) if (m.userData.detail) m.visible = near;
      }
    }
    this.lastBuildMs = performance.now() - start;
  }

  /** Build everything near a point right away (used at spawn, behind the loading screen). */
  preload(x: number, z: number) {
    this.update(x, z, Infinity);
  }

  private finish(job: Job, sync: boolean) {
    const t0 = performance.now();
    const group = new THREE.Group();
    group.name = `block-${job.id}`;
    group.add(...job.meshes);
    this.worst.finish = Math.max(this.worst.finish, performance.now() - t0);
    const attach = () => {
      this.attaching.delete(job.id);
      // The player may have walked away while the GPU was getting ready.
      if (distanceToRect(this.lastX, this.lastZ, this.blocks[job.id].rect) > UNLOAD_RADIUS) {
        disposeGroup(group);
        return;
      }
      const t1 = performance.now();
      this.group.add(group);
      this.loaded.set(job.id, { group, colliders: this.physics.add(job.colliders), pots: this.pottery.add(job.props, job.id + 1), near: true });
      this.worst.attach = Math.max(this.worst.attach, performance.now() - t1);
      this.worst.colliders = Math.max(this.worst.colliders, job.colliders.length);
      this.setHidden(job.id, 1);
    };
    if (sync || !this.compile) return attach();
    // Prepare the GPU pipelines off the critical path, then swap the block in.
    this.attaching.add(job.id);
    this.compile(group).then(attach, attach);
  }

  private unload(id: number) {
    const l = this.loaded.get(id);
    if (!l) return;
    this.group.remove(l.group);
    disposeGroup(l.group);
    this.physics.remove(l.colliders);
    this.pottery.remove(l.pots);
    this.loaded.delete(id);
    this.setHidden(id, 0);
  }
}

/** Low-detail house: outer walls, roof around the court, the court's inner walls, and any upper room. */
function massHouse(h: House, walls: MeshBuilder, roofs: MeshBuilder) {
  walls.shade = roofs.shade = h.spec.shade ?? 1;
  const t = h.spec.thickness / 2;
  const f = h.footprint;
  const r: Rect = [f[0] + 0.02, f[1] + 0.02, f[2] - 0.02, f[3] - 0.02];
  const H = h.wallHeight - 0.1;
  const R = h.roofHeight;
  const [cx0, cz0, cx1, cz1] = h.court;
  void t;

  const box = (rect: Rect, y0: number, y1: number, inward = false) => {
    const b = rectCorners(rect[0], rect[1], rect[2], rect[3], y0);
    const tp = rectCorners(rect[0], rect[1], rect[2], rect[3], y1);
    for (const [i, j] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ] as const) {
      if (inward) walls.quad(b[j], b[i], tp[i], tp[j]);
      else walls.quad(b[i], b[j], tp[j], tp[i]);
    }
  };
  box(r, 0, H);
  box([cx0, cz0, cx1, cz1], 0, R, true);
  for (const s of [
    [r[0], r[1], r[2], cz0],
    [r[0], cz1, r[2], r[3]],
    [r[0], cz0, cx0, cz1],
    [cx1, cz0, r[2], cz1],
  ] as Rect[]) {
    const c = rectCorners(s[0], s[1], s[2], s[3], R);
    roofs.quad(c[0], c[1], c[2], c[3]);
  }
  if (h.upper) {
    const u = h.upper.rect;
    box(u, R, h.upper.top);
    const c = rectCorners(u[0], u[1], u[2], u[3], h.upper.top);
    roofs.quad(c[0], c[1], c[2], c[3]);
  }
}
