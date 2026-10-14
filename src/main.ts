import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPipeline, createRenderer, isWebGPU } from './engine/renderer';
import { createSky } from './engine/sky';
import { StatsOverlay } from './engine/stats';
import { createMaterials } from './world/materials';
import { MeshBuilder, rectCorners } from './world/generator/meshBuilder';
import { buildBuilding, buildZiggurat, type BuildingSpec, type ZigguratSpec } from './world/generator/buildings';
import { buildPalms, type GroveSpec } from './world/props/palm';
import { buildPottery, type PropSpec } from './world/props/pottery';
import block from '../content/city/test-block.json';

/** Camera presets for look-dev screenshots: ?view=street | courtyard | aerial */
const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  street: { pos: [-7, 1.7, 0.1], target: [20, 3.2, 0.1] },
  courtyard: { pos: [4.6, 1.65, 8.4], target: [8.6, 2.3, 5.2] },
  aerial: { pos: [-22, 26, 30], target: [8, 0, 2] },
};

async function main() {
  const renderer = await createRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 6000);

  const view = VIEWS[new URLSearchParams(location.search).get('view') ?? 'street'] ?? VIEWS.street;
  camera.position.set(...view.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...view.target);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  // Look-dev knobs, overridable from the URL (?exp=1.1&env=0.3&sun=4&tm=aces&fog=0.002&elev=38).
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  const toneMaps: Record<string, THREE.ToneMapping> = {
    agx: THREE.AgXToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    neutral: THREE.NeutralToneMapping,
  };
  renderer.toneMapping = toneMaps[q.get('tm') ?? 'aces'] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = num('exp', 0.8);

  // Sun behind the viewer on the main street, lighting the north facades and the ziggurat's stair.
  const { sun } = createSky(renderer, scene, num('elev', 38), num('azim', -50), num('bounce', 8));
  sun.intensity = num('sun', 4);
  scene.environmentIntensity = num('env', 0.3);
  scene.fog = new THREE.FogExp2(0xd9c9ae, num('fog', 0.0024));

  const mats = await createMaterials(renderer);

  const ground = new MeshBuilder(3.5);
  ground.quad(...(rectCorners(-1500, -1500, 1500, 1500, 0) as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3]));
  const groundMesh = new THREE.Mesh(ground.build(), mats.ground);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  for (const spec of block.buildings as BuildingSpec[]) {
    scene.add(buildBuilding(spec, mats).group);
  }
  scene.add(buildZiggurat(block.ziggurat as ZigguratSpec, mats));
  scene.add(buildPottery(block.props as PropSpec[], mats));
  scene.add(buildPalms(block.palmGroves as GroveSpec[], mats));

  const pipeline = createPipeline(renderer, scene, camera);
  const stats = new StatsOverlay(renderer, isWebGPU(renderer) ? 'WebGPU' : 'WebGL 2 fallback');
  document.getElementById('loading')?.remove();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    pipeline.render();
    stats.tick();
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Something went wrong starting the renderer: ${err?.message ?? err}`;
});
