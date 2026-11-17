// Textures: noise beds, rain, ocean, wind and the endless rise, all generated
// live in one AudioWorklet node with a separate output per texture.

import type { SoundParams } from '../params';
import { Gate, Smoother } from '../nodes';

type Key = 'noise' | 'rain' | 'ocean' | 'wind' | 'shepard';
const KEYS: Key[] = ['noise', 'rain', 'ocean', 'wind', 'shepard'];
const GAIN: Record<Key, number> = { noise: 2.4, rain: 1.9, ocean: 2.3, wind: 1.5, shepard: 0.63 };
const SEND: Record<Key, number> = { noise: 0, rain: 0.25, ocean: 0.3, wind: 0.4, shepard: 1 };

export class Textures {
  private readonly node: AudioWorkletNode;
  private readonly gates = {} as Record<Key, Gate>;
  private readonly noiseTone: BiquadFilterNode;

  constructor(ctx: BaseAudioContext, dry: AudioNode, reverbIn: AudioNode, seed: number) {
    this.node = new AudioWorkletNode(ctx, 'tw-textures', {
      numberOfInputs: 0,
      numberOfOutputs: KEYS.length,
      outputChannelCount: KEYS.map(() => 2),
      processorOptions: { seed },
    });
    this.noiseTone = ctx.createBiquadFilter();
    this.noiseTone.type = 'lowpass';
    this.noiseTone.frequency.value = 2400;
    this.noiseTone.Q.value = 0.5;
    const rainTone = ctx.createBiquadFilter();
    rainTone.type = 'lowpass';
    rainTone.frequency.value = 6500;
    rainTone.Q.value = 0.4;

    KEYS.forEach((k, i) => {
      const dests: AudioNode[] = [dry];
      if (SEND[k] > 0) {
        const send = ctx.createGain();
        send.gain.value = SEND[k];
        send.connect(reverbIn);
        dests.push(send);
      }
      const gate = new Gate(ctx, dests);
      this.gates[k] = gate;
      if (k === 'noise') this.node.connect(this.noiseTone, i).connect(gate.node);
      else if (k === 'rain') this.node.connect(rainTone, i).connect(gate.node);
      else this.node.connect(gate.node, i);
    });
  }

  private flag(name: string, on: boolean, now: number): void {
    const p = this.node.parameters.get(name);
    if (p) p.setValueAtTime(on ? 1 : 0, now);
  }

  private set(name: string, v: number, now: number): void {
    const p = this.node.parameters.get(name);
    if (p) p.setValueAtTime(v, now);
  }

  apply(e: SoundParams, now: number, tau: number, s: Smoother, rootHz: number): void {
    const levels: Record<Key, number> = {
      noise: e.noiseOn ? e.noiseLevel : 0,
      rain: e.rainOn ? e.rainLevel : 0,
      ocean: e.oceanOn ? e.oceanLevel : 0,
      wind: e.windOn ? e.windLevel : 0,
      shepard: e.shepardOn ? e.shepardLevel : 0,
    };
    for (const k of KEYS) {
      this.gates[k].set(levels[k] * GAIN[k], now, Math.max(tau, 0.5), s);
      // Keep generating until the fade-out has finished and the gate has slept.
      this.flag(k, levels[k] > 0 || this.gates[k].awake, now);
    }
    this.set('color', e.noiseColor, now);
    this.set('rainDensity', e.rainDensity, now);
    let base = rootHz;
    while (base > 40) base /= 2;
    this.set('shepardBase', base, now);
    this.set('shepardRate', 1 / (e.shepardMinutes * 60), now);
    s.set(this.noiseTone.frequency, e.noiseTone, now, tau);
  }

  tick(now: number): void {
    for (const k of KEYS) {
      const wasAwake = this.gates[k].awake;
      this.gates[k].tick(now);
      if (wasAwake && !this.gates[k].awake) this.flag(k, false, now);
    }
  }
}
