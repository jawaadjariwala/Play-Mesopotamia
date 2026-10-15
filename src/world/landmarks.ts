import * as THREE from 'three/webgpu';
import type { Materials } from './materials';
import { MeshBuilder, rectCorners } from './generator/meshBuilder';
import {
  addBuilding,
  buildZiggurat,
  createBuilders,
  meshesFrom,
  ZIGGURAT_STAIR,
  type BuildingSpec,
  type ColliderBox,
} from './generator/buildings';
import { insideWall, onWater, wallFactor, wallVertices, type CityPlan, type Rect, type TempleSpec } from './city/plan';
import { StreetGrid } from './city/layout';

/**
 * The fixed, hand-placed parts of Ur: the city wall with its gates, the temenos and
 * ziggurat, and the water (Euphrates, canal, harbours). Built once at startup.
 */
export function buildLandmarks(plan: CityPlan, mats: Materials, waterMat: THREE.Material) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const colliders: ColliderBox[] = [];

  // --- City wall: straight runs of sloping mudbrick rampart between towers, following the
  // city's irregular outline. Gates are gatehouses; where water passes through, the wall
  // stops between two towers.
  const rampart = new MeshBuilder(2.4);
  const fort = createBuilders();
  const { height: H, baseWidth, topWidth, gates, towerSize } = plan.wall;
  const verts = wallVertices(plan).map(([x, z]) => new THREE.Vector2(x, z));
  const n = verts.length;
  const segAngle = (k: number) => {
    const m = verts[k].clone().add(verts[(k + 1) % n]).multiplyScalar(0.5);
    return THREE.MathUtils.radToDeg(Math.atan2(m.y / plan.wall.radiusZ, m.x / plan.wall.radiusX));
  };
  const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const gateSegs = new Set(gates.map((g) => [...Array(n).keys()].reduce((best, k) => (angleGap(segAngle(k), g) < angleGap(segAngle(best), g) ? k : best), 0)));
  const wetSeg = (k: number) => {
    const a = verts[k];
    const b = verts[(k + 1) % n];
    for (let i = 0; i <= 8; i++) {
      const p = a.clone().lerp(b, i / 8);
      if (onWater(p.x, p.y, 8, plan)) return true;
    }
    return false;
  };
  const wallTests: { x: number; z: number; yaw: number; kind: string }[] = [];

  for (let k = 0; k < n; k++) {
    const a = verts[k];
    const b = verts[(k + 1) % n];
    const along = b.clone().sub(a);
    const len = along.length();
    along.normalize();
    const out = new THREE.Vector2(along.y, -along.x); // outward
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const rot = -THREE.MathUtils.radToDeg(Math.atan2(along.y, along.x));
    const wet = wetSeg(k);
    const gate = !wet && gateSegs.has(k);
    // A barrier on the wall line itself, so no gap is ever a way out.
    colliders.push({ center: new THREE.Vector3(mid.x, 4, mid.y), halfExtents: new THREE.Vector3(len / 2 + 0.5, 4, 1.5), rotationY: -Math.atan2(along.y, along.x) });
    if (wet || gate || k % 9 === 0) {
      const inside = mid.clone().addScaledVector(out, -(baseWidth / 2 + 6));
      wallTests.push({ x: inside.x, z: inside.y, yaw: Math.atan2(-out.x, -out.y), kind: wet ? 'water opening' : gate ? 'gate' : 'wall' });
    }
    if (wet) continue;

    if (gate) {
      const spec: BuildingSpec = {
        id: `gate-${k}`,
        evidence: 'inferred',
        position: [a.x, a.y],
        rotation: rot,
        wallHeight: H + 3,
        thickness: baseWidth,
        footingHeight: 1.2,
        roofHeight: 0,
        walls: [{ from: [0, 0], to: [len, 0], doors: [{ at: len / 2, width: 4.2, height: 5.5 }] }],
      };
      colliders.push(...addBuilding(spec, fort));
      // The doors themselves: closed, filling the opening.
      colliders.push(
        ...addBuilding(
          { ...spec, id: `gate-doors-${k}`, wallHeight: 5.45, thickness: 0.5, footingHeight: 0, roofHeight: 99, walls: [{ from: [len / 2 - 2.1, 0], to: [len / 2 + 2.1, 0] }] },
          { ...fort, plaster: fort.timber, brick: fort.timber },
        ),
      );
      continue;
    }

    const ring = (p: THREE.Vector2, s: number, y: number) => new THREE.Vector3(p.x + out.x * s, y, p.y + out.y * s);
    // Bottom is [a_in, b_in, b_out, a_out] (inside is to the left walking from a to b).
    rampart.prism(
      [ring(a, -baseWidth / 2, 0), ring(b, -baseWidth / 2, 0), ring(b, baseWidth / 2, 0), ring(a, baseWidth / 2, 0)],
      [ring(a, -topWidth / 2, H), ring(b, -topWidth / 2, H), ring(b, topWidth / 2, H), ring(a, topWidth / 2, H)],
    );
    rampart.prism(
      [ring(a, topWidth / 2 - 1, H), ring(b, topWidth / 2 - 1, H), ring(b, topWidth / 2, H), ring(a, topWidth / 2, H)],
      [ring(a, topWidth / 2 - 1, H + 1.6), ring(b, topWidth / 2 - 1, H + 1.6), ring(b, topWidth / 2, H + 1.6), ring(a, topWidth / 2, H + 1.6)],
    );
    // Keep walkers off the rampart slope: a wall-high box at its inner foot.
    const foot = mid.clone().addScaledVector(out, -baseWidth / 2 + 1);
    colliders.push({ center: new THREE.Vector3(foot.x, 4, foot.y), halfExtents: new THREE.Vector3(len / 2 + 0.5, 4, 1), rotationY: -Math.atan2(along.y, along.x) });
  }

  // Towers on every bend of the wall (they also flank the gates and water openings).
  for (let k = 0; k < n; k++) {
    const prev = verts[(k - 1 + n) % n];
    const next = verts[(k + 1) % n];
    const dir = next.clone().sub(prev).normalize();
    const c = towerSize / 2 - 1;
    const spec: BuildingSpec = {
      id: `tower-${k}`,
      evidence: 'inferred',
      position: [verts[k].x, verts[k].y],
      rotation: -THREE.MathUtils.radToDeg(Math.atan2(dir.y, dir.x)),
      wallHeight: H + 4,
      thickness: 2,
      footingHeight: 1.2,
      roofHeight: H + 3.4,
      walls: [
        { from: [-c, -c], to: [c, -c] },
        { from: [c, -c], to: [c, c] },
        { from: [c, c], to: [-c, c] },
        { from: [-c, c], to: [-c, -c] },
      ],
      roofs: [{ rect: [-c, -c, c, c] }],
    };
    colliders.push(...addBuilding(spec, fort));
  }
  group.add(new THREE.Mesh(rampart.build(), mats.plaster), ...meshesFrom(fort, mats));

  // --- Temenos: the walled sacred precinct, the city's centre. Buttressed enclosure with a
  // gateway toward the city; inside, the ziggurat in its own walled court, a great open
  // court with an altar platform, and temple compounds built around courtyards.
  const t = plan.temenos;
  const [x0, z0, x1, z1] = t.rect;
  const temenos = createBuilders();
  const gateDoor = (len: number) => [{ at: len * t.gate.at, width: 6, height: 5.2 }];
  const enclosure = (r: Rect, thickness: number, height: number, doorSide: Side, doorAt: number, doorWidth: number, buttress: number): BuildingSpec => {
    const [a0, b0, a1, b1] = r;
    const door = (len: number) => [{ at: len * doorAt, width: doorWidth, height: Math.min(height - 1.5, doorWidth * 0.9 + 1) }];
    return {
      id: 'enclosure',
      evidence: 'inferred',
      position: [0, 0],
      wallHeight: height,
      thickness,
      footingHeight: 1.4,
      roofHeight: 0,
      walls: [
        { from: [a0, b0], to: [a1, b0], buttress, doors: doorSide === 'north' ? door(a1 - a0) : [] },
        { from: [a1, b0], to: [a1, b1], buttress, doors: doorSide === 'east' ? door(b1 - b0) : [] },
        { from: [a1, b1], to: [a0, b1], buttress, doors: doorSide === 'south' ? door(a1 - a0) : [] },
        { from: [a0, b1], to: [a0, b0], buttress, doors: doorSide === 'west' ? door(b1 - b0) : [] },
      ],
    };
  };
  void gateDoor;
  const outerSpec = enclosure(t.rect, t.wallThickness, t.wallHeight, t.gate.side, t.gate.at, 6, 4.2);
  colliders.push(...addBuilding(outerSpec, temenos));
  // Towers at the corners and either side of the gate.
  const gateX = x0 + (x1 - x0) * t.gate.at;
  for (const [tx, tz] of [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
    [gateX - 6, z1],
    [gateX + 6, z1],
  ]) {
    colliders.push(...addBuilding(towerSpec(tx, tz, 6.5, t.wallHeight + 2.5), temenos));
  }
  // The ziggurat's own court, gate on the side facing the great court.
  colliders.push(...addBuilding(enclosure(t.zigguratCourt, 2.6, 7, 'south', 0.5, 8, 3.6), temenos));
  const zc = t.zigguratCourt;
  const zcx = (zc[0] + zc[2]) / 2;
  for (const dx of [-6.5, 6.5]) colliders.push(...addBuilding(towerSpec(zcx + dx, zc[3], 4.5, 9.5), temenos));
  // Altar platform in the great court, with a small shrine block on it.
  const al = t.altar;
  const [ax, az] = al.center;
  const [aw, ad] = al.size;
  const altarSpec: BuildingSpec = {
    id: 'altar',
    evidence: 'inferred',
    position: [ax - aw / 2, az - ad / 2],
    wallHeight: al.height + 0.3,
    thickness: 1,
    footingHeight: al.height + 0.3,
    roofHeight: al.height,
    walls: [
      { from: [0, 0], to: [aw, 0] },
      { from: [aw, 0], to: [aw, ad] },
      { from: [aw, ad], to: [0, ad] },
      { from: [0, ad], to: [0, 0] },
    ],
    roofs: [{ rect: [0, 0, aw, ad] }],
  };
  colliders.push(...addBuilding(altarSpec, temenos));
  addBuilding({ ...towerSpec(ax, az, 4.5, al.height + 2.2), walls: towerSpec(ax, az, 4.5, al.height + 2.2).walls.map((w) => ({ ...w, base: al.height })) }, temenos);
  for (const temple of t.temples) colliders.push(...addCompound(temple, temenos));
  group.add(...meshesFrom(temenos, mats));

  // --- Ziggurat, with colliders for its terraces and a ramp up the central stair.
  const z = plan.ziggurat;
  const zig = buildZiggurat(z, mats);
  group.add(zig);
  const yaw = THREE.MathUtils.degToRad(z.rotation ?? 0);
  const toWorld = (lx: number, ly: number, lz: number) =>
    new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(z.position[0], 0, z.position[1]));
  let y = 0;
  for (const terr of z.terraces) {
    colliders.push({
      center: toWorld(0, y + terr.height / 2, 0),
      halfExtents: new THREE.Vector3(terr.width / 2 - terr.batter / 2, terr.height / 2, terr.depth / 2 - terr.batter / 2),
      rotationY: yaw,
    });
    y += terr.height;
  }
  const first = z.terraces[0];
  const front = first.depth / 2;
  const run = ZIGGURAT_STAIR.run + 1;
  const rise = first.height - 0.25;
  const slope = Math.atan2(rise, run);
  const length = Math.hypot(run, rise);
  const q = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), slope));
  const rampCenter = toWorld(0, 0.25 + rise / 2 - 0.2, front - 1 + run / 2);
  colliders.push({
    center: rampCenter,
    halfExtents: new THREE.Vector3(ZIGGURAT_STAIR.halfWidth, 0.2, length / 2),
    rotationY: yaw,
    rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
  });
  // Side stairs of the triple stair: they rise along the front face toward the middle.
  const hw = first.width / 2;
  for (const side of [-1, 1]) {
    const outer = side * (hw - 2);
    const inner = side * (ZIGGURAT_STAIR.halfWidth + 0.5);
    const span = Math.abs(outer - inner);
    const tilt = Math.atan2(rise, span);
    const qs = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -side * tilt));
    colliders.push({
      center: toWorld((outer + inner) / 2, 0.25 + rise / 2 - 0.2, front + 2.25),
      halfExtents: new THREE.Vector3(Math.hypot(span, rise) / 2, 0.2, 2.75),
      rotationY: yaw,
      rotation: { x: qs.x, y: qs.y, z: qs.z, w: qs.w },
    });
  }

  // --- Water.
  const water = new MeshBuilder(8);
  const sheet = (r: Rect) => {
    const c = rectCorners(r[0], r[1], r[2], r[3], 0.06);
    water.quad(c[0], c[1], c[2], c[3]);
  };
  const river = plan.water.river;
  sheet([river.x - river.width / 2, -2000, river.x + river.width / 2, 2000]);
  const quays = createBuilders();
  for (const h of plan.water.harbours) {
    sheet(h.rect);
    const [hx0, hz0, hx1, hz1] = h.rect;
    // A low baked-brick quay around the basin, and an invisible barrier over the water.
    addBuilding(
      {
        id: h.name,
        evidence: 'inferred',
        position: [0, 0],
        wallHeight: 0.55,
        thickness: 0.8,
        footingHeight: 0.55,
        roofHeight: 0,
        walls: [
          { from: [hx0, hz0], to: [hx1, hz0] },
          { from: [hx1, hz0], to: [hx1, hz1] },
          { from: [hx1, hz1], to: [hx0, hz1] },
          { from: [hx0, hz1], to: [hx0, hz0] },
        ],
      },
      quays,
    );
    colliders.push({
      center: new THREE.Vector3((hx0 + hx1) / 2, 1.5, (hz0 + hz1) / 2),
      halfExtents: new THREE.Vector3((hx1 - hx0) / 2, 1.5, (hz1 - hz0) / 2),
      rotationY: 0,
    });
  }
  for (const ch of plan.water.channels) {
    sheet(ch.rect);
    const [cx0, cz0, cx1, cz1] = ch.rect;
    colliders.push({
      center: new THREE.Vector3((cx0 + cx1) / 2, 1.5, (cz0 + cz1) / 2),
      halfExtents: new THREE.Vector3((cx1 - cx0) / 2, 1.5, (cz1 - cz0) / 2),
      rotationY: 0,
    });
  }
  // The canal through the city: water, low brick quays, and bridges where the avenues cross.
  const ic = plan.water.innerCanal;
  const path = ic.path.map(([x, z]) => new THREE.Vector2(x, z));
  const half = ic.width / 2;
  const normalAt = (i: number) => {
    const d0 = i > 0 ? path[i].clone().sub(path[i - 1]).normalize() : path[1].clone().sub(path[0]).normalize();
    const d1 = i < path.length - 1 ? path[i + 1].clone().sub(path[i]).normalize() : d0;
    const d = d0.add(d1).normalize();
    return new THREE.Vector2(-d.y, d.x);
  };
  for (let i = 0; i < path.length - 1; i++) {
    const [na, nb] = [normalAt(i), normalAt(i + 1)];
    const P = (p: THREE.Vector2, nn: THREE.Vector2, s: number) => new THREE.Vector3(p.x + nn.x * s, 0.06, p.y + nn.y * s);
    water.quad(P(path[i], na, half), P(path[i + 1], nb, half), P(path[i + 1], nb, -half), P(path[i], na, -half));
  }
  const bridges = canalBridges(plan);
  const quay = createBuilders();
  const step = 1.5;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const seg = path[i + 1].clone().sub(a);
    const len = seg.length();
    const dir = seg.normalize();
    for (let d = 0; d < len; d += step) {
      const s0 = a.clone().addScaledVector(dir, d);
      const s1 = a.clone().addScaledVector(dir, Math.min(len, d + step));
      const mid = s0.clone().add(s1).multiplyScalar(0.5);
      if (!insideWall(mid.x, mid.y, 0, plan)) continue;
      if (bridges.some((br) => br.center.distanceTo(mid) < br.halfWidth + 0.6)) continue;
      for (const side of [-1, 1]) {
        // Quay wall from the water's edge outward; walls listed so +across faces the water.
        const offset = side * (half + 0.3);
        const from = s0.clone().addScaledVector(new THREE.Vector2(-dir.y, dir.x), offset);
        const to = s1.clone().addScaledVector(new THREE.Vector2(-dir.y, dir.x), offset);
        quaySlab(quay.brick, from, to, 0.6, 0.5);
        const c = mid.clone().addScaledVector(new THREE.Vector2(-dir.y, dir.x), offset);
        colliders.push({ center: new THREE.Vector3(c.x, 0.75, c.y), halfExtents: new THREE.Vector3(step / 2 + 0.05, 0.75, 0.3), rotationY: -Math.atan2(dir.y, dir.x) });
      }
    }
  }
  for (const br of bridges) {
    // Deck low enough to step onto, brick parapets along both sides.
    const across = new THREE.Vector2(-br.axis.y, br.axis.x);
    const a = br.center.clone().addScaledVector(br.axis, -br.halfLength);
    const b = br.center.clone().addScaledVector(br.axis, br.halfLength);
    quaySlab(quay.brick, a.clone().addScaledVector(across, -br.halfWidth), b.clone().addScaledVector(across, -br.halfWidth), br.halfWidth * 2, 0.25, true);
    for (const side of [-1, 1]) {
      const pa = a.clone().addScaledVector(across, side * (br.halfWidth - 0.2));
      const pb = b.clone().addScaledVector(across, side * (br.halfWidth - 0.2));
      quaySlab(quay.brick, pa, pb, 0.4, 0.85);
      const c = pa.clone().add(pb).multiplyScalar(0.5);
      colliders.push({ center: new THREE.Vector3(c.x, 0.6, c.y), halfExtents: new THREE.Vector3(br.halfLength, 0.6, 0.2), rotationY: -Math.atan2(br.axis.y, br.axis.x) });
    }
    colliders.push({ center: new THREE.Vector3(br.center.x, 0.125, br.center.y), halfExtents: new THREE.Vector3(br.halfLength, 0.125, br.halfWidth), rotationY: -Math.atan2(br.axis.y, br.axis.x) });
  }
  group.add(...meshesFrom(quay, mats));

  // Canal: a band following the wall on the north-east, outside it.
  const cn = plan.water.canal;
  const steps = 90;
  for (let k = 0; k < steps; k++) {
    const d0 = cn.fromDeg + ((cn.toDeg - cn.fromDeg) * k) / steps;
    const d1 = cn.fromDeg + ((cn.toDeg - cn.fromDeg) * (k + 1)) / steps;
    const ring = (deg: number, s: number) => {
      const a = THREE.MathUtils.degToRad(deg);
      const f = wallFactor(a, plan);
      return new THREE.Vector3((plan.wall.radiusX * f + cn.offset + s) * Math.cos(a), 0.06, (plan.wall.radiusZ * f + cn.offset + s) * Math.sin(a));
    };
    const w = cn.width / 2;
    water.quad(ring(d0, -w), ring(d1, -w), ring(d1, w), ring(d0, w));
  }
  const waterMesh = new THREE.Mesh(water.build(), waterMat);
  waterMesh.receiveShadow = true;
  group.add(waterMesh, ...meshesFrom(quays, mats));

  return { group, colliders, wallTests };
}

/** A straight low wall (or a deck, when `centred` is false and width spans it) between two points. */
function quaySlab(b: MeshBuilder, from: THREE.Vector2, to: THREE.Vector2, width: number, height: number, deck = false) {
  const dir = to.clone().sub(from).normalize();
  const across = new THREE.Vector2(-dir.y, dir.x);
  const s0 = deck ? 0 : -width / 2;
  const s1 = deck ? width : width / 2;
  const at = (p: THREE.Vector2, s: number, y: number) => new THREE.Vector3(p.x + across.x * s, y, p.y + across.y * s);
  b.prism([at(from, s1, 0), at(to, s1, 0), at(to, s0, 0), at(from, s0, 0)], [at(from, s1, height), at(to, s1, height), at(to, s0, height), at(from, s0, height)], false);
}

/** Bridges where every Nth avenue crosses the canal through the city. */
export function canalBridges(plan: CityPlan) {
  const ic = plan.water.innerCanal;
  const grid = new StreetGrid(plan);
  const out: { center: THREE.Vector2; axis: THREE.Vector2; halfLength: number; halfWidth: number }[] = [];
  const s = plan.streets;
  for (const axis of [0, 1] as const) {
    const [i0, i1] = grid.range(axis);
    for (let i = i0; i <= i1; i++) {
      if (((i % s.avenueEvery) + s.avenueEvery) % s.avenueEvery !== 0) continue;
      const v = grid.line(axis, i);
      for (let k = 0; k < ic.path.length - 1; k++) {
        const [ax, az] = ic.path[k];
        const [bx, bz] = ic.path[k + 1];
        const [pa, pb] = axis === 0 ? [ax, bx] : [az, bz];
        if ((pa - v) * (pb - v) > 0 || pa === pb) continue;
        const t = (v - pa) / (pb - pa);
        const c = new THREE.Vector2(ax + (bx - ax) * t, az + (bz - az) * t);
        if (!insideWall(c.x, c.y, 30, plan)) continue;
        const along = axis === 0 ? new THREE.Vector2(0, 1) : new THREE.Vector2(1, 0);
        const canalDir = new THREE.Vector2(bx - ax, bz - az).normalize();
        const sin = Math.abs(canalDir.x * along.y - canalDir.y * along.x);
        out.push({ center: c, axis: along, halfLength: ic.width / 2 / Math.max(0.4, sin) + 2, halfWidth: 2.2 });
      }
    }
  }
  return out;
}

type Side = 'north' | 'south' | 'east' | 'west';

/** A square tower block centred on (x, z): four thick walls and a roof. */
function towerSpec(x: number, z: number, size: number, height: number): BuildingSpec {
  const c = size / 2 - 0.7;
  return {
    id: 'tower',
    evidence: 'inferred',
    position: [x, z],
    wallHeight: height,
    thickness: 1.4,
    footingHeight: 1.2,
    roofHeight: height - 0.5,
    walls: [
      { from: [-c, -c], to: [c, -c] },
      { from: [c, -c], to: [c, c] },
      { from: [c, c], to: [-c, c] },
      { from: [-c, c], to: [-c, -c] },
    ],
    roofs: [{ rect: [-c, -c, c, c] }],
  };
}

/**
 * A temple compound: buttressed outer walls, one or more courtyard cells (a court with a
 * ring of roofed rooms around it), a gateway flanked by towers, doors through to the courts.
 */
function addCompound(temple: TempleSpec, b: ReturnType<typeof createBuilders>): ColliderBox[] {
  const [x0, z0, x1, z1] = temple.rect;
  const W = x1 - x0;
  const D = z1 - z0;
  const [nx, nz] = temple.cells;
  const doors = Array.isArray(temple.door) ? temple.door : [temple.door];
  const H = 7.6;
  const R = 7.0;
  const lip = R + 0.2;
  const gate = (side: Side, len: number) => (doors.includes(side) ? [{ at: len / 2, width: 3.2, height: 4.2 }] : []);
  const walls: BuildingSpec['walls'] = [
    { from: [0, 0], to: [W, 0], buttress: 3.4, doors: gate('north', W) },
    { from: [W, 0], to: [W, D], buttress: 3.4, doors: gate('east', D) },
    { from: [W, D], to: [0, D], buttress: 3.4, doors: gate('south', W) },
    { from: [0, D], to: [0, 0], buttress: 3.4, doors: gate('west', D) },
  ];
  const roofs: NonNullable<BuildingSpec['roofs']> = [];
  const cw = W / nx;
  const cd = D / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const [c0, d0] = [i * cw, j * cd];
      // Walls between cells, with a doorway through.
      if (i > 0) walls.push({ from: [c0, d0], to: [c0, d0 + cd], height: R - 0.1, doors: [{ at: cd / 2, width: 1.4, height: 2.6 }] });
      if (j > 0) walls.push({ from: [c0 + cw, d0], to: [c0, d0], height: R - 0.1, doors: [{ at: cw / 2, width: 1.4, height: 2.6 }] });
      // The court: about half the cell, ringed by rooms.
      const kw = cw * 0.5;
      const kd = cd * 0.5;
      const k0 = c0 + (cw - kw) / 2;
      const l0 = d0 + (cd - kd) / 2;
      const [k1, l1] = [k0 + kw, l0 + kd];
      const cdoor = (len: number) => [{ at: len / 2, width: 1.6, height: 2.8 }];
      walls.push(
        { from: [k0, l0], to: [k1, l0], height: lip, doors: cdoor(kw) },
        { from: [k1, l0], to: [k1, l1], height: lip, doors: cdoor(kd) },
        { from: [k1, l1], to: [k0, l1], height: lip, doors: cdoor(kw) },
        { from: [k0, l1], to: [k0, l0], height: lip, doors: cdoor(kd) },
      );
      roofs.push(
        { rect: [c0, d0, c0 + cw, l0] },
        { rect: [c0, l1, c0 + cw, d0 + cd] },
        { rect: [c0, l0, k0, l1] },
        { rect: [k1, l0, c0 + cw, l1] },
      );
    }
  }
  const spec: BuildingSpec = {
    id: temple.name,
    evidence: 'inferred',
    note: temple.name,
    position: [x0, z0],
    wallHeight: H,
    thickness: 1.6,
    footingHeight: 1.2,
    roofHeight: R,
    walls,
    roofs,
    shade: 1.04,
  };
  const out = addBuilding(spec, b);
  // Towers either side of each gateway.
  for (const side of doors) {
    const pts: [number, number][] =
      side === 'north' ? [[x0 + W / 2 - 3, z0], [x0 + W / 2 + 3, z0]]
      : side === 'south' ? [[x0 + W / 2 - 3, z1], [x0 + W / 2 + 3, z1]]
      : side === 'west' ? [[x0, z0 + D / 2 - 3], [x0, z0 + D / 2 + 3]]
      : [[x1, z0 + D / 2 - 3], [x1, z0 + D / 2 + 3]];
    for (const [tx, tz] of pts) out.push(...addBuilding(towerSpec(tx, tz, 3.4, H + 2), b));
  }
  return out;
}
