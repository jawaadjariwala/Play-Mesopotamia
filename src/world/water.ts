import * as THREE from 'three/webgpu';
import { color, mix, normalize, positionWorld, smoothstep, texture, time, transformNormalToView, vec2, vec3 } from 'three/tsl';
import { noiseTex } from './materials';

/**
 * Water for the river, canals and harbours: two layers of ripples drifting in different
 * directions (read from the baked noise texture), so the surface catches the sky and the
 * sun in moving glints. Silty green-brown underneath, as southern Mesopotamian water is.
 */
export function createWaterMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0 });
  const p = positionWorld.xz;
  // Slope from small offsets of a two-layer height field.
  const h = (o: [number, number]) => {
    const q = p.add(vec2(...o));
    const a = texture(noiseTex, q.div(9).add(vec2(0.02, 0.013).mul(time))).r;
    const b = texture(noiseTex, q.div(3.4).add(vec2(-0.017, 0.024).mul(time))).r;
    return a.mul(0.65).add(b.mul(0.35));
  };
  const e = 0.35;
  const dx = h([e, 0]).sub(h([-e, 0]));
  const dz = h([0, e]).sub(h([0, -e]));
  // Gentle: steep ripples reflect pure sky at grazing angles and the water turns to white blotches.
  const n = normalize(vec3(dx.mul(-0.32), 1, dz.mul(-0.32)));
  m.normalNode = transformNormalToView(n);
  // Darker and greener in open water, a little lighter and siltier in patches.
  const silt = smoothstep(0.3, 0.8, texture(noiseTex, p.div(260)).r);
  m.colorNode = mix(color(new THREE.Color(0x30494a)), color(new THREE.Color(0x46523f)), silt.mul(0.35));
  return m;
}
