import * as THREE from 'three/webgpu';
import { distanceToOuterCanal, distanceToPath, insideWallShape, type CityPlan } from './city/plan';

/** Water surfaces outside the walls sit this far below the ground. */
export const OUTER_WATER_LEVEL = -0.45;

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const h = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - xi);
  const fz = s(z - zi);
  const a = h(xi, zi) + (h(xi + 1, zi) - h(xi, zi)) * fx;
  const b = h(xi, zi + 1) + (h(xi + 1, zi + 1) - h(xi, zi + 1)) * fx;
  return a + (b - a) * fz;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Ground height: flat inside the city and for a strip around the wall; gentle rises and
 * hollows of a metre or two beyond; the river and outer canal cut into it with sloped
 * banks and a low natural levee along the river.
 */
export function terrainHeight(x: number, z: number, p: CityPlan): number {
  if (insideWallShape(x, z, -(p.wall.baseWidth / 2 + 4), p)) return 0;
  const away = insideWallShape(x, z, -(p.wall.baseWidth / 2 + 70), p) ? 0.25 : 1;
  let h = ((valueNoise(x / 380, z / 380) - 0.5) * 3.2 + (valueNoise(x / 110 + 7, z / 110) - 0.5) * 0.9) * away;

  const r = p.water.river;
  const dr = distanceToPath(x, z, r.path) - r.width / 2;
  // Bed below the water, a sloped bank, then a low levee before the plain.
  const bed = -2.2;
  const levee = 0.7 * smooth(4, 14, dr) * (1 - smooth(18, 46, dr));
  h = THREE.MathUtils.lerp(bed, h + levee, smooth(-6, 10, dr));

  const dc = distanceToOuterCanal(x, z, p) - p.water.canal.width / 2;
  if (dc < 20) h = THREE.MathUtils.lerp(-1.4, h, smooth(-3, 8, dc));
  return h;
}

/**
 * The ground as tiles (so off-screen ones are culled). Tiles wholly inside the flat zone
 * are single quads; the rest are grids whose UVs follow world metres like everything else.
 */
export function buildTerrain(p: CityPlan, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain';
  const EXTENT = 2400;
  const TILE = 480;
  const CELL = 10;
  const uvScale = 3.5;
  for (let tx = -EXTENT; tx < EXTENT; tx += TILE) {
    for (let tz = -EXTENT; tz < EXTENT; tz += TILE) {
      // Cheaper, coarser cells far from the city where fog hides detail.
      const far = Math.hypot(tx + TILE / 2, tz + TILE / 2) > 1500;
      const cell = far ? CELL * 4 : CELL;
      const n = TILE / cell;
      const corners = [
        [tx, tz],
        [tx + TILE, tz],
        [tx, tz + TILE],
        [tx + TILE, tz + TILE],
      ];
      const flat = corners.every(([x, z]) => insideWallShape(x, z, -(p.wall.baseWidth / 2 + 4), p));
      const seg = flat ? 1 : n;
      const g = new THREE.PlaneGeometry(TILE, TILE, seg, seg);
      g.rotateX(-Math.PI / 2);
      g.translate(tx + TILE / 2, 0, tz + TILE / 2);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        if (!flat) pos.setY(i, terrainHeight(x, z, p));
        uv.setXY(i, x / uvScale, -z / uvScale);
      }
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
