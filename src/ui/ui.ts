import './ui.css';
import type { Player } from '../player/player';
import type { CityPlan } from '../world/city/plan';
import { wallVertices } from '../world/city/plan';

export interface Place {
  name: string;
  hint: string;
  x: number;
  z: number;
  yaw: number;
}

type State = 'start' | 'walking' | 'paused';

/**
 * Start screen, pause menu with places to go, a map, and touch controls.
 * Keyboard and mouse use pointer lock (Esc pauses); touch screens get a stick, a run
 * button and drag-to-look, switched on the first time the screen is touched.
 */
export class GameUI {
  private state: State = 'start';
  private root = document.createElement('div');
  private touchMode = matchMedia('(pointer: coarse)').matches;
  private map!: HTMLCanvasElement;
  private mapBase!: HTMLCanvasElement;
  private toMap!: (x: number, z: number) => [number, number];

  constructor(
    private player: Player,
    private canvas: HTMLCanvasElement,
    private places: Place[],
    private plan: CityPlan,
  ) {
    this.root.id = 'ui';
    this.root.innerHTML = `
      <section class="panel" id="start" aria-labelledby="start-title">
        <div class="glyph" lang="akk" aria-hidden="true">𒋀𒀊𒆠</div>
        <p class="glyph-gloss">“Urim”, the name of Ur, as its people wrote it in cuneiform.</p>
        <h1 id="start-title">Ur, around 1750 BCE</h1>
        <p>Walk through one of the world’s first great cities: its crowded lanes, the canal and harbours, and the temple district around the ziggurat of the moon god Nanna.</p>
        <button class="primary" id="start-btn">Start walking</button>
        <p class="controls" data-input="keys">Move with W A S D or the arrow keys, look with the mouse, hold Shift to run. Press Esc for the menu.</p>
        <p class="controls" data-input="touch">Move with the stick, drag anywhere to look around, tap Run to run.</p>
        <details>
          <summary>About this reconstruction</summary>
          <p>The city’s size and shape, the temple district, the harbours and the house plans follow the excavations at Ur. Individual houses and streets are generated to match what was found; the canal through the city and the buildings inside the temple district are informed guesses.</p>
        </details>
      </section>
      <section class="panel" id="pause" hidden aria-labelledby="pause-title">
        <h2 id="pause-title">Paused</h2>
        <button class="primary" id="resume-btn">Resume walking</button>
        <h3>Go to</h3>
        <ul class="places">${places
          .map((p, i) => `<li><button data-place="${i}"><strong>${p.name}</strong><span>${p.hint}</span></button></li>`)
          .join('')}</ul>
      </section>
      <canvas id="map" class="hud" hidden aria-label="Map of Ur showing where you are"></canvas>
      <button id="menu-btn" class="hud" hidden aria-label="Open menu"><i></i></button>
      <div id="stick" class="hud touch" hidden aria-hidden="true"><div class="knob"></div></div>
      <button id="run-btn" class="hud touch" hidden aria-pressed="false">Run</button>
    `;
    document.body.appendChild(this.root);
    this.buildMap();
    this.wire();
    this.setInputMode(this.touchMode);
  }

  get atStart() {
    return this.state === 'start';
  }

  get walking() {
    return this.state === 'walking';
  }

  /** Begin walking (also used by scripted checks, which can't click). */
  start() {
    this.setState('walking');
    this.player.enabled = true;
    if (!this.touchMode) this.player.lockPointer();
  }

  private $<T extends HTMLElement>(sel: string) {
    return this.root.querySelector(sel) as T;
  }

  private setState(s: State) {
    this.state = s;
    this.$('#start').hidden = s !== 'start';
    this.$('#pause').hidden = s !== 'paused';
    for (const el of this.root.querySelectorAll<HTMLElement>('.hud')) {
      const touchOnly = el.classList.contains('touch');
      el.hidden = s !== 'walking' || (touchOnly && !this.touchMode);
    }
    this.player.enabled = s === 'walking';
    if (s !== 'walking') {
      this.player.stick.x = this.player.stick.y = 0;
    }
    if (s === 'paused') this.$<HTMLButtonElement>('#resume-btn').focus();
  }

  private setInputMode(touch: boolean) {
    this.touchMode = touch;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-input]')) {
      el.hidden = (el.dataset.input === 'touch') !== touch;
    }
    if (this.state === 'walking') this.setState('walking');
  }

  private wire() {
    this.$('#start-btn').addEventListener('click', () => this.start());
    this.$('#resume-btn').addEventListener('click', () => this.start());
    this.$('#menu-btn').addEventListener('click', () => {
      if (document.pointerLockElement) document.exitPointerLock();
      this.setState('paused');
    });
    this.$('#pause').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-place]');
      if (!btn) return;
      const p = this.places[Number(btn.dataset.place)];
      this.player.teleport(p.x, p.z, p.yaw);
      this.start();
    });
    // Losing pointer lock (Esc) pauses.
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'walking' && !this.touchMode) this.setState('paused');
    });
    // Clicking the scene while walking re-captures the mouse.
    this.canvas.addEventListener('click', () => {
      if (this.state === 'walking' && !this.touchMode && !document.pointerLockElement) this.player.lockPointer();
    });

    // Switch to touch controls the first time the screen is touched, and back on mouse use.
    window.addEventListener('pointerdown', (e) => {
      const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (touch !== this.touchMode) this.setInputMode(touch);
    });

    // Touch look: drag anywhere on the scene.
    let lookId: number | null = null;
    let lx = 0;
    let ly = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.state !== 'walking') return;
      lookId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.player.look(e.clientX - lx, e.clientY - ly, 2.2);
      lx = e.clientX;
      ly = e.clientY;
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === lookId) lookId = null;
    };
    this.canvas.addEventListener('pointerup', endLook);
    this.canvas.addEventListener('pointercancel', endLook);
    this.canvas.style.touchAction = 'none';

    // Touch stick.
    const stick = this.$('#stick');
    const knob = stick.querySelector<HTMLElement>('.knob')!;
    let stickId: number | null = null;
    const moveStick = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      const radius = r.width / 2;
      let dx = e.clientX - (r.left + radius);
      let dy = e.clientY - (r.top + radius);
      const len = Math.hypot(dx, dy);
      if (len > radius) {
        dx = (dx / len) * radius;
        dy = (dy / len) * radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.player.stick.x = dx / radius;
      this.player.stick.y = -dy / radius;
    };
    stick.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      moveStick(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickId) moveStick(e);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = '';
      this.player.stick.x = this.player.stick.y = 0;
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    const run = this.$('#run-btn');
    run.addEventListener('click', () => {
      this.player.running = !this.player.running;
      run.setAttribute('aria-pressed', String(this.player.running));
    });
  }

  /** Draw the city once (wall, water, temple district); the player marker goes on top each frame. */
  private buildMap() {
    this.map = this.$('#map');
    const dpr = Math.min(2, window.devicePixelRatio);
    const W = 132;
    const H = 188;
    this.map.width = W * dpr;
    this.map.height = H * dpr;
    this.mapBase = document.createElement('canvas');
    this.mapBase.width = this.map.width;
    this.mapBase.height = this.map.height;
    const g = this.mapBase.getContext('2d')!;
    g.scale(dpr, dpr);
    const p = this.plan;
    const span = Math.max((p.wall.radiusX * 1.15 * 2) / W, (p.wall.radiusZ * 1.15 * 2) / H);
    this.toMap = (x, z) => [W / 2 + x / span, H / 2 + z / span];
    g.fillStyle = 'rgba(36, 64, 127, 0.9)';
    g.fillRect(0, 0, W, H);
    // City inside the wall.
    g.beginPath();
    wallVertices(p).forEach(([x, z], i) => (i ? g.lineTo(...this.toMap(x, z)) : g.moveTo(...this.toMap(x, z))));
    g.closePath();
    g.fillStyle = 'rgba(242, 236, 224, 0.16)';
    g.fill();
    g.strokeStyle = '#f2ece0';
    g.lineWidth = 2;
    g.stroke();
    // Water.
    g.fillStyle = g.strokeStyle = '#8fb0d6';
    for (const h of [...p.water.harbours, ...p.water.channels]) {
      const [a, b] = this.toMap(h.rect[0], h.rect[1]);
      const [c, d] = this.toMap(h.rect[2], h.rect[3]);
      g.fillRect(a, b, c - a, d - b);
    }
    g.lineWidth = Math.max(1.5, p.water.innerCanal.width / span);
    g.beginPath();
    p.water.innerCanal.path.forEach(([x, z], i) => (i ? g.lineTo(...this.toMap(x, z)) : g.moveTo(...this.toMap(x, z))));
    g.stroke();
    // Temple district and the ziggurat.
    const [t0, t1] = this.toMap(p.temenos.rect[0], p.temenos.rect[1]);
    const [t2, t3] = this.toMap(p.temenos.rect[2], p.temenos.rect[3]);
    g.fillStyle = 'rgba(201, 164, 76, 0.45)';
    g.fillRect(t0, t1, t2 - t0, t3 - t1);
    const [zx, zz] = this.toMap(...p.ziggurat.position);
    g.fillStyle = '#c9a44c';
    g.fillRect(zx - 4, zz - 3, 8, 6);
  }

  /** Call each frame. */
  update() {
    if (this.state !== 'walking') return;
    const g = this.map.getContext('2d')!;
    const dpr = this.map.width / 132;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.mapBase, 0, 0);
    g.scale(dpr, dpr);
    const [px, pz] = this.toMap(this.player.position.x, this.player.position.z);
    const yaw = this.player.heading;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    g.save();
    g.translate(px, pz);
    g.rotate(Math.atan2(fz, fx) + Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 5);
    g.lineTo(0, 2.5);
    g.lineTo(-5, 5);
    g.closePath();
    g.fillStyle = '#b8472f';
    g.strokeStyle = '#211c18';
    g.lineWidth = 1.5;
    g.fill();
    g.stroke();
    g.restore();
  }
}
