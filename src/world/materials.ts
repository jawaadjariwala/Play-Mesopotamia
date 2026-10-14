import * as THREE from 'three/webgpu';
import {
  attribute,
  color,
  cos,
  float,
  hash,
  instanceIndex,
  luminance,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  time,
  uv,
  vec3,
} from 'three/tsl';

const BASE = import.meta.env.BASE_URL;
const loader = new THREE.TextureLoader();

/** Poly Haven texture set: _diff (sRGB colour), _nor (OpenGL normal), _arm (AO, roughness, metal). */
async function loadSet(id: string, anisotropy: number) {
  const load = async (suffix: string, srgb: boolean) => {
    const t = await loader.loadAsync(`${BASE}textures/${id}_${suffix}.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const [diff, nor, arm] = await Promise.all([load('diff', true), load('nor', false), load('arm', false)]);
  return { diff, nor, arm };
}

interface SurfaceOptions {
  /** Low-frequency brightness variation so repeats don't read as a grid. */
  variation: number;
  /** Darken and dirty the bottom of vertical surfaces, where splash and dust collect. */
  groundGrime: number;
  tint?: THREE.ColorRepresentation;
  normalStrength?: number;
  /** Multiply by the per-vertex 'shade' attribute (only for MeshBuilder geometry). */
  shaded?: boolean;
  /** 1 keeps the scanned colour, lower values push it toward grey. */
  saturation?: number;
  /** Patches where the surface layer has fallen away to show what's underneath. */
  reveal?: { diff: THREE.Texture; scale: number; threshold: number; tint: THREE.ColorRepresentation };
  /** Dark vertical runs where rain has washed mud down from the wall tops. */
  streaks?: number;
}

async function surface(id: string, anisotropy: number, opts: SurfaceOptions) {
  const { diff, nor, arm } = await loadSet(id, anisotropy);
  return surfaceFrom({ diff, nor, arm }, opts);
}

function surfaceFrom({ diff, nor, arm }: Awaited<ReturnType<typeof loadSet>>, opts: SurfaceOptions) {
  const m = new THREE.MeshStandardNodeMaterial({
    normalMap: nor,
    normalScale: new THREE.Vector2(opts.normalStrength ?? 1, opts.normalStrength ?? 1),
    roughnessMap: arm,
    aoMap: arm,
    metalness: 0,
  });

  const noise = mx_noise_float(positionWorld.mul(0.18)).mul(0.5).add(0.5);
  const fine = mx_noise_float(positionWorld.mul(1.3)).mul(0.5).add(0.5);
  const variation = mix(float(1 - opts.variation), float(1 + opts.variation * 0.4), noise.mul(0.75).add(fine.mul(0.25)));
  const grime = smoothstep(0.0, 0.7, positionWorld.y).oneMinus().mul(opts.groundGrime);
  const dust = vec3(0.42, 0.33, 0.24);

  let base = texture(diff, uv()).rgb.mul(variation);
  if (opts.shaded) base = base.mul(attribute('shade', 'float'));
  if (opts.saturation !== undefined) base = mix(vec3(luminance(base)), base, opts.saturation);
  if (opts.tint !== undefined) base = base.mul(color(new THREE.Color(opts.tint)));
  if (opts.reveal) {
    const r = opts.reveal;
    // Plaster flakes off in blotches, more of it low down where water and passing feet wear it.
    const blotches = mx_noise_float(positionWorld.mul(0.45)).add(mx_noise_float(positionWorld.mul(1.9)).mul(0.3));
    const wear = blotches.add(smoothstep(0.0, 1.8, positionWorld.y).oneMinus().mul(0.3));
    const mask = smoothstep(r.threshold, r.threshold + 0.04, wear);
    const rim = smoothstep(r.threshold - 0.07, r.threshold, wear).sub(mask);
    const under = texture(r.diff, uv().mul(r.scale)).rgb.mul(color(new THREE.Color(r.tint)));
    base = mix(base.mul(rim.mul(0.35).oneMinus()), under, mask);
  }
  if (opts.streaks) {
    // Noise stretched vertically reads as runs; strongest just under the wall tops.
    const runs = mx_noise_float(vec3(positionWorld.x.mul(2.6), positionWorld.y.mul(0.12), positionWorld.z.mul(2.6)));
    const fromTop = smoothstep(1.4, 3.4, positionWorld.y);
    const streak = smoothstep(0.15, 0.6, runs).mul(fromTop).mul(opts.streaks);
    base = base.mul(streak.mul(0.32).oneMinus());
  }
  m.colorNode = mix(base, base.mul(dust).mul(1.6), grime.clamp(0, 0.6));
  return m;
}

export interface Materials {
  plaster: THREE.MeshStandardNodeMaterial;
  bakedBrick: THREE.MeshStandardNodeMaterial;
  mudRoof: THREE.MeshStandardNodeMaterial;
  ground: THREE.MeshStandardNodeMaterial;
  timber: THREE.MeshStandardNodeMaterial;
  pottery: THREE.MeshStandardNodeMaterial;
  bark: THREE.MeshStandardNodeMaterial;
  /** Palm fronds: colour comes from vertex colours, sway from the wind uniform. */
  frond: THREE.MeshStandardNodeMaterial;
}

export async function createMaterials(renderer: THREE.WebGPURenderer): Promise<Materials> {
  const aniso = Math.min(8, renderer.getMaxAnisotropy());
  const [plasterSet, brickSet] = await Promise.all([loadSet('clay_plaster', aniso), loadSet('brown_brick_02', aniso)]);
  // Unbaked mudbrick shows through worn plaster: same coursing as the baked footing, browner and duller.
  const plaster = surfaceFrom(plasterSet, {
    variation: 0.22,
    groundGrime: 0.9,
    tint: 0xf0e2cc,
    reveal: { diff: brickSet.diff, scale: 2.4 / 1.6, threshold: 0.62, tint: 0xa08a70 },
    streaks: 1,
    shaded: true,
  });
  // Ur's baked bricks are a pale buff, not the orange of modern fired brick.
  const bakedBrick = surfaceFrom(brickSet, { variation: 0.15, groundGrime: 0.7, tint: 0xe6d6bc, saturation: 0.45, shaded: true });
  const [mudRoof, ground, timber, bark] = await Promise.all([
    surface('clay_block_wall', aniso, { variation: 0.2, groundGrime: 0, shaded: true }),
    surface('dirt_floor', aniso, { variation: 0.3, groundGrime: 0, normalStrength: 1.2 }),
    // Doors and lintels: palm and poplar planks, sun-bleached.
    surface('weathered_brown_planks', aniso, { variation: 0.15, groundGrime: 0.4, tint: 0xc4ad94, saturation: 0.75 }),
    surface('bark_willow', aniso, { variation: 0.2, groundGrime: 0.3, tint: 0xcdb89c, saturation: 0.8 }),
  ]);
  // Unglazed wheel-thrown pottery: pale buff clay. Reuses the plaster maps for surface texture.
  const pottery = surfaceFrom(plasterSet, { variation: 0.25, groundGrime: 0.5, tint: 0xffe2bd, saturation: 0.9 });
  pottery.roughness = 0.85;

  const frond = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
  // Sway weight is baked per vertex (0 at the crown, 1 at frond tips); each palm gets its own phase.
  // Instancing runs before positionNode, so positionLocal here is already in instance space.
  const reach = attribute('sway', 'float').mul(0.16);
  const phase = hash(instanceIndex).mul(6.28);
  frond.positionNode = positionLocal.add(
    vec3(sin(time.mul(1.1).add(phase).add(positionLocal.y.mul(0.6))), 0, cos(time.mul(0.83).add(phase))).mul(reach),
  );
  return { plaster, bakedBrick, mudRoof, ground, timber, pottery, bark, frond };
}
