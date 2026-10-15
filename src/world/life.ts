import * as THREE from 'three/webgpu';
import {
  attribute,
  color,
  cos,
  float,
  fract,
  hash,
  instanceIndex,
  mix,
  positionLocal,
  sin,
  smoothstep,
  time,
  uniformArray,
  uv,
  vec3,
} from 'three/tsl';
import { FOLIAGE_LAYER } from './props/palm';

/**
 * Smoke rising from cooking fires in courtyards across the city. Everything is computed on
 * the GPU from the particle's index: which fire it belongs to, where it is in its life,
 * how far the wind has carried it. No per-frame work on the CPU.
 */
export function createSmoke(fires: THREE.Vector3[]): THREE.Sprite {
  const PER_FIRE = 16;
  const bases = uniformArray(fires, 'vec3');
  const material = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const i = instanceIndex;
  const fire = i.div(PER_FIRE);
  const k = i.mod(PER_FIRE).toFloat();
  const seed = hash(fire.toFloat().mul(13.7));
  // Each puff is 0 when it leaves the fire and 1 when it has faded away (about 14 s).
  const t = fract(time.mul(0.07).add(k.div(PER_FIRE)).add(seed));
  const wind = vec3(5.5, 0, 2.2);
  const wobble = vec3(sin(time.mul(0.6).add(k.mul(1.7))), 0, cos(time.mul(0.5).add(k))).mul(t.mul(1.6));
  material.positionNode = (bases.element(fire) as unknown as ReturnType<typeof vec3>).add(vec3(0, t.mul(16), 0)).add(wind.mul(t.mul(t))).add(wobble);
  material.scaleNode = mix(float(0.9), float(7.5), t);
  // Soft round puff, thicker near the fire, gone by the end of its life.
  const d = uv().sub(0.5).length();
  const puff = smoothstep(0.5, 0.05, d);
  const life = smoothstep(0, 0.12, t).mul(t.oneMinus());
  material.colorNode = color(new THREE.Color(0xd8d2c8));
  material.opacityNode = puff.mul(life).mul(0.32);
  const sprite = new THREE.Sprite(material);
  sprite.count = fires.length * PER_FIRE;
  sprite.frustumCulled = false;
  sprite.renderOrder = 2;
  sprite.layers.set(FOLIAGE_LAYER);
  return sprite;
}

/**
 * Flocks of birds wheeling over the city and the river. One small V-shaped mesh, instanced;
 * each bird's orbit, height and wingbeat come from its index.
 */
export function createBirds(flocks: { center: THREE.Vector3; radius: number; count: number }[]): THREE.InstancedMesh {
  const total = flocks.reduce((n, f) => n + f.count, 0);
  // Two wings meeting at the body; 'wing' is 0 at the body and 1 at each tip.
  const g = new THREE.BufferGeometry();
  const span = 0.55;
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0.18, -span, 0, -0.05, 0, 0, -0.15, 0, 0, 0.18, 0, 0, -0.15, span, 0, -0.05], 3),
  );
  g.setAttribute('wing', new THREE.Float32BufferAttribute([0, 1, 0, 0, 0, 1], 1));
  g.computeVertexNormals();

  const centers: THREE.Vector3[] = [];
  const radii: number[] = [];
  const flockOf: number[] = [];
  flocks.forEach((f, fi) => {
    centers.push(f.center);
    radii.push(f.radius);
    for (let b = 0; b < f.count; b++) flockOf.push(fi);
  });
  const flockCenter = uniformArray(centers, 'vec3');
  const flockRadius = uniformArray(radii, 'float');
  const flockIndex = uniformArray(flockOf, 'float');

  const material = new THREE.MeshStandardNodeMaterial({ color: 0x2b2622, roughness: 0.9, side: THREE.DoubleSide });
  const idx = instanceIndex;
  const fi = (flockIndex.element(idx) as unknown as ReturnType<typeof float>).toInt();
  const seed = hash(idx.toFloat().mul(7.31));
  const speed = mix(float(0.09), float(0.14), seed);
  const angle = time.mul(speed).add(seed.mul(6.283));
  const r = (flockRadius.element(fi) as unknown as ReturnType<typeof float>).mul(mix(float(0.55), float(1.0), hash(idx.toFloat().mul(3.1))));
  const heightJitter = sin(time.mul(0.4).add(seed.mul(9))).mul(3).add(seed.mul(14));
  const centre = flockCenter.element(fi) as unknown as ReturnType<typeof vec3>;
  const pos = vec3(cos(angle).mul(r), heightJitter, sin(angle).mul(r)).add(centre);
  // Flap: wingtips rise and fall; the bird faces along its circle.
  const flap = sin(time.mul(mix(float(7), float(10), seed)).add(seed.mul(20))).mul(0.28).mul(attribute('wing', 'float'));
  const local = positionLocal.add(vec3(0, flap, 0));
  // Nose (+z) points along the direction of travel round the circle.
  const heading = angle;
  const rotated = vec3(local.x.mul(cos(heading)).sub(local.z.mul(sin(heading))), local.y, local.x.mul(sin(heading)).add(local.z.mul(cos(heading))));
  material.positionNode = rotated.mul(2.2).add(pos);

  const mesh = new THREE.InstancedMesh(g, material, total);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.name = 'birds';
  return mesh;
}
