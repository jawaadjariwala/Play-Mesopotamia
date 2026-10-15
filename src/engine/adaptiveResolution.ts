import type * as THREE from 'three/webgpu';

interface Level {
  scale: number;
  ao: boolean;
}

/**
 * Keeps walking smooth by trading image quality for frame rate, one step at a time:
 * a little resolution first, then ambient occlusion (the most expensive pass), then
 * more resolution. Steps down quickly when under 52 fps, steps back up only after
 * several seconds of headroom so it doesn't flicker between levels.
 */
export class QualityGovernor {
  private frames = 0;
  private windowStart = performance.now();
  private goodSeconds = 0;
  private cooldown = 0;
  readonly levels: Level[];
  level = 0;

  constructor(
    private renderer: THREE.WebGPURenderer,
    private onAOChange: (enabled: boolean) => void,
  ) {
    // Retina screens render at 1.5x by default: barely visible after FXAA, ~44% fewer pixels than 2x.
    const top = Math.min(window.devicePixelRatio, 1.5);
    const floor = Math.max(0.6, top * 0.55);
    this.levels = [
      { scale: top, ao: true },
      { scale: Math.max(floor, top * 0.85), ao: true },
      { scale: Math.max(floor, top * 0.85), ao: false },
      { scale: Math.max(floor, top * 0.7), ao: false },
      { scale: floor, ao: false },
    ];
    this.apply();
  }

  get current(): Level {
    return this.levels[this.level];
  }

  describe(): string {
    const l = this.current;
    return `quality ${this.levels.length - this.level}/${this.levels.length}  res ${l.scale.toFixed(2)}x  AO ${l.ao ? 'on' : 'off'}`;
  }

  tick() {
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed < 1000) return;
    const fps = (this.frames * 1000) / elapsed;
    this.frames = 0;
    this.windowStart = now;
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    if (fps < 52 && this.level < this.levels.length - 1) {
      this.level++;
      this.goodSeconds = 0;
      this.apply();
    } else if (fps > 58.5) {
      this.goodSeconds++;
      // Earn your way back up: longer when the next step turns AO back on.
      const needed = this.levels[this.level - 1]?.ao && !this.current.ao ? 8 : 4;
      if (this.level > 0 && this.goodSeconds >= needed) {
        this.level--;
        this.goodSeconds = 0;
        this.apply();
      }
    } else {
      this.goodSeconds = 0;
    }
  }

  private apply() {
    this.renderer.setPixelRatio(this.current.scale);
    this.onAOChange(this.current.ao);
    // Let the new setting settle before judging it.
    this.cooldown = 1;
  }
}
