import type * as THREE from 'three/webgpu';

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  /** Longest single frame in the last second: hitches show up here, not in the average. */
  worstMs: number;
  backend: string;
}

/** Rolling one-second averages, shown top-left and exposed on window.__stats for scripted checks. */
export class StatsOverlay {
  private el = document.createElement('div');
  private frames = 0;
  private windowStart = performance.now();
  private last = performance.now();
  private worstMs = 0;
  readonly current: FrameStats;
  /** Extra lines for the overlay (render scale, streaming). */
  extra: () => string = () => '';

  constructor(
    private renderer: THREE.WebGPURenderer,
    backend: string,
  ) {
    this.el.id = 'stats';
    document.body.appendChild(this.el);
    this.current = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, worstMs: 0, backend };
    (window as unknown as { __stats: FrameStats }).__stats = this.current;
    renderer.info.autoReset = false;
  }

  /** Call once per frame after rendering. */
  tick() {
    const now = performance.now();
    this.worstMs = Math.max(this.worstMs, now - this.last);
    this.last = now;
    this.frames++;

    const info = this.renderer.info.render;
    const elapsed = now - this.windowStart;
    if (elapsed >= 1000) {
      Object.assign(this.current, {
        fps: Math.round((this.frames * 1000) / elapsed),
        frameMs: +(elapsed / this.frames).toFixed(1),
        drawCalls: Math.round(info.drawCalls / this.frames),
        triangles: Math.round(info.triangles / this.frames),
        worstMs: Math.round(this.worstMs),
      });
      this.el.textContent =
        `${this.current.fps} fps  ${this.current.frameMs} ms (worst ${this.worstMs.toFixed(0)})\n` +
        `${this.current.drawCalls} draws  ${(this.current.triangles / 1000).toFixed(0)}k tris\n` +
        `${this.current.backend}${this.extra() ? '\n' + this.extra() : ''}`;
      this.frames = 0;
      this.worstMs = 0;
      this.windowStart = now;
      this.renderer.info.reset();
    }
  }
}
