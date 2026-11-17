// The drone: five detuned voices (sawtooth blended with triangle) through a
// resonant lowpass swept by a very slow LFO, plus a sine sub an octave down.
// The root wanders between nearby notes, gliding with setTargetAtTime.

import type { SoundParams } from '../params';
import { Gate, Smoother, panner } from '../nodes';
import { VOICINGS, WALKS, intervalRatio, midiToHz } from '../tuning';

interface Voice {
  saw: OscillatorNode;
  tri: OscillatorNode;
  sawGain: GainNode;
  triGain: GainNode;
  pan: AudioNode & { pan?: AudioParam };
}

const PANS = [-1, 1, -0.5, 0.5, 0];
// StereoPanner at centre is -3 dB per side; this restores the prototype's level.
const PAN_COMP = Math.SQRT2;
const DRONE_GAIN = 0.16 / 0.7;
const SUB_GAIN = 0.24;

export class Drone {
  private readonly voices: Voice[] = [];
  private readonly filter: BiquadFilterNode;
  private readonly sweep: OscillatorNode;
  private readonly sweepGain: GainNode;
  private readonly autopan: AudioNode & { pan?: AudioParam };
  private readonly autopanLfo: OscillatorNode;
  private readonly autopanDepth: GainNode;
  private readonly sub: OscillatorNode;
  private readonly subGain: GainNode;
  readonly gate: Gate;
  readonly subGate: Gate;

  private walkIndex = 0;
  private applied: SoundParams | null = null;
  private rootTrail: Array<{ t: number; hz: number }> = [];

  constructor(ctx: BaseAudioContext, dry: AudioNode, reverbIn: AudioNode) {
    const send = ctx.createGain();
    send.gain.value = 0.35;
    send.connect(reverbIn);
    this.gate = new Gate(ctx, [dry, send]);
    this.subGate = new Gate(ctx, [dry]);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 420;
    this.filter.Q.value = 5;

    this.sweep = ctx.createOscillator();
    this.sweep.frequency.value = 1 / 32;
    this.sweepGain = ctx.createGain();
    this.sweepGain.gain.value = 280;
    this.sweep.connect(this.sweepGain).connect(this.filter.frequency);

    this.autopan = panner(ctx, 0);
    this.autopanLfo = ctx.createOscillator();
    this.autopanLfo.frequency.value = 1 / 47;
    this.autopanDepth = ctx.createGain();
    this.autopanDepth.gain.value = 0;
    if (this.autopan.pan) this.autopanLfo.connect(this.autopanDepth).connect(this.autopan.pan);

    this.filter.connect(this.autopan).connect(this.gate.node);

    for (let i = 0; i < 5; i++) {
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      const sawGain = ctx.createGain();
      const triGain = ctx.createGain();
      const pan = panner(ctx, 0);
      saw.connect(sawGain).connect(pan);
      tri.connect(triGain).connect(pan);
      pan.connect(this.filter);
      this.voices.push({ saw, tri, sawGain, triGain, pan });
    }

    this.sub = ctx.createOscillator();
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0;
    this.sub.connect(this.subGain).connect(this.subGate.node);
  }

  start(at: number): void {
    for (const v of this.voices) {
      v.saw.start(at);
      v.tri.start(at);
    }
    this.sub.start(at);
    this.sweep.start(at);
    this.autopanLfo.start(at);
  }

  stop(at: number): void {
    const nodes: AudioScheduledSourceNode[] = [this.sub, this.sweep, this.autopanLfo];
    for (const v of this.voices) nodes.push(v.saw, v.tri);
    stopAll(nodes, at);
  }

  baseRootHz(e: SoundParams): number {
    return midiToHz(e.root, e.a432 ? 432 : 440);
  }

  private walkRootHz(e: SoundParams): number {
    const steps = WALKS[e.walkPattern]?.steps ?? WALKS[0].steps;
    const step = e.walkOn ? steps[this.walkIndex % steps.length] : 0;
    return this.baseRootHz(e) * intervalRatio(step, e.justTuning === 1);
  }

  /** The root that is sounding (or will be) at audio time t, for bells and shimmer. */
  rootAt(t: number): number {
    let hz = this.rootTrail.length ? this.rootTrail[0].hz : 55;
    for (const p of this.rootTrail) {
      if (p.t <= t) hz = p.hz;
      else break;
    }
    return hz;
  }

  private glideTo(rootHz: number, e: SoundParams, at: number, tau: number): void {
    const voicing = VOICINGS[e.voicing] ?? VOICINGS[0];
    voicing.voices.forEach(([ratio], i) => {
      const v = this.voices[i];
      v.saw.frequency.setTargetAtTime(rootHz * ratio, at, tau);
      v.tri.frequency.setTargetAtTime(rootHz * ratio, at, tau);
    });
    this.sub.frequency.setTargetAtTime(rootHz / 2, at, tau);
    this.rootTrail.push({ t: at, hz: rootHz });
    this.rootTrail.sort((a, b) => a.t - b.t);
    // Keep only what bells could still ask about.
    while (this.rootTrail.length > 2 && this.rootTrail[1].t < at - 60) this.rootTrail.shift();
  }

  /** Advance the wander by one step at time `at`. */
  walkStep(e: SoundParams, at: number): void {
    if (!e.walkOn) return;
    this.walkIndex++;
    this.glideTo(this.walkRootHz(e), e, at, e.glide);
  }

  apply(e: SoundParams, now: number, tau: number, s: Smoother): void {
    const prev = this.applied;
    const first = prev === null;

    if (first) {
      const hz = this.walkRootHz(e);
      const voicing = VOICINGS[e.voicing] ?? VOICINGS[0];
      voicing.voices.forEach(([ratio], i) => {
        this.voices[i].saw.frequency.value = hz * ratio;
        this.voices[i].tri.frequency.value = hz * ratio;
      });
      this.sub.frequency.value = hz / 2;
      this.rootTrail = [{ t: 0, hz }];
    } else if (
      prev.root !== e.root || prev.a432 !== e.a432 || prev.justTuning !== e.justTuning ||
      prev.voicing !== e.voicing || prev.walkPattern !== e.walkPattern || prev.walkOn !== e.walkOn
    ) {
      if (prev.walkPattern !== e.walkPattern || (prev.walkOn && !e.walkOn)) this.walkIndex = 0;
      // Musical changes glide at the walk's own pace, never faster than 1.5 s.
      this.glideTo(this.walkRootHz(e), e, now, Math.max(1.5, e.glide * 0.6));
    }

    const voicing = VOICINGS[e.voicing] ?? VOICINGS[0];
    voicing.voices.forEach(([, unit, gain], i) => {
      const v = this.voices[i];
      s.set(v.saw.detune, unit * e.detune, now, tau);
      s.set(v.tri.detune, unit * e.detune, now, tau);
      s.set(v.sawGain.gain, gain * PAN_COMP * e.edge, now, tau);
      s.set(v.triGain.gain, gain * PAN_COMP * (1 - e.edge) * 1.5, now, tau);
      if (v.pan.pan) s.set(v.pan.pan, PANS[i] * e.droneWidth, now, tau);
    });

    s.set(this.filter.frequency, e.cutoff, now, tau);
    s.set(this.filter.Q, e.resonance, now, tau);
    s.set(this.sweep.frequency, 1 / e.sweepPeriod, now, tau);
    s.set(this.sweepGain.gain, Math.min(e.sweepDepth, e.cutoff * 0.85), now, tau);
    s.set(this.autopanDepth.gain, e.autopan * 0.7, now, tau);
    s.set(this.subGain.gain, e.sub * SUB_GAIN, now, tau);

    const level = e.droneOn ? e.droneLevel * DRONE_GAIN : 0;
    this.gate.set(level, now, tau, s);
    this.subGate.set(e.droneOn && e.sub > 0 ? 1 : 0, now, tau, s);
    this.applied = { ...e };
  }

  tick(now: number): void {
    this.gate.tick(now);
    this.subGate.tick(now);
  }
}

function stopAll(nodes: AudioScheduledSourceNode[], at: number): void {
  for (const n of nodes) {
    try {
      n.stop(at);
    } catch {
      // Never started, or already stopped.
    }
  }
}
