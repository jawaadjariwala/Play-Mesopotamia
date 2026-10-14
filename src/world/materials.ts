import * as THREE from 'three/webgpu';
import { color, float, luminance, mix, mx_noise_float, positionWorld, smoothstep, texture, uv, vec3 } from 'three/tsl';

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
  /** 1 keeps the scanned colour, lower values push it toward grey. */
  saturation?: number;
  /** Patches where the surface layer has fallen away to show what's underneath. */
  reveal?: { diff: THREE.Texture; scale: number; threshold: number; tint: THREE.ColorRepresentation };
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
  m.colorNode = mix(base, base.mul(dust).mul(1.6), grime.clamp(0, 0.6));
  return m;
}

export interface Materials {
  plaster: THREE.MeshStandardNodeMaterial;
  bakedBrick: THREE.MeshStandardNodeMaterial;
  mudRoof: THREE.MeshStandardNodeMaterial;
  ground: THREE.MeshStandardNodeMaterial;
  timber: THREE.MeshStandardNodeMaterial;
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
  });
  // Ur's baked bricks are a pale buff, not the orange of modern fired brick.
  const bakedBrick = surfaceFrom(brickSet, { variation: 0.15, groundGrime: 0.7, tint: 0xe6d6bc, saturation: 0.45 });
  const [mudRoof, ground] = await Promise.all([
    surface('clay_block_wall', aniso, { variation: 0.2, groundGrime: 0 }),
    surface('dirt_floor', aniso, { variation: 0.3, groundGrime: 0, normalStrength: 1.2 }),
  ]);
  // Palm-trunk lintels and door frames; plain until we have a CC0 wood set.
  const timber = new THREE.MeshStandardNodeMaterial({ color: 0x4a3626, roughness: 0.9 });
  return { plaster, bakedBrick, mudRoof, ground, timber };
}
