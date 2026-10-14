import * as THREE from 'three/webgpu';
import { RAPIER, type Physics } from '../engine/physics';

const EYE_HEIGHT = 1.62;
const CAPSULE_HALF = 0.55;
const CAPSULE_RADIUS = 0.3;
const WALK = 2.0; // m/s, an unhurried stroll
const RUN = 4.6;
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
  private walked = 0;
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
    const move = forward.multiplyScalar(fwd).add(right.multiplyScalar(side));
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

    // On the ground, only press down lightly and let snap-to-ground hold us there; feeding
    // full gravity into the contact pushes the capsule into the floor and the controller
    // then refuses to move sideways.
    this.velocityY = this.grounded ? 0 : Math.max(this.velocityY - 9.81 * dt, -20);
    const desired = { x: move.x, y: this.grounded ? -0.01 : this.velocityY * dt, z: move.z };
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();

    const p = this.body.translation();
    const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z };
    this.body.setNextKinematicTranslation(next);
    this.position.set(next.x, next.y, next.z);
    this.walked += Math.hypot(m.x, m.z);

    // Eye at head height with a gentle step bob.
    const bob = Math.sin(this.walked * 3.6) * 0.025 * Math.min(1, move.length() / (WALK * dt + 1e-6));
    this.camera.position.set(next.x, next.y - (CAPSULE_HALF + CAPSULE_RADIUS) + EYE_HEIGHT + bob, next.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
