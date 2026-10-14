import * as THREE from 'three/webgpu';

type V3 = THREE.Vector3;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Accumulates flat-shaded quads and boxes, with UVs projected in world metres so
 * textures line up across separate pieces of the same surface (no visible seams
 * where the generator splits a wall around a door).
 */
export class MeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];
  private shades: number[] = [];

  /** Per-vertex brightness multiplier, so each house can have its own plaster tone. */
  shade = 1;

  /** Applied to every point before it is stored, so callers can work in a building's local frame. */
  transform: THREE.Matrix4 | null = null;

  /** @param tile metres covered by one repeat of the texture */
  constructor(private tile: number) {}

  quad(a: V3, b: V3, c: V3, d: V3) {
    if (this.transform) {
      const m = this.transform;
      [a, b, c, d] = [a, b, c, d].map((p) => p.clone().applyMatrix4(m));
    }
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    // Horizontal-ish faces map on XZ; everything else maps along its own horizontal tangent.
    const isFlat = Math.abs(n.y) > 0.7;
    const tangent = isFlat ? null : new THREE.Vector3().crossVectors(UP, n).normalize();
    const base = this.positions.length / 3;
    for (const p of [a, b, c, d]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      this.shades.push(this.shade);
      if (tangent) this.uvs.push(p.dot(tangent) / this.tile, p.y / this.tile);
      else this.uvs.push(p.x / this.tile, p.z / this.tile);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /**
   * A box whose bottom face is `bottom` (4 corners, counter-clockwise from above)
   * and whose top face is `top`. Tapered boxes (ziggurat terraces) just pass a smaller top.
   */
  prism(bottom: V3[], top: V3[], skipBottom = true) {
    const [b0, b1, b2, b3] = bottom;
    const [t0, t1, t2, t3] = top;
    this.quad(t0, t1, t2, t3);
    if (!skipBottom) this.quad(b3, b2, b1, b0);
    this.quad(b0, b1, t1, t0);
    this.quad(b1, b2, t2, t1);
    this.quad(b2, b3, t3, t2);
    this.quad(b3, b0, t0, t3);
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  get empty() {
    return this.indices.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('shade', new THREE.Float32BufferAttribute(this.shades, 1));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    return g;
  }
}

/** Corners of an oriented box footprint at height y, counter-clockwise seen from above. */
export function footprint(
  origin: THREE.Vector2,
  along: THREE.Vector2,
  a0: number,
  a1: number,
  halfThickness: number,
  y: number,
): V3[] {
  const across = new THREE.Vector2(-along.y, along.x);
  const at = (a: number, s: number) => {
    const p = origin.clone().addScaledVector(along, a).addScaledVector(across, s);
    return new THREE.Vector3(p.x, y, p.y);
  };
  return [at(a0, halfThickness), at(a1, halfThickness), at(a1, -halfThickness), at(a0, -halfThickness)];
}

export function rectCorners(x0: number, z0: number, x1: number, z1: number, y: number): V3[] {
  return [
    new THREE.Vector3(x0, y, z1),
    new THREE.Vector3(x1, y, z1),
    new THREE.Vector3(x1, y, z0),
    new THREE.Vector3(x0, y, z0),
  ];
}
