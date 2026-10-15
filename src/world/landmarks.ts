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
import type { CityPlan, Rect } from './city/plan';

/**
 * The fixed, hand-placed parts of Ur: the city wall with its gates, the temenos and
 * ziggurat, and the water (Euphrates, canal, harbours). Built once at startup.
 */
export function buildLandmarks(plan: CityPlan, mats: Materials, waterMat: THREE.Material) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const colliders: ColliderBox[] = [];

  // --- City wall: a sloping mudbrick rampart around the oval, broken only by the gates.
  const rampart = new MeshBuilder(2.4);
  const { radiusX: rx, radiusZ: rz, height: H, baseWidth, topWidth, gates } = plan.wall;
  const segments = 220;
  const gateHalf = 1.0; // degrees either side of a gate's centre
  const at = (deg: number) => {
    const a = THREE.MathUtils.degToRad(deg);
    const p = new THREE.Vector2(rx * Math.cos(a), rz * Math.sin(a));
    const n = new THREE.Vector2(p.x / (rx * rx), p.y / (rz * rz)).normalize(); // outward
    return { p, n };
  };
  const inGate = (deg: number) => gates.some((g) => Math.abs(((deg - g + 540) % 360) - 180) < gateHalf);
  // Water passes through the wall where the harbours open to the river and canal.
  const wet = [...plan.water.harbours, ...plan.water.channels].map((h) => h.rect);
  const inWater = (deg: number) => {
    const { p } = at(deg);
    return wet.some((r) => p.x > r[0] - 6 && p.x < r[2] + 6 && p.y > r[1] - 6 && p.y < r[3] + 6);
  };
  for (let k = 0; k < segments; k++) {
    const d0 = -180 + (360 * k) / segments;
    const d1 = -180 + (360 * (k + 1)) / segments;
    const a = at(d0);
    const b = at(d1);
    if (inGate((d0 + d1) / 2) || inWater((d0 + d1) / 2)) {
      // No rampart here, but still no way out: a barrier along the wall line.
      const along = b.p.clone().sub(a.p);
      const mid = a.p.clone().add(b.p).multiplyScalar(0.5);
      colliders.push({
        center: new THREE.Vector3(mid.x, 4, mid.y),
        halfExtents: new THREE.Vector3(along.length() / 2 + 0.5, 4, 1.5),
        rotationY: -Math.atan2(along.y, along.x),
      });
      continue;
    }
    const ring = (s: number, y: number, which: typeof a) => new THREE.Vector3(which.p.x + which.n.x * s, y, which.p.y + which.n.y * s);
    // Angle increases counter-clockwise seen from below, so "inside" is -n: bottom = [a_in, b_in, b_out, a_out].
    rampart.prism(
      [ring(-baseWidth / 2, 0, a), ring(-baseWidth / 2, 0, b), ring(baseWidth / 2, 0, b), ring(baseWidth / 2, 0, a)],
      [ring(-topWidth / 2, H, a), ring(-topWidth / 2, H, b), ring(topWidth / 2, H, b), ring(topWidth / 2, H, a)],
    );
    // Parapet on the outer edge of the walkway.
    rampart.prism(
      [ring(topWidth / 2 - 1, H, a), ring(topWidth / 2 - 1, H, b), ring(topWidth / 2, H, b), ring(topWidth / 2, H, a)],
      [ring(topWidth / 2 - 1, H + 1.6, a), ring(topWidth / 2 - 1, H + 1.6, b), ring(topWidth / 2, H + 1.6, b), ring(topWidth / 2, H + 1.6, a)],
    );
    // Keep walkers off the rampart slope: a wall-high box at its inner foot.
    const mid = a.p.clone().add(b.p).multiplyScalar(0.5);
    const n = a.n.clone().add(b.n).normalize();
    const c = mid.clone().addScaledVector(n, -baseWidth / 2 + 1);
    const len = a.p.distanceTo(b.p) + 0.5;
    const along = b.p.clone().sub(a.p).normalize();
    colliders.push({
      center: new THREE.Vector3(c.x, 4, c.y),
      halfExtents: new THREE.Vector3(len / 2, 4, 1),
      rotationY: -Math.atan2(along.y, along.x),
    });
  }

  // Gates: a gatehouse block across the gap with a pair of closed wooden doors.
  const gateBuilders = createBuilders();
  for (const g of gates) {
    const { p, n } = at(g);
    const along = new THREE.Vector2(-n.y, n.x);
    const deg = THREE.MathUtils.radToDeg(Math.atan2(along.y, along.x));
    const gap = 2 * (THREE.MathUtils.degToRad(gateHalf) * Math.hypot(rx, rz) * 0.75) + 6;
    const spec: BuildingSpec = {
      id: `gate-${g}`,
      evidence: 'inferred',
      position: [p.x - along.x * (gap / 2), p.y - along.y * (gap / 2)],
      rotation: -deg,
      wallHeight: H + 3,
      thickness: baseWidth,
      footingHeight: 1.2,
      roofHeight: 0,
      walls: [{ from: [0, 0], to: [gap, 0], doors: [{ at: gap / 2, width: 4.2, height: 5.5 }] }],
    };
    colliders.push(...addBuilding(spec, gateBuilders));
    // The doors themselves: closed, filling the opening.
    const doorSpec: BuildingSpec = { ...spec, id: `gate-doors-${g}`, wallHeight: 5.45, thickness: 0.5, footingHeight: 0, roofHeight: 99, walls: [{ from: [gap / 2 - 2.1, 0], to: [gap / 2 + 2.1, 0] }] };
    const doorColliders = addBuilding(doorSpec, { ...gateBuilders, plaster: gateBuilders.timber, brick: gateBuilders.timber });
    colliders.push(...doorColliders);
  }
  group.add(new THREE.Mesh(rampart.build(), mats.plaster), ...meshesFrom(gateBuilders, mats));

  // --- Temenos: a massive enclosure wall with one gateway, paved inside.
  const t = plan.temenos;
  const [x0, z0, x1, z1] = t.rect;
  const temenos = createBuilders();
  const temenosSpec: BuildingSpec = {
    id: 'temenos',
    evidence: 'inferred',
    position: [0, 0],
    wallHeight: t.wallHeight,
    thickness: t.wallThickness,
    footingHeight: 1.4,
    roofHeight: 0,
    walls: [
      { from: [x0, z0], to: [x1, z0] },
      { from: [x1, z0], to: [x1, z1], doors: [{ at: (z1 - z0) * t.gate.at, width: 6, height: 5.2 }] },
      { from: [x1, z1], to: [x0, z1] },
      { from: [x0, z1], to: [x0, z0] },
    ],
    floors: [{ rect: [x0 + 2, z0 + 2, x1 - 2, z1 - 2], material: 'brick' }],
  };
  colliders.push(...addBuilding(temenosSpec, temenos));
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
  // Canal: a band following the wall on the north-east, outside it.
  const cn = plan.water.canal;
  const steps = 90;
  for (let k = 0; k < steps; k++) {
    const d0 = cn.fromDeg + ((cn.toDeg - cn.fromDeg) * k) / steps;
    const d1 = cn.fromDeg + ((cn.toDeg - cn.fromDeg) * (k + 1)) / steps;
    const ring = (deg: number, s: number) => {
      const a = THREE.MathUtils.degToRad(deg);
      return new THREE.Vector3((rx + cn.offset + s) * Math.cos(a), 0.06, (rz + cn.offset + s) * Math.sin(a));
    };
    const w = cn.width / 2;
    water.quad(ring(d0, -w), ring(d1, -w), ring(d1, w), ring(d0, w));
  }
  const waterMesh = new THREE.Mesh(water.build(), waterMat);
  waterMesh.receiveShadow = true;
  group.add(waterMesh, ...meshesFrom(quays, mats));

  return { group, colliders };
}
