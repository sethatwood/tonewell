// Space: a generated-impulse convolution reverb (with size changes cross-faded
// between two convolvers) and a mid/side stereo width stage.

import type { SoundParams } from '../params';
import { Smoother, impulse } from '../nodes';

export const ROOM_SECONDS = [2.5, 4, 6, 10];
const REVERB_GAIN = 1;

export class Reverb {
  readonly input: GainNode;
  readonly output: BiquadFilterNode;
  private readonly mix: GainNode;
  private current: { conv: ConvolverNode; gain: GainNode } | null = null;
  private size = -1;
  private seed = 1;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.mix = ctx.createGain();
    this.mix.gain.value = 0.7;
    this.output = ctx.createBiquadFilter();
    this.output.type = 'lowpass';
    this.output.frequency.value = 9000;
    this.output.Q.value = 0.5;
    this.mix.connect(this.output);
  }

  private load(size: number, now: number, fade: number): void {
    const ctx = this.ctx;
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = impulse(ctx, ROOM_SECONDS[size] ?? 6, 2.6, this.seed++);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    this.input.connect(conv).connect(gain).connect(this.mix);
    if (fade <= 0) {
      gain.gain.value = 1;
    } else {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fade);
    }
    const old = this.current;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      const ttl = (fade + ROOM_SECONDS[this.size] + 1) * 1000;
      // Disconnect the old tail once it has faded; harmless if the context is offline.
      setTimeout(() => {
        try {
          this.input.disconnect(old.conv);
        } catch {
          // Already gone.
        }
        old.gain.disconnect();
      }, ttl);
    }
    this.current = { conv, gain };
    this.size = size;
  }

  apply(e: SoundParams, now: number, tau: number, s: Smoother): void {
    if (e.reverbSize !== this.size) this.load(e.reverbSize, now, this.size < 0 ? 0 : 2.5);
    s.set(this.mix.gain, e.reverbMix * REVERB_GAIN, now, tau);
    s.set(this.output.frequency, e.reverbTone, now, tau);
  }
}

/** Mid/side width: 0 is mono, 1 unchanged, up to 1.5 wider. */
export class Width {
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  private readonly side: GainNode;

  constructor(ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = 'explicit';
    const split = ctx.createChannelSplitter(2);
    this.input.connect(split);

    const mono = (g: number) => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.channelCount = 1;
      n.channelCountMode = 'explicit';
      n.channelInterpretation = 'discrete';
      return n;
    };
    const mid = mono(1);
    const midL = mono(0.5);
    const midR = mono(0.5);
    const sideL = mono(0.5);
    const sideR = mono(-0.5);
    this.side = mono(1);
    const sideInv = mono(-1);

    split.connect(midL, 0);
    split.connect(midR, 1);
    split.connect(sideL, 0);
    split.connect(sideR, 1);
    midL.connect(mid);
    midR.connect(mid);
    sideL.connect(this.side);
    sideR.connect(this.side);

    this.output = ctx.createChannelMerger(2);
    mid.connect(this.output, 0, 0);
    mid.connect(this.output, 0, 1);
    this.side.connect(this.output, 0, 0);
    this.side.connect(sideInv).connect(this.output, 0, 1);
  }

  apply(e: SoundParams, now: number, tau: number, s: Smoother): void {
    s.set(this.side.gain, e.width, now, tau);
  }
}
