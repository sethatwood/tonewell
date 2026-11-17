// Breath: pink noise through a band-pass whose centre rises and falls slowly,
// like air moving. The noise buffer is long and decorrelated per ear.

import type { SoundParams } from '../params';
import { Gate, Smoother, rng } from '../nodes';

const BREATH_GAIN = 0.16;

export function pinkNoiseBuffer(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const r = rng(seed);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = r() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.029;
      b1 = 0.985 * b1 + w * 0.032;
      b2 = 0.95 * b2 + w * 0.048;
      d[i] = (b0 + b1 + b2) * 0.4;
    }
    // Crossfade the loop seam so the repeat point is inaudible.
    const fade = Math.floor(ctx.sampleRate * 0.25);
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      d[i] = d[i] * g + d[len - fade + i] * (1 - g);
    }
  }
  return buf;
}

export class Breath {
  private readonly src: AudioBufferSourceNode;
  private readonly band: BiquadFilterNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoGain: GainNode;
  readonly gate: Gate;

  constructor(ctx: BaseAudioContext, dry: AudioNode, reverbIn: AudioNode, seed: number) {
    this.gate = new Gate(ctx, [dry, reverbIn]);
    this.src = ctx.createBufferSource();
    this.src.buffer = pinkNoiseBuffer(ctx, 9.7, seed);
    this.src.loop = true;
    this.band = ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = 700;
    this.band.Q.value = 1.6;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.07;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 500;
    this.lfo.connect(this.lfoGain).connect(this.band.frequency);
    this.src.connect(this.band).connect(this.gate.node);
  }

  start(at: number): void {
    this.src.start(at);
    this.lfo.start(at);
  }

  apply(e: SoundParams, now: number, tau: number, s: Smoother): void {
    s.set(this.band.frequency, e.breathCenter, now, tau);
    s.set(this.band.Q, e.breathQ, now, tau);
    s.set(this.lfo.frequency, 1 / e.breathPeriod, now, tau);
    s.set(this.lfoGain.gain, Math.min(e.breathDepth, e.breathCenter * 0.85), now, tau);
    this.gate.set(e.breathOn ? e.breathLevel * BREATH_GAIN : 0, now, tau, s);
  }

  tick(now: number): void {
    this.gate.tick(now);
  }
}
