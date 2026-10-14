import type * as THREE from 'three/webgpu';

/**
 * Keeps the frame rate up by trading resolution: once a second, if we're under 52 fps
 * the render scale drops a step, and if we're comfortably at the refresh rate it climbs
 * back. Walking stays smooth on slower GPUs at the cost of a slightly softer image.
 */
export class AdaptiveResolution {
  private frames = 0;
  private windowStart = performance.now();
  readonly max: number;
  readonly min: number;
  scale: number;

  constructor(private renderer: THREE.WebGPURenderer) {
    this.max = Math.min(window.devicePixelRatio, 2);
    this.min = Math.max(0.6, this.max * 0.5);
    this.scale = this.max;
  }

  tick() {
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed < 1000) return;
    const fps = (this.frames * 1000) / elapsed;
    this.frames = 0;
    this.windowStart = now;
    let next = this.scale;
    if (fps < 52) next = Math.max(this.min, this.scale - 0.15);
    else if (fps > 58.5) next = Math.min(this.max, this.scale + 0.1);
    if (Math.abs(next - this.scale) > 1e-3) {
      this.scale = next;
      this.renderer.setPixelRatio(next);
    }
  }
}
