import * as THREE from 'three/webgpu';
import { RAPIER, type Physics } from '../engine/physics';

const EYE_HEIGHT = 1.62;
const CAPSULE_HALF = 0.55;
const CAPSULE_RADIUS = 0.3;
const WALK = 1.7; // m/s, an unhurried stroll
const RUN = 4.4;
/** How quickly speed follows the keys (1/s): about a quarter second to get going or stop. */
const ACCEL = 9;
/** Metres per footstep, walking and running. */
const STEP_WALK = 0.75;
const STEP_RUN = 1.25;
const LOOK_SPEED = 0.0022;

/**
 * First-person walker: a kinematic capsule moved by Rapier's character controller,
 * so it slides along walls, steps over thresholds and paving, and climbs ramps.
 * Mouse look uses pointer lock; WASD or arrows to move, Shift to run.
 */
export class Player {
  readonly position = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private velocityY = 0;
  private grounded = false;
  private keys = new Set<string>();
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private velocity = new THREE.Vector3();
  private stepPhase = 0;
  private eyeY = 0;
  /** When false the camera is posed from outside (screenshots, cutscenes) and input is ignored. */
  enabled = true;

  constructor(
    private physics: Physics,
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    spawn: THREE.Vector3,
    yaw: number,
  ) {
    this.yaw = yaw;
    const world = physics.world;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, CAPSULE_HALF + CAPSULE_RADIUS + 0.1, spawn.z),
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS), this.body);
    this.controller = world.createCharacterController(0.03);
    this.controller.enableAutostep(0.32, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(38));
    this.controller.setSlideEnabled(true);
    this.position.copy(this.body.translation() as THREE.Vector3Like);

    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('click', () => {
      // requestPointerLock rejects if the user presses Esc too quickly; that's harmless.
      if (this.enabled && document.pointerLockElement !== dom) Promise.resolve(dom.requestPointerLock()).catch(() => {});
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== dom) return;
      this.yaw -= e.movementX * LOOK_SPEED;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK_SPEED, -1.35, 1.35);
    });
  }

  /** Move straight to a spot on the ground (debug, and later fast travel between places). */
  teleport(x: number, z: number, yaw: number) {
    this.body.setTranslation({ x, y: CAPSULE_HALF + CAPSULE_RADIUS + 0.1, z }, true);
    this.velocityY = 0;
    this.grounded = false;
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  get locked() {
    return document.pointerLockElement === this.dom;
  }

  update(dt: number) {
    if (!this.enabled) return;
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = forward.clone().multiplyScalar(fwd).add(right.clone().multiplyScalar(side));
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    // Ease toward the wanted velocity instead of snapping to it.
    this.velocity.lerp(wish, 1 - Math.exp(-ACCEL * dt));
    const move = this.velocity.clone().multiplyScalar(dt);

    // On the ground, don't push down at all and let snap-to-ground hold us there. Pushing
    // into the floor (even 1 cm a frame) made the controller refuse to move for a frame
    // every half second or so, which showed up as camera judder.
    this.velocityY = this.grounded ? 0 : Math.max(this.velocityY - 9.81 * dt, -20);
    const desired = { x: move.x, y: this.grounded ? 0 : this.velocityY * dt, z: move.z };
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    const p = this.body.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    this.body.setNextKinematicTranslation(next);
    this.position.set(next.x, next.y, next.z);

    // Footsteps: one soft dip per step and a slight sway per stride, both fading in with speed.
    // Driven by the smoothed walking speed, not by this frame's actual movement: a frame
    // where the physics nudges us differently must not jolt the camera.
    const speed01 = this.velocity.length();
    const run01 = THREE.MathUtils.clamp((speed01 - WALK) / (RUN - WALK), 0, 1);
    this.stepPhase += (speed01 * dt) / THREE.MathUtils.lerp(STEP_WALK, STEP_RUN, run01);
    const amount = Math.min(1, speed01 / WALK);
    const dip = THREE.MathUtils.lerp(0.016, 0.03, run01) * amount * (1 - Math.cos(this.stepPhase * Math.PI * 2)) * 0.5;
    const sway = THREE.MathUtils.lerp(0.008, 0.012, run01) * amount * Math.sin(this.stepPhase * Math.PI);

    // Smooth the eye height so steps and thresholds don't jolt the view.
    const targetEye = next.y - (CAPSULE_HALF + CAPSULE_RADIUS) + EYE_HEIGHT;
    this.eyeY = dt === 0 || Math.abs(targetEye - this.eyeY) > 1 ? targetEye : THREE.MathUtils.lerp(this.eyeY, targetEye, 1 - Math.exp(-14 * dt));
    this.camera.position.set(next.x + right.x * sway, this.eyeY - dip, next.z + right.z * sway);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
