// Bells, shimmer and chimes: short-lived voices scheduled ahead on the audio
// clock. Bells are sine partials (x1, x2.76, x5.4) on ratios of the current
// root, with random pan, an exponential ring and a lowpassed feedback echo.

import type { SoundParams } from '../params';
import { Gate, Smoother, panner } from '../nodes';
import { BELL_SCALES } from '../tuning';

const BELL_PEAK = 0.1;
const PARTIALS: ReadonlyArray<readonly [number, number]> = [[1, 1], [2.76, 0.18], [5.4, 0.06]];

interface Scheduled {
  start: number;
  stop: () => void;
}

/** Keeps track of voices scheduled in the future so they can be withdrawn when settings change. */
class VoiceList {
  private items: Scheduled[] = [];

  add(v: Scheduled): void {
    this.items.push(v);
  }

  /** Cancel voices that haven't started yet; returns the earliest cancelled start time. */
  cancelAfter(t: number): number | null {
    let earliest: number | null = null;
    this.items = this.items.filter((v) => {
      if (v.start > t) {
        v.stop();
        if (earliest === null || v.start < earliest) earliest = v.start;
        return false;
      }
      return true;
    });
    return earliest;
  }

  prune(now: number): void {
    this.items = this.items.filter((v) => v.start > now - 30);
  }
}

export class Bells {
  readonly gate: Gate;
  readonly shimmerGate: Gate;
  private readonly bus: GainNode;
  private readonly shimmerBus: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly bellVoices = new VoiceList();
  private readonly shimmerVoices = new VoiceList();
  private level = 0;
  private shimmerLevel = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    dry: AudioNode,
    reverbIn: AudioNode,
    private readonly random: () => number,
  ) {
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.48;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.45;
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.frequency.value = 2600;
    this.delay.connect(fbFilter).connect(this.feedback).connect(this.delay);
    this.delay.connect(reverbIn);
    this.delay.connect(dry);

    this.gate = new Gate(ctx, [dry, this.delay, reverbIn]);
    this.bus = this.gate.node;
    this.shimmerGate = new Gate(ctx, [dry, reverbIn]);
    this.shimmerBus = this.shimmerGate.node;
  }

  apply(e: SoundParams, now: number, tau: number, s: Smoother): void {
    s.set(this.delay.delayTime, e.echoTime, now, Math.max(tau, 0.5));
    s.set(this.feedback.gain, e.echoFeedback, now, tau);
    this.level = e.bellsOn ? e.bellsLevel : 0;
    this.shimmerLevel = e.shimmerOn ? e.shimmerLevel : 0;
    // The bus itself stays at unity; each voice carries its own level.
    this.gate.set(e.bellsOn ? 1 : 0, now, Math.max(tau, 0.6), s);
    this.shimmerGate.set(e.shimmerOn ? 1 : 0, now, Math.max(tau, 0.6), s);
  }

  /** Withdraw bells scheduled after `t` (settings changed); returns when to resume. */
  rescheduleFrom(t: number): number | null {
    return this.bellVoices.cancelAfter(t);
  }

  rescheduleShimmerFrom(t: number): number | null {
    return this.shimmerVoices.cancelAfter(t);
  }

  /** Seconds until the next bell, for the given density (bells per minute). */
  nextGap(e: SoundParams): number {
    const mean = 60 / Math.max(0.5, e.bellsDensity);
    return mean * (0.4 + this.random() * 1.2);
  }

  ring(t: number, rootHz: number, e: SoundParams): void {
    if (this.level <= 0) return;
    const scale = BELL_SCALES[e.bellsScale] ?? BELL_SCALES[0];
    const ratio = scale.ratios[Math.floor(this.random() * scale.ratios.length)];
    const lift = this.random() < 0.2 ? 2 : 1;
    const f = rootHz * ratio * lift * Math.pow(2, e.bellsRegister);
    const decay = e.bellsDecay;
    const peak = BELL_PEAK * this.level * (f > 1500 ? 0.7 : 1);
    const pan = (this.random() * 2 - 1) * e.bellsSpread;
    this.voice(t, f, peak, 0.03, decay, pan, this.bus, PARTIALS, this.bellVoices);
  }

  /** Shimmer: a high, slow-blooming sine grain on an upper harmonic of the root. */
  shimmer(t: number, rootHz: number): void {
    if (this.shimmerLevel <= 0) return;
    const harmonics = [8, 10, 12, 16, 20, 24];
    let f = rootHz * harmonics[Math.floor(this.random() * harmonics.length)];
    while (f > 2600) f /= 2;
    const pan = this.random() * 1.6 - 0.8;
    const ctx = this.ctx;
    const g = ctx.createGain();
    const len = 5 + this.random() * 4;
    const peak = 0.12 * this.shimmerLevel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + len * 0.4);
    g.gain.linearRampToValueAtTime(0, t + len);
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.detune.value = (this.random() - 0.5) * 8;
    const p = panner(ctx, pan);
    o.connect(g).connect(p).connect(this.shimmerBus);
    o.start(t);
    o.stop(t + len + 0.05);
    this.shimmerVoices.add({ start: t, stop: () => safeStop(o) });
  }

  /** A soft single bowl-like chime for session start and end. */
  chime(t: number, rootHz: number, out: AudioNode, level = 1): void {
    let f = rootHz * 8;
    while (f > 600) f /= 2;
    while (f < 300) f *= 2;
    const partials: ReadonlyArray<readonly [number, number]> = [[1, 1], [2.005, 0.28], [2.76, 0.14], [5.4, 0.04]];
    this.voice(t, f, 0.07 * level, 0.06, 9, 0, out, partials, null);
  }

  private voice(
    t: number, f: number, peak: number, attack: number, decay: number, pan: number,
    out: AudioNode, partials: ReadonlyArray<readonly [number, number]>, list: VoiceList | null,
  ): void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const p = panner(ctx, pan);
    g.connect(p).connect(out);
    const oscs: OscillatorNode[] = [];
    for (const [m, v] of partials) {
      if (f * m > ctx.sampleRate / 2.2) continue;
      const o = ctx.createOscillator();
      o.frequency.value = f * m;
      const og = ctx.createGain();
      og.gain.value = v;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + decay + 0.2);
      oscs.push(o);
    }
    list?.add({ start: t, stop: () => oscs.forEach(safeStop) });
  }

  tick(now: number): void {
    this.gate.tick(now);
    this.shimmerGate.tick(now);
    this.bellVoices.prune(now);
    this.shimmerVoices.prune(now);
  }
}

function safeStop(o: OscillatorNode): void {
  try {
    o.stop(0);
  } catch {
    // Already stopped.
  }
  o.disconnect();
}
