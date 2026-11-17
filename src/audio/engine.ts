// The audio engine. Everything the app needs from sound goes through the
// AudioEngine interface, so the Web Audio implementation here could later be
// swapped for a native one without touching the UI or session logic.
//
// Timing rule: nothing musical is timed with setTimeout. Continuous motion
// (sweeps, glides, beat ramps, fades) lives on AudioParam timelines, and
// discrete events (bells, root steps) are placed ahead of time by a lookahead
// scheduler that reads the audio clock. If the page's timers stall, the sound
// keeps its shape; at worst a few bells are skipped, never bunched up.

import { defaultParams, type SoundParams } from './params';
import { shapeParams } from './shape';
import { Smoother, rng, softClipCurve } from './nodes';
import { Drone } from './layers/drone';
import { Beat, type Plan } from './layers/beat';
import { Breath } from './layers/breath';
import { Bells } from './layers/bells';
import { Reverb, Width } from './layers/space';
import { Textures } from './layers/textures';

export type { Plan } from './layers/beat';

export interface Levels {
  /** Overall loudness, roughly 0..1. */
  rms: number;
  /** Low-frequency energy, 0..1. */
  low: number;
  /** High-frequency energy, 0..1. */
  high: number;
}

export interface AudioEngine {
  readonly ctx: BaseAudioContext;
  now(): number;
  params(): SoundParams;
  /** Replace the sound settings; changes glide over roughly 3×tau seconds. */
  setParams(p: SoundParams, tau?: number): void;
  setLanding(on: boolean, seconds: number): void;
  isLanding(): boolean;
  /** Master volume 0..1 (perceptual). Rises are slowed down; falls are quick. */
  setVolume(v: number): void;
  /** Fade the session gain to `to` over `seconds`, along a smooth S-curve. */
  fade(to: number, seconds: number): void;
  /** Fade out starting at audio time `at`, over `seconds`. */
  scheduleEnd(at: number, seconds: number): void;
  clearEnd(): void;
  chime(at: number, level?: number): void;
  /** Follow a beat-frequency plan (or null to follow the Beat control). `blend`: seconds to glide onto it. */
  setBeatPlan(plan: Plan | null, blend?: number): void;
  beatHzNow(): number;
  rootNow(): number;
  /** Run the scheduler. Safe to call as often as you like. */
  pump(): void;
  levels(): Levels;
  dispose(): void;
}

export interface EngineOptions {
  seed?: number;
  /** URL of the AudioWorklet module (textures + clock). Without it, textures are unavailable. */
  workletUrl?: string;
  /** Initial volume, 0..1. */
  volume?: number;
}

const LOOKAHEAD = 8;
const SHIMMER_GAP = 2.2;
const VOLUME_FLOOR = 1e-4;
const LANDING_LEVEL = 0.55;
const RISE_DB_PER_S = 12;
const FALL_DB_PER_S = 40;

export class WebAudioEngine implements AudioEngine {
  private p: SoundParams = defaultParams();
  /** The shaped parameters last applied (after macros, drift and landing). */
  private e: SoundParams = defaultParams();
  private readonly s = new Smoother();
  private readonly random: () => number;
  private readonly seed: number;
  private t0 = 0;
  private landing = false;
  private volume = 0.7;

  private drone!: Drone;
  private beat!: Beat;
  private breath!: Breath;
  private bells!: Bells;
  private textures: Textures | null = null;
  private reverb!: Reverb;
  private width!: Width;
  private fadeGain!: GainNode;
  private timerGain!: GainNode;
  private volumeGain!: GainNode;
  private landingGain!: GainNode;
  private analyser!: AnalyserNode;
  private freqBuf = new Uint8Array(512);
  private timeBuf = new Float32Array(1024);

  private bellNext = 0;
  private shimmerNext = 0;
  private walkNext = 0;
  private lastPump = 0;
  private lastShape = -1;
  private interval: ReturnType<typeof setInterval> | null = null;
  private clock: AudioWorkletNode | null = null;
  private disposed = false;
  /** Scheduler health, for diagnostics: how often pump ran and the longest gap between runs. */
  readonly stats = { pumps: 0, maxGap: 0, bells: 0, worklet: false };

  private constructor(readonly ctx: BaseAudioContext, opts: EngineOptions) {
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.random = rng(this.seed);
    this.volume = opts.volume ?? 0.7;
  }

  static async create(ctx: BaseAudioContext, params: SoundParams, opts: EngineOptions = {}): Promise<WebAudioEngine> {
    const engine = new WebAudioEngine(ctx, opts);
    let worklet = false;
    if (opts.workletUrl && ctx.audioWorklet) {
      try {
        await ctx.audioWorklet.addModule(opts.workletUrl);
        worklet = true;
      } catch (err) {
        console.warn('Tonewell: textures unavailable, AudioWorklet failed to load', err);
      }
    }
    engine.build(params, worklet);
    engine.stats.worklet = worklet && engine.textures !== null;
    return engine;
  }

  private build(params: SoundParams, worklet: boolean): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.t0 = now;

    // Output chain: session fade, timer fade, volume, safety limiter, soft clip.
    this.fadeGain = ctx.createGain();
    this.fadeGain.gain.value = 0;
    this.timerGain = ctx.createGain();
    this.volumeGain = ctx.createGain();
    this.volumeGain.gain.value = Math.max(VOLUME_FLOOR, this.volume * this.volume);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.25;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve(0.94);
    // Only a safety net: it rarely engages, so oversampling isn't worth its CPU.
    clip.oversample = 'none';
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.85;
    this.fadeGain.connect(this.timerGain).connect(this.volumeGain).connect(limiter).connect(clip).connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // The bed: dry and reverb through the width stage and the prototype's glue compressor.
    const dry = ctx.createGain();
    this.reverb = new Reverb(ctx);
    this.width = new Width(ctx);
    dry.connect(this.width.input);
    this.reverb.output.connect(this.width.input);
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.ratio.value = 3;
    // Soft landing lowers the bed after the glue compressor, which would otherwise level the drop out.
    this.landingGain = ctx.createGain();
    this.width.output.connect(glue).connect(this.landingGain).connect(this.fadeGain);

    this.drone = new Drone(ctx, dry, this.reverb.input);
    this.breath = new Breath(ctx, dry, this.reverb.input, this.seed + 1);
    this.bells = new Bells(ctx, dry, this.reverb.input, this.random);
    // Beats bypass width and reverb: binaural must stay hard left/right.
    this.beat = new Beat(ctx, this.fadeGain);
    if (worklet) {
      try {
        this.textures = new Textures(ctx, dry, this.reverb.input, this.seed + 2);
      } catch (err) {
        console.warn('Tonewell: textures unavailable', err);
      }
    }

    const start = now + 0.02;
    this.drone.start(start);
    this.breath.start(start);
    this.beat.start(start);

    this.p = { ...params };
    this.e = shapeParams(this.p, { t: 0, seed: this.seed, landing: false });
    this.applyAll(0.01);

    this.bellNext = now + 4;
    this.shimmerNext = now + 3;
    this.walkNext = now + this.walkGap();
    this.lastPump = now;

    if (typeof AudioContext !== 'undefined' && ctx instanceof AudioContext) {
      if (worklet) {
        try {
          this.clock = new AudioWorkletNode(ctx, 'tw-clock', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
          const silent = ctx.createGain();
          silent.gain.value = 0;
          this.clock.connect(silent).connect(ctx.destination);
          this.clock.port.onmessage = () => this.pump();
        } catch {
          this.clock = null;
        }
      }
      this.interval = setInterval(() => this.pump(), 250);
    }
  }

  now(): number {
    return this.ctx.currentTime;
  }

  params(): SoundParams {
    return { ...this.p };
  }

  private walkGap(): number {
    return this.e.walkEvery * (0.8 + this.random() * 0.4);
  }

  private applyAll(tau: number): void {
    const now = this.ctx.currentTime;
    const prev = this.e;
    const e = shapeParams(this.p, { t: now - this.t0, seed: this.seed, landing: this.landing });
    this.e = e;
    // Bells already placed ahead were timed for the old density; re-place them if it moved noticeably.
    if (Math.abs(e.bellsDensity - prev.bellsDensity) / prev.bellsDensity > 0.15) {
      const from = this.bells.rescheduleFrom(now + 0.05);
      if (from !== null) this.bellNext = Math.min(this.bellNext, from);
    }
    if (e.walkEvery < prev.walkEvery * 0.85) this.walkNext = Math.min(this.walkNext, now + e.walkEvery);
    this.drone.apply(e, now, tau, this.s);
    this.beat.apply(e, now, tau, this.s);
    this.breath.apply(e, now, tau, this.s);
    this.bells.apply(e, now, tau, this.s);
    this.textures?.apply(e, now, tau, this.s, this.drone.rootAt(now));
    this.reverb.apply(e, now, tau, this.s);
    this.width.apply(e, now, tau, this.s);
    this.lastShape = now;
  }

  setParams(next: SoundParams, tau = 0.15): void {
    const prev = this.p;
    this.p = { ...next };
    const now = this.ctx.currentTime;
    const bellsChanged =
      prev.bellsOn !== next.bellsOn || prev.bellsDensity !== next.bellsDensity || prev.bellsScale !== next.bellsScale ||
      prev.bellsRegister !== next.bellsRegister || prev.bellsDecay !== next.bellsDecay || prev.bellsLevel !== next.bellsLevel ||
      prev.bellsSpread !== next.bellsSpread || prev.root !== next.root || prev.voicing !== next.voicing;
    if (bellsChanged) {
      const from = this.bells.rescheduleFrom(now + 0.05);
      if (from !== null) this.bellNext = Math.min(this.bellNext, from);
      if (next.bellsOn && !prev.bellsOn) this.bellNext = Math.min(this.bellNext, now + 1.5);
    }
    if (prev.shimmerOn !== next.shimmerOn || prev.shimmerLevel !== next.shimmerLevel || prev.root !== next.root) {
      const from = this.bells.rescheduleShimmerFrom(now + 0.05);
      if (from !== null) this.shimmerNext = Math.min(this.shimmerNext, from);
    }
    this.applyAll(tau);
    this.pump();
  }

  setLanding(on: boolean, seconds: number): void {
    if (on === this.landing) return;
    this.landing = on;
    const now = this.ctx.currentTime;
    if (on) {
      this.bells.rescheduleFrom(now + 0.05);
      this.bells.rescheduleShimmerFrom(now + 0.05);
    } else {
      this.bellNext = now + 3;
      this.shimmerNext = now + 3;
      this.walkNext = now + this.walkGap();
    }
    const tau = Math.max(0.2, seconds / 3);
    this.landingGain.gain.setTargetAtTime(on ? LANDING_LEVEL : 1, now, tau);
    this.applyAll(tau);
  }

  isLanding(): boolean {
    return this.landing;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    const g = this.volumeGain.gain;
    const now = this.ctx.currentTime;
    const from = Math.max(VOLUME_FLOOR, g.value);
    const to = Math.max(VOLUME_FLOOR, this.volume * this.volume);
    // Constant dB-per-second ramps: rises are capped at 12 dB/s, falls at 40 dB/s.
    const db = 20 * Math.log10(to / from);
    const seconds = Math.max(0.12, Math.abs(db) / (db > 0 ? RISE_DB_PER_S : FALL_DB_PER_S));
    g.cancelScheduledValues(now);
    g.setValueAtTime(from, now);
    g.exponentialRampToValueAtTime(to, now + seconds);
  }

  fade(to: number, seconds: number): void {
    const g = this.fadeGain.gain;
    const now = this.ctx.currentTime;
    const from = g.value;
    g.cancelScheduledValues(now);
    if (seconds <= 0.02) {
      g.setTargetAtTime(to, now, 0.01);
      return;
    }
    const n = 64;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const s = x * x * (3 - 2 * x);
      curve[i] = from + (to - from) * s;
    }
    try {
      g.setValueCurveAtTime(curve, now, seconds);
    } catch {
      // Some engines refuse a curve that overlaps a cancelled one; an exponential approach is close enough.
      g.cancelScheduledValues(now);
      g.setValueAtTime(from, now);
      g.setTargetAtTime(to, now, seconds / 4);
    }
  }

  scheduleEnd(at: number, seconds: number): void {
    const g = this.timerGain.gain;
    const now = this.ctx.currentTime;
    const start = Math.max(at, now + 0.05);
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1, Math.min(start, now + 2));
    g.setValueAtTime(1, start);
    // An equal-power-ish fade: slow at first, then settling into silence.
    const n = 64;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      curve[i] = Math.cos((x * Math.PI) / 2) ** 2;
    }
    try {
      g.setValueCurveAtTime(curve, start + 0.001, Math.max(0.5, seconds));
    } catch {
      g.setTargetAtTime(0, start + 0.001, Math.max(0.5, seconds) / 4);
    }
  }

  clearEnd(): void {
    const g = this.timerGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(1, now + 3);
  }

  chime(at: number, level = 1): void {
    this.bells.chime(Math.max(at, this.ctx.currentTime + 0.02), this.drone.rootAt(at), this.volumeGain, level);
  }

  setBeatPlan(plan: Plan | null, blend = 2): void {
    const now = this.ctx.currentTime;
    if (plan) this.beat.setPlan(plan, now, blend);
    else this.beat.clearPlan(this.p, now);
  }

  beatHzNow(): number {
    return this.beat.hzAt(this.ctx.currentTime);
  }

  rootNow(): number {
    return this.drone.rootAt(this.ctx.currentTime);
  }

  pump(): void {
    if (this.disposed) return;
    const now = this.ctx.currentTime;
    // After a long stall (sleep, throttling), skip the backlog rather than fire it all at once.
    if (now - this.lastPump > 3) {
      this.bellNext = Math.max(this.bellNext, now + 0.5 + this.random() * 2);
      this.shimmerNext = Math.max(this.shimmerNext, now + 1);
      this.walkNext = Math.max(this.walkNext, now + 2);
    }
    this.stats.pumps++;
    this.stats.maxGap = Math.max(this.stats.maxGap, now - this.lastPump);
    this.lastPump = now;
    const horizon = now + LOOKAHEAD;
    const e = this.landing ? null : this.e;

    while (this.bellNext < horizon) {
      if (e && e.bellsOn && this.bellNext >= now) {
        this.bells.ring(this.bellNext, this.drone.rootAt(this.bellNext), e);
        this.stats.bells++;
      }
      this.bellNext += this.bells.nextGap(this.e);
    }
    while (this.shimmerNext < horizon) {
      if (e && e.shimmerOn && this.shimmerNext >= now) this.bells.shimmer(this.shimmerNext, this.drone.rootAt(this.shimmerNext));
      this.shimmerNext += SHIMMER_GAP * (0.5 + this.random());
    }
    while (this.walkNext < horizon) {
      if (e && e.walkOn && this.walkNext >= now) this.drone.walkStep(e, this.walkNext);
      this.walkNext += this.walkGap();
    }

    // Drift and housekeeping, about once a second.
    if (now - this.lastShape >= 1) {
      this.applyAll(1.5);
      this.drone.tick(now);
      this.beat.tick(now);
      this.breath.tick(now);
      this.bells.tick(now);
      this.textures?.tick(now);
      this.reverb.tick(now);
    }
  }

  levels(): Levels {
    const a = this.analyser;
    a.getByteFrequencyData(this.freqBuf);
    a.getFloatTimeDomainData(this.timeBuf);
    let low = 0;
    let high = 0;
    for (let i = 1; i < 7; i++) low += this.freqBuf[i];
    for (let i = 60; i < 200; i++) high += this.freqBuf[i];
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    return { rms: Math.sqrt(sum / this.timeBuf.length), low: low / 6 / 255, high: high / 140 / 255 };
  }

  dispose(): void {
    this.disposed = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    if (this.clock) {
      this.clock.port.onmessage = null;
      this.clock.disconnect();
    }
  }
}
