import * as THREE from 'three/webgpu';
import {
  builtinAOContext,
  colorToDirection,
  directionToColor,
  mrt,
  normalView,
  pass,
  renderOutput,
  sample,
  screenUV,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

export async function createRenderer(trackTimestamp = false): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({ antialias: false, trackTimestamp });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Without this the first frames render nothing and fail silently.
  await renderer.init();
  document.body.appendChild(renderer.domElement);
  return renderer;
}

export function isWebGPU(renderer: THREE.WebGPURenderer): boolean {
  return Boolean((renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend);
}

/**
 * Normal prepass -> GTAO (applied to indirect light only) -> scene -> bloom -> tone map -> FXAA.
 */
export function createPipeline(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  options: { ao: boolean } = { ao: true },
): THREE.RenderPipeline {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  if (!options.ao) {
    const color = pass(scene, camera).getTextureNode();
    pipeline.outputNode = fxaa(renderOutput(color.add(bloom(color, 0.05, 0.25, 1.4))));
    return pipeline;
  }
  const prePass = pass(scene, camera);
  prePass.transparent = false;
  prePass.setMRT(mrt({ output: directionToColor(normalView) }));
  const prePassNormal = sample((uv) => colorToDirection(prePass.getTextureNode().sample(uv)));

  const aoPass = ao(prePass.getTextureNode('depth'), prePassNormal, camera);
  aoPass.resolutionScale = 0.5;

  const scenePass = pass(scene, camera);
  scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);

  const color = scenePass.getTextureNode();
  const glow = bloom(color, 0.05, 0.25, 1.4);

  pipeline.outputNode = fxaa(renderOutput(color.add(glow)));
  return pipeline;
}
