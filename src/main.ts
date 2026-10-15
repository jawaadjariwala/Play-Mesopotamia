import * as THREE from 'three/webgpu';
import { createPipeline, createRenderer, isWebGPU } from './engine/renderer';
import { createSky, followSun } from './engine/sky';
import { StatsOverlay } from './engine/stats';
import { QualityGovernor } from './engine/adaptiveResolution';
import { Physics } from './engine/physics';
import { Player } from './player/player';
import { createMaterials } from './world/materials';
import { MeshBuilder, rectCorners } from './world/generator/meshBuilder';
import { buildLandmarks, canalBridges } from './world/landmarks';
import { CityStreamer } from './world/city/streamer';
import { StreetGrid } from './world/city/layout';
import { insideWall, insideWallShape, onWater, plan } from './world/city/plan';
import { GameUI, type Place } from './ui/ui';
import { buildPalms, CityPalms, FOLIAGE_LAYER } from './world/props/palm';
import { cityPalmPoints } from './world/city/greenery';

/**
 * Fixed camera poses for screenshots and checks: ?view=street | ziggurat | aerial | wall.
 * With a view set, the player is parked and the camera holds still.
 */
function viewPose(view: string, spawn: THREE.Vector3, spawnYaw: number, sunDir: THREE.Vector3) {
  const [zx, zz] = plan.ziggurat.position;
  const bridge = canalBridges(plan)[2] ?? canalBridges(plan)[0];
  const across = new THREE.Vector3(-bridge.axis.y, 0, bridge.axis.x);
  const poses: Record<string, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
    street: {
      pos: spawn.clone().setY(1.65),
      look: spawn.clone().add(new THREE.Vector3(-Math.sin(spawnYaw), 0, -Math.cos(spawnYaw)).multiplyScalar(50)).setY(4),
    },
    temenos: { pos: new THREE.Vector3(-40, 55, -105), look: new THREE.Vector3(-175, 0, -255) },
    canal: {
      pos: new THREE.Vector3(bridge.center.x, 2.2, bridge.center.y).addScaledVector(across, 22).add(new THREE.Vector3(bridge.axis.x * 6, 0, bridge.axis.y * 6)),
      look: new THREE.Vector3(bridge.center.x, 0.5, bridge.center.y),
    },
    rooftops: { pos: spawn.clone().add(new THREE.Vector3(-30, 24, 26)), look: spawn.clone().add(new THREE.Vector3(-6, 0, -4)) },
    ziggurat: { pos: new THREE.Vector3(zx + 75, 1.65, zz + 70), look: new THREE.Vector3(zx, 14, zz) },
    aerial: { pos: new THREE.Vector3(260, 230, 520), look: new THREE.Vector3(-60, 0, -80) },
    wall: { pos: new THREE.Vector3(272, 1.65, 407), look: new THREE.Vector3(292, 7, 436) },
    // From the ziggurat's first terrace toward the sun, to judge glare and haze.
    sun: {
      pos: new THREE.Vector3(zx + 20, 13.5, zz + 20),
      look: new THREE.Vector3(zx + 20, 13.5, zz + 20).add(new THREE.Vector3(sunDir.x, 0.25, sunDir.z).normalize().multiplyScalar(60)),
    },
  };
  return poses[view];
}

async function main() {
  const loading = document.getElementById('loading')!;
  // Look-dev knobs, overridable from the URL (?exp=0.9&env=0.3&sun=4&tm=aces&fog=0.002&elev=38&bounce=8).
  // ?gpu measures GPU time per frame; ?noao turns ambient occlusion off.
  const q = new URLSearchParams(location.search);
  const renderer = await createRenderer(q.has('gpu'));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 6000);
  camera.layers.enable(FOLIAGE_LAYER);
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  const toneMaps: Record<string, THREE.ToneMapping> = {
    agx: THREE.AgXToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    neutral: THREE.NeutralToneMapping,
  };
  renderer.toneMapping = toneMaps[q.get('tm') ?? 'aces'] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exp', 0.9);

  const sky = createSky(renderer, scene, num('elev', 38), num('azim', -50), num('bounce', 5));
  sky.sun.intensity = num('sun', 4);
  sky.sun.shadow.camera.layers.enable(FOLIAGE_LAYER);
  scene.environmentIntensity = num('env', 0.5);
  const fogDensity = num('fog', 0.0011);
  const fog = new THREE.FogExp2(0xd9c9ae, fogDensity);
  scene.fog = fog;

  loading.textContent = 'Laying out the streets of Ur…';
  const mats = await createMaterials(renderer);
  const waterMat = new THREE.MeshStandardNodeMaterial({ color: 0x4d5c4c, roughness: 0.07, metalness: 0 });
  const physics = await Physics.create();

  const ground = new MeshBuilder(3.5);
  const g = rectCorners(-2500, -2500, 2500, 2500, 0);
  ground.quad(g[0], g[1], g[2], g[3]);
  const groundMesh = new THREE.Mesh(ground.build(), mats.ground);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const landmarks = buildLandmarks(plan, mats, waterMat);
  scene.add(landmarks.group);
  physics.add(landmarks.colliders);

  const city = new CityStreamer(mats, physics);
  city.compile = (group) => renderer.compileAsync(group, camera, scene);
  scene.add(city.group);
  const palms = buildPalms(plan.palmGroves, mats, (x, z) => onWater(x, z, 4) || insideWall(x, z, 6));
  scene.add(palms.group);
  const palmPoints = cityPalmPoints(city.blocks);
  const cityPalms = new CityPalms(palmPoints, mats);
  scene.add(cityPalms.group);

  // Spawn on the street crossing nearest the plan's spawn point, facing the ziggurat.
  const [sx, sz] = new StreetGrid().crossingNear(...plan.spawn.near);
  const spawn = new THREE.Vector3(sx, 0, sz);
  const [lx, lz] = plan.spawn.lookAt;
  // Face down whichever street runs closest to the direction of the ziggurat.
  const [dx, dz] = [lx - sx, lz - sz];
  const along = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
  const spawnYaw = Math.atan2(-along[0], -along[1]);
  const player = new Player(physics, camera, renderer.domElement, spawn, spawnYaw);

  const pose = q.has('view') ? viewPose(q.get('view')!, spawn, spawnYaw, sky.sunDirection) : undefined;
  player.enabled = false;
  // Behind the start screen: a slow drift beside the canal bridge nearest the spawn point.
  const introBridge = canalBridges(plan).reduce((a, b) => (a.center.distanceTo(new THREE.Vector2(sx, sz)) < b.center.distanceTo(new THREE.Vector2(sx, sz)) ? a : b));
  const introCentre = new THREE.Vector3(introBridge.center.x, 0, introBridge.center.y);
  const introPose = (t: number) => {
    const a = 0.6 + t * 0.018;
    camera.position.set(introCentre.x + Math.cos(a) * 26, 3.2, introCentre.z + Math.sin(a) * 26);
    camera.lookAt(introCentre.x, 1.5, introCentre.z);
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (pose) {
    camera.position.copy(pose.pos);
    camera.lookAt(pose.look);
  } else {
    introPose(0);
  }

  loading.textContent = 'Building the houses around you…';
  await new Promise((r) => setTimeout(r));
  city.preload(camera.position.x, camera.position.z);
  if (!pose) city.preload(sx, sz);

  // Two pipelines, with and without ambient occlusion; the quality governor picks one.
  const pipelines = { ao: createPipeline(renderer, scene, camera, { ao: true }), plain: createPipeline(renderer, scene, camera, { ao: false }) };
  let pipeline = q.has('noao') ? pipelines.plain : pipelines.ao;
  const stats = new StatsOverlay(renderer, isWebGPU(renderer) ? 'WebGPU' : 'WebGL 2 fallback');
  // The performance overlay is for development: ?stats shows it (fixed views always do).
  stats.visible = q.has('stats') || Boolean(pose);
  const quality = new QualityGovernor(renderer, (ao) => {
    pipeline = ao && !q.has('noao') ? pipelines.ao : pipelines.plain;
  });
  if (pose) {
    // Fixed views are for comparing screenshots: always full quality.
    quality.level = 0;
  }
  stats.extra = () =>
    `${quality.describe()}\nblocks ${city.loadedCount}  build ${city.lastBuildMs.toFixed(1)} ms\n` +
    `${city.houseCount} houses  ${palmPoints.length} city palms\n${cpuTimes.shown}`;
  // Handles for scripted checks (scripts/ and headless probes).
  const zy = THREE.MathUtils.degToRad(plan.ziggurat.rotation ?? 0);
  const stairFoot = new THREE.Vector3(0, 0, plan.ziggurat.terraces[0].depth / 2 + 38)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), zy)
    .add(new THREE.Vector3(plan.ziggurat.position[0], 0, plan.ziggurat.position[1]));
  Object.assign(window as unknown as Record<string, unknown>, {
    __city: city,
    __player: player,
    __camera: camera,
    __quality: quality,
    __stairFoot: { x: stairFoot.x, z: stairFoot.z, yaw: zy },
    __wallTests: landmarks.wallTests,
    __bridges: canalBridges(plan).map((b) => ({ x: b.center.x, z: b.center.y, ax: b.axis.x, az: b.axis.y, half: b.halfLength })),
    __scene: scene,
    __insideWall: (x: number, z: number) => insideWallShape(x, z, 0),
  });

  loading.remove();

  // Places to jump to from the menu.
  const t = plan.temenos;
  const gateX = t.rect[0] + (t.rect[2] - t.rect[0]) * t.gate.at;
  const harbour = plan.water.harbours.find((h) => h.name === 'West Harbour')!;
  const wallSpot = landmarks.wallTests.find((w) => w.kind === 'wall')!;
  const bridgeStart = introBridge.center.clone().addScaledVector(introBridge.axis, -(introBridge.halfLength + 3));
  const places: Place[] = [
    { name: 'A residential street', hint: 'Where you started, among the courtyard houses.', x: sx, z: sz, yaw: spawnYaw },
    { name: 'The ziggurat', hint: 'Climb the great stairway to the first terrace.', x: stairFoot.x, z: stairFoot.z, yaw: zy },
    { name: 'The temple district', hint: 'The walled precinct of Nanna, the moon god.', x: gateX, z: t.rect[3] - 10, yaw: 0 },
    { name: 'The canal', hint: 'Cross the canal that ran through the city.', x: bridgeStart.x, z: bridgeStart.y, yaw: Math.atan2(-introBridge.axis.x, -introBridge.axis.y) },
    { name: 'The West Harbour', hint: 'Where boats from the Gulf brought copper and timber.', x: harbour.rect[2] + 6, z: (harbour.rect[1] + harbour.rect[3]) / 2, yaw: Math.PI / 2 },
    { name: 'The city wall', hint: 'The mudbrick rampart around the whole city.', x: wallSpot.x, z: wallSpot.z, yaw: wallSpot.yaw },
  ];
  const ui = pose ? null : new GameUI(player, renderer.domElement, places, plan);
  Object.assign(window as unknown as Record<string, unknown>, { __ui: ui });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ?autopilot=6 drifts a posed camera along +x at that speed, to test streaming while moving.
  const autopilot = num('autopilot', 0);

  // CPU time split between game logic and render submission, averaged per second.
  const cpuTimes = { update: 0, render: 0, frames: 0, gpu: 0, gpuFrames: 0, shown: '' };
  setInterval(async () => {
    if (!cpuTimes.frames) return;
    // GPU timestamps accumulate between resolves, so one resolve per second covers all its frames.
    if (q.has('gpu')) {
      const ms = await renderer.resolveTimestampsAsync();
      if (typeof ms === 'number') {
        cpuTimes.gpu = ms;
        cpuTimes.gpuFrames = cpuTimes.frames;
      }
    }
    cpuTimes.shown = `cpu update ${(cpuTimes.update / cpuTimes.frames).toFixed(1)} ms  render ${(cpuTimes.render / cpuTimes.frames).toFixed(1)} ms`;
    const gpu = cpuTimes.gpuFrames ? cpuTimes.gpu / cpuTimes.gpuFrames : null;
    Object.assign(window as unknown as Record<string, unknown>, {
      __cpu: { update: cpuTimes.update / cpuTimes.frames, render: cpuTimes.render / cpuTimes.frames, gpu },
    });
    cpuTimes.update = cpuTimes.render = cpuTimes.frames = cpuTimes.gpu = cpuTimes.gpuFrames = 0;
  }, 1000);

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    const cpu0 = performance.now();
    player.update(dt);
    // On the start screen the camera drifts slowly beside the canal.
    if (ui?.atStart && !reducedMotion) introPose(now / 1000);
    ui?.update();
    if (pose && autopilot) camera.position.x += autopilot * dt;
    physics.world.step();
    const { x, z } = camera.position;
    city.update(x, z);
    palms.update(x, z);
    cityPalms.update(x, z);
    followSun(sky, x, z);
    // Ground-level haze; seen from high up (the ziggurat, aerial views) it thins out.
    fog.density = fogDensity * (1 - 0.65 * THREE.MathUtils.smoothstep(camera.position.y, 15, 180));

    const cpu1 = performance.now();
    pipeline.render();
    const cpu2 = performance.now();
    cpuTimes.update += cpu1 - cpu0;
    cpuTimes.render += cpu2 - cpu1;
    cpuTimes.frames++;
    stats.tick();
    if (!pose) quality.tick();
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Something went wrong starting the game: ${err?.message ?? err}`;
});
