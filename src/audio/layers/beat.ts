// Beats: binaural (one tone per ear), monaural (both tones in both ears, so
// the beat is physically in the air) and isochronic (one tone gently pulsed).
// Frequencies follow piecewise-linear plans on the audio clock, so ramps keep
// running exactly even if the page's timers stall.

import type { SoundParams } from '../params';
import { Gate, Smoother } from '../nodes';

/** A piecewise-linear schedule: sorted [time, value] points, flat outside them. */
export type Plan = Array<[number, number]>;

export function evalPlan(plan: Plan, t: number): number {
  if (plan.length === 0) return 0;
  if (t <= plan[0][0]) return plan[0][1];
  for (let i = 1; i < plan.length; i++) {
    const [t1, v1] = plan[i];
    if (t <= t1) {
      const [t0, v0] = plan[i - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return plan[plan.length - 1][1];
}

/**
 * Joins a new plan to the current one without a jump: from the value playing
 * now, glide over `blend` seconds onto the new plan, then follow it.
 */
export function joinPlans(current: Plan, next: Plan, now: number, blend: number): Plan {
  if (blend <= 0) {
    const out: Plan = [[now, evalPlan(next, now)]];
    for (const p of next) if (p[0] > now) out.push([p[0], p[1]]);
    return out;
  }
  const out: Plan = [[now, evalPlan(current, now)]];
  const joinAt = now + blend;
  out.push([joinAt, evalPlan(next, joinAt)]);
  for (const p of next) if (p[0] > joinAt) out.push([p[0], p[1]]);
  return out;
}

const BEAT_GAIN = 0.1;

export class Beat {
  private readonly oscL: OscillatorNode;
  private readonly oscR: OscillatorNode;
  private readonly oscC: OscillatorNode;
  private readonly pulse: OscillatorNode;
  private readonly isoAmp: GainNode;
  private readonly bin: GainNode;
  private readonly mono: GainNode;
  private readonly iso: GainNode;
  readonly gate: Gate;

  private hzPlan: Plan = [[0, 6]];
  private carrierPlan: Plan = [[0, 111]];
  private followParam = true;
  private applied: SoundParams | null = null;

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.gate = new Gate(ctx, [out]);
    this.oscL = ctx.createOscillator();
    this.oscR = ctx.createOscillator();
    this.oscC = ctx.createOscillator();

    // Binaural: hard left and hard right, never mixed.
    const merger = ctx.createChannelMerger(2);
    this.bin = ctx.createGain();
    this.bin.gain.value = 0;
    this.oscL.connect(merger, 0, 0);
    this.oscR.connect(merger, 0, 1);
    merger.connect(this.bin).connect(this.gate.node);

    // Monaural: both tones summed to both ears.
    this.mono = ctx.createGain();
    this.mono.gain.value = 0;
    this.mono.channelCount = 1;
    this.mono.channelCountMode = 'explicit';
    this.oscL.connect(this.mono);
    this.oscR.connect(this.mono);
    this.mono.connect(this.gate.node);

    // Isochronic: one carrier, amplitude shaped by a smoothed pulse.
    this.pulse = ctx.createOscillator();
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      const u = Math.min(1, Math.max(0, (x + 0.25) / 1.25));
      curve[i] = u * u * (3 - 2 * u);
    }
    shaper.curve = curve;
    this.isoAmp = ctx.createGain();
    this.isoAmp.gain.value = 0;
    this.pulse.connect(shaper).connect(this.isoAmp.gain);
    this.iso = ctx.createGain();
    this.iso.gain.value = 0;
    this.oscC.connect(this.isoAmp).connect(this.iso).connect(this.gate.node);
  }

  start(at: number): void {
    this.oscL.start(at);
    this.oscR.start(at);
    this.oscC.start(at);
    this.pulse.start(at);
  }

  /** The beat frequency at audio time t (for display). */
  hzAt(t: number): number {
    return evalPlan(this.hzPlan, t);
  }

  /** Follow an explicit plan (a session ramp). */
  setPlan(plan: Plan, now: number, blend = 2): void {
    this.followParam = false;
    this.hzPlan = joinPlans(this.hzPlan, plan, now, blend);
    this.reschedule(now);
  }

  /** Go back to following the Beat control directly. */
  clearPlan(e: SoundParams, now: number): void {
    this.followParam = true;
    this.hzPlan = joinPlans(this.hzPlan, [[now, e.beatHz]], now, 2);
    this.reschedule(now);
  }

  private reschedule(now: number): void {
    const times = new Set<number>([now]);
    for (const [t] of this.hzPlan) if (t > now) times.add(t);
    for (const [t] of this.carrierPlan) if (t > now) times.add(t);
    const sorted = [...times].sort((a, b) => a - b);
    const params = [this.oscL.frequency, this.oscR.frequency, this.oscC.frequency, this.pulse.frequency];
    for (const p of params) p.cancelScheduledValues(now);
    sorted.forEach((t, i) => {
      const f = evalPlan(this.hzPlan, t);
      const c = evalPlan(this.carrierPlan, t);
      const vals = [c - f / 2, c + f / 2, c, f];
      params.forEach((p, k) => {
        if (i === 0) p.setValueAtTime(vals[k], t);
        else p.linearRampToValueAtTime(vals[k], t);
      });
    });
  }

  apply(e: SoundParams, now: number, tau: number, s: Smoother): void {
    const prev = this.applied;
    if (prev === null) {
      this.hzPlan = [[now, e.beatHz]];
      this.carrierPlan = [[now, e.carrier]];
      this.reschedule(now);
    } else {
      let changed = false;
      if (prev.carrier !== e.carrier) {
        this.carrierPlan = joinPlans(this.carrierPlan, [[now, e.carrier]], now, 1.5);
        changed = true;
      }
      if (this.followParam && prev.beatHz !== e.beatHz) {
        this.hzPlan = joinPlans(this.hzPlan, [[now, e.beatHz]], now, 2);
        changed = true;
      }
      if (changed) this.reschedule(now);
    }

    const on = e.beatOn ? e.beatLevel * BEAT_GAIN : 0;
    s.set(this.bin.gain, e.beatMode === 0 ? 1 : 0, now, Math.max(tau, 0.4));
    s.set(this.mono.gain, e.beatMode === 1 ? 0.5 : 0, now, Math.max(tau, 0.4));
    s.set(this.iso.gain, e.beatMode === 2 ? 1.2 : 0, now, Math.max(tau, 0.4));
    this.gate.set(on, now, Math.max(tau, 0.4), s);
    this.applied = { ...e };
  }

  tick(now: number): void {
    this.gate.tick(now);
  }
}
