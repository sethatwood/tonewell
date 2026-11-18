// The visuals renderer: one WebGL program, the scene cross-fade, palettes,
// the breath pacer and the photosensitivity limits. Hosts (the Visuals window,
// the website) only choose targets. Every value that changes brightness passes
// through approach() here, with time constants of a second or more and capped
// rates, and step() clamps its own time step and targets, so overall
// brightness can't swing faster than 3 Hz whatever a host asks for. The beat
// frequency is never an input.

import { EMBER, PALETTES, SCENES, FRAG, VERT } from './shader';

export interface Targets {
  /** Overall level, 0..1 (dark, landing, ready or full). */
  fade: number;
  /** Going dark on request (Esc): fade over about a second instead of slowly. */
  dark: boolean;
  /** Glow times the brightness cap, 0..1. */
  bright: number;
  sat: number;
  /** Speed of motion; 1 is as designed. */
  flow: number;
  // How the sound is changing (see follow.ts), already scaled by "Follow the sound".
  /** The picture swells and eases with the low end, -1..1. */
  swell: number;
  /** Light blooms with bells and shimmer, 0..1. */
  bloom: number;
  /** Colors shift with the drone's note, as a fraction of the palette, -0.5..0.5. */
  hue: number;
  pacer: boolean;
  /** The drone's chord as a small whole-number ratio, for the Harmonograph. */
  ratio?: [number, number];
}

/** Move `v` toward `target` with time constant `tau`, never faster than `maxRate` per second. */
export function approach(v: number, target: number, dt: number, tau: number, maxRate: number): number {
  // A bad number holds the value where it is (or at rest), rather than blanking the picture for good.
  if (!Number.isFinite(v)) v = 0;
  if (!Number.isFinite(target)) return v;
  const step = (target - v) * Math.min(1, dt / tau);
  const cap = maxRate * dt;
  return v + Math.max(-cap, Math.min(cap, step));
}

const UNIFORMS = ['R', 'T', 'mixv', 'sa', 'sb', 'bass', 'hi', 'hue', 'fade', 'bright', 'sat', 'pacer', 'pacerPhase', 'palMix', 'palOrig0', 'palOrig1', 'ratioA', 'ratioB', 'pa0', 'pb0', 'pc0', 'pd0', 'pa1', 'pb1', 'pc1', 'pd1'];
/** Seconds a scene cross-fade takes. */
const MIX_SECONDS = 9;

export class Visuals {
  /** Scene time; advances at `flow` per second. */
  T = Math.random() * 200;
  scene = 0;
  next = 0;
  mixv = 0;
  mixing = false;
  /** A scene asked for while a cross-fade is running; it starts when the fade ends. */
  queued: number | null = null;
  /** Move to the next scene on its own, every `driftSeconds`. */
  drift = true;
  driftSeconds = 80;
  since = 0;
  palette = 0;
  nextPalette = 0;
  /** A palette chosen while another cross-fade ran: it follows when that one ends. */
  private queuedPalette: number | null = null;
  palMix = 0;
  breathsPerMinute = 5.5;
  pacerPhase = 0;
  /** Called whenever the scene being shown or headed to changes. */
  onScene: (() => void) | null = null;

  private readonly U: Record<string, WebGLUniformLocation | null> = {};
  /** Smoothed values actually sent to the shader. */
  private readonly live = { fade: 0, bright: 0, sat: 1.6, swell: 0, bloom: 0, hue: 0, flow: 1, pacer: 0 };
  private quality = 0.7;
  private acc = 0;
  private frames = 0;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGLRenderingContext,
  ) {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const n of UNIFORMS) this.U[n] = gl.getUniformLocation(prog, n);
    this.resize();
  }

  /** Null when the machine can't start WebGL. */
  static create(canvas: HTMLCanvasElement): Visuals | null {
    const opts = { antialias: false, powerPreference: 'low-power' } as const;
    const gl = (canvas.getContext('webgl2', opts) ?? canvas.getContext('webgl', opts)) as WebGLRenderingContext | null;
    return gl ? new Visuals(canvas, gl) : null;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }

  /** Match the canvas to its displayed size; call when that changes. */
  resize(): void {
    const d = Math.min(devicePixelRatio || 1, 2) * this.quality;
    this.canvas.width = Math.max(2, Math.round(this.canvas.clientWidth * d));
    this.canvas.height = Math.max(2, Math.round(this.canvas.clientHeight * d));
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** The scene the picture is heading to: queued, else cross-fading to, else showing. */
  target(): number {
    return this.queued ?? (this.mixing ? this.next : this.scene);
  }

  /**
   * Move to scene k. A change never interrupts a cross-fade (that would be a
   * hard cut, and repeated presses could flash): it waits, and only the latest
   * request is kept.
   */
  goTo(k: number): void {
    const n = SCENES.length;
    k = ((k % n) + n) % n;
    if (this.mixing) {
      this.queued = k === this.next ? null : k;
    } else if (k !== this.scene) {
      this.queued = null;
      this.next = k;
      this.mixing = true;
      this.mixv = 0;
      this.since = 0;
    } else {
      this.queued = null;
    }
    this.onScene?.();
  }

  /** The palette it will settle on, once any cross-fade under way (and any queued) has run. */
  targetPalette(): number {
    return this.queuedPalette ?? this.nextPalette;
  }

  /** Cross-fade to the palette after the one it's heading for. Returns its index. */
  cyclePalette(): number | null {
    return this.choosePalette((this.targetPalette() + 1) % PALETTES.length);
  }

  /**
   * Cross-fade to one palette, over about four seconds. If another cross-fade
   * is under way, this one follows when it ends (colour never jumps). Returns
   * the palette it will settle on, or null if the index isn't one.
   */
  choosePalette(index: number): number | null {
    if (index < 0 || index >= PALETTES.length) return null;
    if (this.nextPalette !== this.palette) {
      this.queuedPalette = index === this.nextPalette ? null : index;
      return index;
    }
    if (index !== this.palette) {
      this.nextPalette = index;
      this.palMix = 0;
    }
    return index;
  }

  /** Advance by `dt` seconds toward `t`, and draw. */
  step(dt: number, t: Targets): void {
    dt = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
    const live = this.live;
    // Fades are slow, except going dark, which takes about a second.
    live.fade = approach(live.fade, t.fade, dt, t.dark ? 0.25 : 2, t.dark ? 1.2 : 0.35);
    live.bright = approach(live.bright, t.bright, dt, 1, 0.3);
    live.sat = approach(live.sat, t.sat, dt, 2, 0.4);
    // Never faster than the Flow slider's top, whatever following the sound adds.
    live.flow = approach(live.flow, Math.min(2, Math.max(0, t.flow)), dt, 2, 0.6);
    // Following the sound: a swell takes about a second, light blooms and fades over a second or
    // more, and colors glide to a new note over several seconds. Each is rate-capped, so even a
    // sudden sound turns into a slow change in the picture.
    live.swell = approach(live.swell, t.swell, dt, 1.2, 0.6);
    live.bloom = approach(live.bloom, t.bloom, dt, 1, 0.5);
    live.hue = approach(live.hue, t.hue, dt, 4, 0.15);
    live.pacer = approach(live.pacer, t.pacer ? 1 : 0, dt, 1.5, 0.5);

    this.T += dt * live.flow;
    if (this.mixing) {
      this.mixv += dt / MIX_SECONDS;
      if (this.mixv >= 1) {
        this.scene = this.next;
        this.mixv = 0;
        this.mixing = false;
        if (this.queued !== null) {
          const q = this.queued;
          this.queued = null;
          this.goTo(q);
        }
      }
    }
    // Drift moves through the scenes in turn; Ember stays put once chosen.
    if (this.drift && !this.mixing && this.scene !== EMBER && (this.since += dt) > this.driftSeconds) this.goTo((this.scene + 1) % EMBER);
    if (this.nextPalette !== this.palette) {
      this.palMix = Math.min(1, this.palMix + dt / 4);
      if (this.palMix >= 1) {
        this.palette = this.nextPalette;
        this.palMix = 0;
        if (this.queuedPalette !== null) {
          if (this.queuedPalette !== this.palette) this.nextPalette = this.queuedPalette;
          this.queuedPalette = null;
        }
      }
    }
    this.pacerPhase = (this.pacerPhase + (dt * this.breathsPerMinute) / 60) % 1;

    // Adapt resolution to keep frame time comfortable.
    this.acc += dt;
    this.frames++;
    if (this.acc > 2) {
      const avg = this.acc / this.frames;
      if (avg > 0.026 && this.quality > 0.4) {
        this.quality -= 0.1;
        this.resize();
      } else if (avg < 0.012 && this.quality < 1) {
        this.quality += 0.05;
        this.resize();
      }
      this.acc = 0;
      this.frames = 0;
    }

    const gl = this.gl;
    const U = this.U;
    gl.uniform2f(U.R, this.canvas.width, this.canvas.height);
    gl.uniform1f(U.T, this.T);
    gl.uniform1f(U.mixv, this.mixv);
    gl.uniform1f(U.sa, this.scene);
    gl.uniform1f(U.sb, this.next);
    gl.uniform1f(U.bass, live.swell);
    gl.uniform1f(U.hi, live.bloom);
    gl.uniform1f(U.hue, live.hue);
    gl.uniform1f(U.fade, live.fade);
    gl.uniform1f(U.bright, live.bright);
    gl.uniform1f(U.sat, live.sat);
    gl.uniform1f(U.pacer, live.pacer);
    this.setPalette(0, this.palette);
    this.setPalette(1, this.nextPalette);
    gl.uniform1f(U.palMix, this.palMix);
    gl.uniform1f(U.ratioA, t.ratio?.[0] ?? 3);
    gl.uniform1f(U.ratioB, t.ratio?.[1] ?? 2);
    gl.uniform1f(U.pacerPhase, this.pacerPhase);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** The overall level the picture has reached, 0..1, so a host can wait for a fade to finish. */
  level(): number {
    return this.live.fade;
  }

  private setPalette(slot: 0 | 1, index: number): void {
    const gl = this.gl;
    const p = PALETTES[index] ?? PALETTES[0];
    gl.uniform1f(this.U[`palOrig${slot}`], p.abcd ? 0 : 1);
    const v = p.abcd ?? [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 0, 0.33, 0.67];
    gl.uniform3f(this.U[`pa${slot}`], v[0], v[1], v[2]);
    gl.uniform3f(this.U[`pb${slot}`], v[3], v[4], v[5]);
    gl.uniform3f(this.U[`pc${slot}`], v[6], v[7], v[8]);
    gl.uniform3f(this.U[`pd${slot}`], v[9], v[10], v[11]);
  }
}
