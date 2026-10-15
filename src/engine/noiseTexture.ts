import * as THREE from 'three/webgpu';

/**
 * A small tileable fractal noise texture, generated once at startup. Materials sample
 * it in world space instead of evaluating 3D noise per pixel, which measured as a
 * large share of GPU time on full-screen walls.
 *
 * One channel of value noise with three octaves, 8 cells across at the base octave,
 * so features are about 1/8 of whatever world period it's sampled at.
 */
export function createNoiseTexture(size = 256, seed = 1): THREE.DataTexture {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const octave = (cells: number) => {
    const lattice = Array.from({ length: cells * cells }, rand);
    const at = (x: number, y: number) => lattice[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
    const smooth = (t: number) => t * t * (3 - 2 * t);
    return (u: number, v: number) => {
      const x = u * cells;
      const y = v * cells;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = smooth(x - x0);
      const fy = smooth(y - y0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      return a + (b - a) * fy;
    };
  };
  const octaves = [octave(8), octave(16), octave(32)];
  const weights = [0.6, 0.28, 0.12];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let n = 0;
      octaves.forEach((o, k) => (n += o(x / size, y / size) * weights[k]));
      // Stretch contrast back out; summed octaves bunch up around 0.5.
      const v = Math.min(255, Math.max(0, Math.round(((n - 0.5) * 1.8 + 0.5) * 255)));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
