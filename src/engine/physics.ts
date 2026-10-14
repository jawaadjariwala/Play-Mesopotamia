import RAPIER from '@dimforge/rapier3d-compat';
import type { ColliderBox } from '../world/generator/buildings';
import type { ColliderSink } from '../world/city/streamer';

/** Static-world physics: a ground plane plus boxes that the city streamer adds and removes. */
export class Physics implements ColliderSink {
  private constructor(readonly world: RAPIER.World) {}

  static async create(): Promise<Physics> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    // The ground is tiled: one huge box loses enough precision that the character
    // controller sinks into it while walking (measured ~16 cm).
    const TILE = 40; // half-size
    for (let x = -520; x <= 520; x += TILE * 2) {
      for (let z = -720; z <= 720; z += TILE * 2) {
        world.createCollider(RAPIER.ColliderDesc.cuboid(TILE, 1, TILE).setTranslation(x, -1, z));
      }
    }
    return new Physics(world);
  }

  add(boxes: ColliderBox[]): RAPIER.Collider[] {
    return boxes.map((b) => {
      const half = b.rotationY / 2;
      const desc = RAPIER.ColliderDesc.cuboid(b.halfExtents.x, b.halfExtents.y, b.halfExtents.z)
        .setTranslation(b.center.x, b.center.y, b.center.z)
        .setRotation(b.rotation ?? { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
      return this.world.createCollider(desc);
    });
  }

  remove(handle: unknown) {
    for (const c of handle as RAPIER.Collider[]) this.world.removeCollider(c, false);
  }
}

export { RAPIER };
