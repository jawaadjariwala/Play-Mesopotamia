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
  dot,
  mix,
  smoothstep,
  vec2,
  vec3,
  vec4,
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
  // Debug: ?nofx renders the scene straight to the screen (no bloom, no FXAA, no AO).
  if (new URLSearchParams(location.search).has('nofx')) {
    pipeline.outputColorTransform = true;
    pipeline.outputNode = pass(scene, camera);
    return pipeline;
  }
  if (!options.ao) {
    const color = pass(scene, camera).getTextureNode();
    pipeline.outputNode = fxaa(grade(renderOutput(color.add(bloom(color, 0.05, 0.25, 1.4)))));
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

  pipeline.outputNode = fxaa(grade(renderOutput(color.add(glow))));
  return pipeline;
}

/**
 * A light colour grade on the final (display-space) image: a touch more richness, slightly
 * warm shadows and cool highlights kept in check, gentle contrast, and a soft vignette.
 */
function grade(c: ReturnType<typeof renderOutput>) {
  const rgb = c.rgb;
  const lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  let g = mix(vec3(lum), rgb, 1.1);
  // Warm the darker tones a little, leave highlights alone.
  g = g.add(vec3(0.018, 0.008, -0.012).mul(lum.oneMinus()));
  // Gentle S-curve.
  g = g.sub(0.5).mul(1.05).add(0.5);
  const v = smoothstep(0.45, 1.05, screenUV.sub(0.5).mul(vec2(1.25, 1)).length().mul(1.35));
  g = g.mul(v.mul(0.22).oneMinus());
  return vec4(g.clamp(0, 1), c.a);
}
