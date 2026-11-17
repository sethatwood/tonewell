// Voices: a wordless, synthesized choir. Each voice is a soft sawtooth with
// a little vibrato and breath, shaped by three formant filters into a vowel
// ("oo", "oh", "ah", "eh" or a hummed "mm"). Voices sing slow phrases on
// notes of the drone's chord, breathe between them, and drift from vowel to
// vowel. No words, ever: speech competes with a mantra and with focus.

import type { SoundParams } from '../params';
import { Gate, Smoother, panner } from '../nodes';
import { pinkNoiseBuffer } from './breath';
import { VOICINGS } from '../tuning';

interface Vowel {
  f: [number, number, number];
  g: [number, number, number];
}

// Formant centres in Hz (adult averages) and relative levels.
export const VOWELS: Record<string, Vowel> = {
  oo: { f: [300, 870, 2240], g: [1, 0.35, 0.08] },
  oh: { f: [500, 900, 2400], g: [1, 0.45, 0.1] },
  ah: { f: [730, 1090, 2440], g: [1, 0.5, 0.15] },
  eh: { f: [530, 1840, 2480], g: [1, 0.35, 0.15] },
  mm: { f: [270, 1000, 2200], g: [1, 0.08, 0.03] },
};
const VOWEL_NAMES = Object.keys(VOWELS);
const BANDWIDTH = [90, 110, 140];
const MAX_VOICES = 5;
const VOICE_GAIN = 0.55;

interface Voice {
  osc: OscillatorNode;
  vibrato: OscillatorNode;
  vibratoDepth: GainNode;
  soften: BiquadFilterNode;
  breath: GainNode;
  formants: BiquadFilterNode[];
  formantGains: GainNode[];
  amp: GainNode;
  pan: AudioNode & { pan?: AudioParam };
  next: number;
  singing: boolean;
}

export class Voices {
  readonly gate: Gate;
  private readonly send: GainNode;
  private readonly voices: Voice[] = [];
  private readonly noise: AudioBufferSourceNode;
  private e: SoundParams | null = null;
  private level = 0;

  constructor(
    ctx: BaseAudioContext,
    dry: AudioNode,
    reverbIn: AudioNode,
    private readonly random: () => number,
    seed: number,
  ) {
    this.send = ctx.createGain();
    this.send.gain.value = 0.8;
    this.send.connect(reverbIn);
    this.gate = new Gate(ctx, [dry, this.send]);
    this.noise = ctx.createBufferSource();
    this.noise.buffer = pinkNoiseBuffer(ctx, 7.3, seed);
    this.noise.loop = true;

    for (let i = 0; i < MAX_VOICES; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 4.6 + this.random() * 0.9;
      const vibratoDepth = ctx.createGain();
      vibratoDepth.gain.value = 9; // cents
      vibrato.connect(vibratoDepth).connect(osc.detune);
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 3200;
      soften.Q.value = 0.4;
      const breath = ctx.createGain();
      breath.gain.value = 0;
      this.noise.connect(breath);
      osc.connect(soften);
      const amp = ctx.createGain();
      amp.gain.value = 0;
      const formants: BiquadFilterNode[] = [];
      const formantGains: GainNode[] = [];
      for (let k = 0; k < 3; k++) {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = VOWELS.oo.f[k];
        f.Q.value = VOWELS.oo.f[k] / BANDWIDTH[k];
        const g = ctx.createGain();
        g.gain.value = VOWELS.oo.g[k];
        soften.connect(f);
        breath.connect(f);
        f.connect(g).connect(amp);
        formants.push(f);
        formantGains.push(g);
      }
      const pan = panner(ctx, (i / (MAX_VOICES - 1)) * 1.4 - 0.7);
      amp.connect(pan).connect(this.gate.node);
      this.voices.push({ osc, vibrato, vibratoDepth, soften, breath, formants, formantGains, amp, pan, next: 0, singing: false });
    }
  }

  start(at: number): void {
    this.noise.start(at);
    this.voices.forEach((v, i) => {
      v.osc.start(at);
      v.vibrato.start(at);
      v.next = at + 1 + i * 2.5 + this.random() * 2;
    });
  }

  apply(e: SoundParams, now: number, tau: number, s: Smoother): void {
    this.e = e;
    this.level = e.voicesOn ? e.voicesLevel : 0;
    s.set(this.send.gain, e.voicesSpace * 1.2, now, tau);
    for (const v of this.voices) s.set(v.breath.gain, 0.05 + e.voicesBreath * 0.5, now, tau);
    this.gate.set(this.level > 0 ? VOICE_GAIN : 0, now, Math.max(tau, 1), s);
    if (this.level <= 0) {
      for (const v of this.voices) {
        if (v.singing) {
          v.amp.gain.cancelScheduledValues(now);
          v.amp.gain.setTargetAtTime(0, now, 1.2);
          v.singing = false;
        }
      }
    }
  }

  private chordTones(e: SoundParams): number[] {
    const voicing = VOICINGS[e.voicing] ?? VOICINGS[0];
    const tones = new Set<number>();
    for (const [ratio] of voicing.voices) tones.add(ratio / Math.pow(2, Math.floor(Math.log2(ratio))));
    return [...tones];
  }

  /** Place phrases ahead of time. `rootAt` gives the drone's root at a moment. */
  pump(now: number, horizon: number, rootAt: (t: number) => number): void {
    const e = this.e;
    if (!e || this.level <= 0) return;
    const density = Math.round(e.voicesDensity);
    const tones = this.chordTones(e);
    this.voices.forEach((v, i) => {
      if (i >= density) {
        if (v.singing && v.next < horizon) {
          v.amp.gain.setTargetAtTime(0, Math.max(now, v.next), 1.5);
          v.singing = false;
        }
        return;
      }
      while (v.next < horizon) {
        const t = Math.max(v.next, now + 0.05);
        this.phrase(v, t, rootAt(t), tones, e);
        v.next = t + 9 + this.random() * 12;
      }
    });
  }

  private phrase(v: Voice, t: number, root: number, tones: number[], e: SoundParams): void {
    // Register: from a low monk (about two octaves above the drone's root) to high and ethereal.
    const octave = 1 + e.voicesRegister * 2.5 + (this.random() < 0.3 ? 1 : 0) * (this.random() < 0.5 ? -1 : 1);
    const ratio = tones[Math.floor(this.random() * tones.length)];
    let f = root * ratio * Math.pow(2, Math.round(octave));
    while (f > 900) f /= 2;
    while (f < 90) f *= 2;
    const vowel = VOWELS[VOWEL_NAMES[Math.floor(this.random() * VOWEL_NAMES.length)]];
    const shift = 1 + 0.18 * e.voicesRegister;
    const morph = e.voicesMorph;
    const amp = v.amp.gain;
    // Breathe out, move to the new note and vowel, breathe in again.
    if (v.singing) amp.setTargetAtTime(0, t, 0.9);
    const onset = t + (v.singing ? 3.2 : 0.2);
    v.osc.frequency.setTargetAtTime(f, onset - 0.3, 0.25);
    v.formants.forEach((flt, k) => {
      flt.frequency.setTargetAtTime(vowel.f[k] * shift, onset - 0.3, Math.max(0.5, morph / 4));
      flt.Q.setTargetAtTime((vowel.f[k] * shift) / BANDWIDTH[k], onset - 0.3, Math.max(0.5, morph / 4));
      v.formantGains[k].gain.setTargetAtTime(vowel.g[k], onset - 0.3, Math.max(0.5, morph / 4));
    });
    const loud = this.level * (0.75 + this.random() * 0.25) * (f > 500 ? 0.7 : 1);
    amp.setTargetAtTime(loud, onset, 1.4);
    v.singing = true;
    // Mid-phrase, drift toward another vowel.
    const later = VOWELS[VOWEL_NAMES[Math.floor(this.random() * VOWEL_NAMES.length)]];
    v.formants.forEach((flt, k) => {
      flt.frequency.setTargetAtTime(later.f[k] * shift, onset + morph * 0.5, Math.max(0.8, morph / 3));
    });
  }

  tick(now: number): void {
    this.gate.tick(now);
  }
}
