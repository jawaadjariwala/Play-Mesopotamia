import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { vec4 } from 'three/tsl';

const SHADOW_EXTENT = 38;
const SKY_BRIGHTNESS = 0.5;

export interface SkyRig {
  sun: THREE.DirectionalLight;
  sunDirection: THREE.Vector3;
}

/**
 * Physical sky, a matching sun, and image-based lighting baked from that same sky
 * so shadows, sky colour and ambient light all agree.
 */
export function createSky(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  elevationDeg: number,
  azimuthDeg: number,
  /** Brightness of the warm light bounced off sunlit earth into shadows. */
  bounce = 1,
): SkyRig {
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - elevationDeg),
    THREE.MathUtils.degToRad(azimuthDeg),
  );

  const makeSky = () => {
    const sky = new SkyMesh();
    sky.scale.setScalar(4500);
    // Southern Iraq: dusty and almost cloudless. Mie scattering (the bright halo around
    // the sun) is kept modest; strong values wash the whole sun side of the sky out to white.
    sky.turbidity.value = 6;
    sky.rayleigh.value = 1.8;
    sky.mieCoefficient.value = 0.002;
    sky.mieDirectionalG.value = 0.72;
    sky.cloudCoverage.value = 0.12;
    sky.cloudDensity.value = 0.25;
    sky.sunPosition.value.copy(sunDirection);
    return sky;
  };

  // The physical sky is far brighter than the sunlit city, so tone mapping clips the sun
  // side of it to white. Scale only what you see; lighting still comes from the full sky.
  const visible = makeSky();
  const skyMat = visible.material as THREE.NodeMaterial;
  skyMat.colorNode = (skyMat.colorNode as ReturnType<typeof vec4>).mul(vec4(SKY_BRIGHTNESS, SKY_BRIGHTNESS, SKY_BRIGHTNESS, 1));
  scene.add(visible);

  // Bake the sky into an environment map for ambient light and reflections.
  const envScene = new THREE.Scene();
  const envSky = makeSky();
  envSky.showSunDisc.value = 0;
  // Dustier, whiter sky for the lighting only, so shade reads warm-grey rather than blue.
  envSky.rayleigh.value = 0.55;
  envSky.turbidity.value = 12;
  envScene.add(envSky);
  // Without this the lower half of the environment is sky-blue and every shadow turns cold.
  // Sunlit mud and dust throw warm light back up into streets and courtyards.
  const groundBounce = new THREE.Mesh(
    new THREE.CircleGeometry(5000, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.62, 0.45, 0.3).multiplyScalar(bounce) }),
  );
  groundBounce.position.y = -5;
  envScene.add(groundBounce);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02, 0.1, 10000).texture;
  scene.environmentIntensity = 0.55;

  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  sun.position.copy(sunDirection).multiplyScalar(120);
  sun.castShadow = true;
  // A tight shadow box that follows the player (see followSun); far shadows fade into the haze anyway.
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -SHADOW_EXTENT;
  s.right = SHADOW_EXTENT;
  s.top = SHADOW_EXTENT;
  s.bottom = -SHADOW_EXTENT;
  s.near = 1;
  s.far = 300;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  return { sun, sunDirection };
}

/** Keep the shadow box centred on the player, snapped to whole shadow-map texels to avoid shimmer. */
export function followSun(rig: SkyRig, x: number, z: number) {
  const texel = (2 * SHADOW_EXTENT) / rig.sun.shadow.mapSize.x;
  const sx = Math.round(x / texel) * texel;
  const sz = Math.round(z / texel) * texel;
  rig.sun.target.position.set(sx, 0, sz);
  rig.sun.position.set(sx, 0, sz).addScaledVector(rig.sunDirection, 150);
}
