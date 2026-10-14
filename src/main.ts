import * as THREE from 'three/webgpu';
import { createPipeline, createRenderer, isWebGPU } from './engine/renderer';
import { createSky, followSun } from './engine/sky';
import { StatsOverlay } from './engine/stats';
import { AdaptiveResolution } from './engine/adaptiveResolution';
import { Physics } from './engine/physics';
import { Player } from './player/player';
import { createMaterials } from './world/materials';
import { MeshBuilder, rectCorners } from './world/generator/meshBuilder';
import { buildLandmarks } from './world/landmarks';
import { CityStreamer } from './world/city/streamer';
import { StreetGrid } from './world/city/layout';
import { plan } from './world/city/plan';
import { buildPalms } from './world/props/palm';

/**
 * Fixed camera poses for screenshots and checks: ?view=street | ziggurat | aerial | wall.
 * With a view set, the player is parked and the camera holds still.
 */
function viewPose(view: string, spawn: THREE.Vector3, spawnYaw: number) {
  const [zx, zz] = plan.ziggurat.position;
  const poses: Record<string, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
    street: {
      pos: spawn.clone().setY(1.65),
      look: spawn.clone().add(new THREE.Vector3(-Math.sin(spawnYaw), 0, -Math.cos(spawnYaw)).multiplyScalar(50)).setY(4),
    },
    ziggurat: { pos: new THREE.Vector3(zx + 75, 1.65, zz + 70), look: new THREE.Vector3(zx, 14, zz) },
    aerial: { pos: new THREE.Vector3(260, 230, 520), look: new THREE.Vector3(-60, 0, -80) },
    wall: { pos: new THREE.Vector3(272, 1.65, 407), look: new THREE.Vector3(292, 7, 436) },
  };
  return poses[view];
}

async function main() {
  const loading = document.getElementById('loading')!;
  const renderer = await createRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 6000);

  // Look-dev knobs, overridable from the URL (?exp=0.9&env=0.3&sun=4&tm=aces&fog=0.002&elev=38&bounce=8).
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  const toneMaps: Record<string, THREE.ToneMapping> = {
    agx: THREE.AgXToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    neutral: THREE.NeutralToneMapping,
  };
  renderer.toneMapping = toneMaps[q.get('tm') ?? 'aces'] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exp', 0.8);

  const sky = createSky(renderer, scene, num('elev', 38), num('azim', -50), num('bounce', 8));
  sky.sun.intensity = num('sun', 4);
  scene.environmentIntensity = num('env', 0.3);
  scene.fog = new THREE.FogExp2(0xd9c9ae, num('fog', 0.0011));

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
  const palms = buildPalms(plan.palmGroves, mats);
  scene.add(palms.group);

  // Spawn on the street crossing nearest the plan's spawn point, facing the ziggurat.
  const [sx, sz] = new StreetGrid().crossingNear(...plan.spawn.near);
  const spawn = new THREE.Vector3(sx, 0, sz);
  const [lx, lz] = plan.spawn.lookAt;
  // Face down whichever street runs closest to the direction of the ziggurat.
  const [dx, dz] = [lx - sx, lz - sz];
  const along = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx), 0] : [0, Math.sign(dz)];
  const spawnYaw = Math.atan2(-along[0], -along[1]);
  const player = new Player(physics, camera, renderer.domElement, spawn, spawnYaw);

  const pose = q.has('view') ? viewPose(q.get('view')!, spawn, spawnYaw) : undefined;
  if (pose) {
    player.enabled = false;
    camera.position.copy(pose.pos);
    camera.lookAt(pose.look);
  } else {
    player.update(0);
  }

  loading.textContent = 'Building the houses around you…';
  await new Promise((r) => setTimeout(r));
  city.preload(camera.position.x, camera.position.z);

  const pipeline = createPipeline(renderer, scene, camera);
  const stats = new StatsOverlay(renderer, isWebGPU(renderer) ? 'WebGPU' : 'WebGL 2 fallback');
  const adaptive = new AdaptiveResolution(renderer);
  stats.extra = () =>
    `res ${adaptive.scale.toFixed(2)}x  blocks ${city.loadedCount}  build ${city.lastBuildMs.toFixed(1)} ms\n` +
    `${city.houseCount} houses`;
  // Handles for scripted checks (scripts/ and headless probes).
  const zy = THREE.MathUtils.degToRad(plan.ziggurat.rotation ?? 0);
  const stairFoot = new THREE.Vector3(0, 0, plan.ziggurat.terraces[0].depth / 2 + 38)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), zy)
    .add(new THREE.Vector3(plan.ziggurat.position[0], 0, plan.ziggurat.position[1]));
  Object.assign(window as unknown as Record<string, unknown>, {
    __city: city,
    __player: player,
    __stairFoot: { x: stairFoot.x, z: stairFoot.z, yaw: zy },
  });

  loading.remove();
  const hint = document.getElementById('hint')!;
  if (!pose) hint.hidden = false;
  document.addEventListener('pointerlockchange', () => {
    hint.hidden = player.locked || Boolean(pose);
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ?autopilot=6 drifts a posed camera along +x at that speed, to test streaming while moving.
  const autopilot = num('autopilot', 0);

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    player.update(dt);
    if (pose && autopilot) camera.position.x += autopilot * dt;
    physics.world.step();
    const { x, z } = camera.position;
    city.update(x, z);
    palms.update(x, z);
    followSun(sky, x, z);

    pipeline.render();
    stats.tick();
    if (!pose) adaptive.tick();
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Something went wrong starting the game: ${err?.message ?? err}`;
});
