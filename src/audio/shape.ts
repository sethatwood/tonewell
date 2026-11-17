// Turns stored parameters into what the engine actually plays: drift wanders
// chosen parameters, the two macros bend several at once, and soft landing
// overrides everything toward a low, warm hum.

import { PARAMS, PARAM_IDS, clampParam, type ParamDef, type ParamId, type SoundParams } from './params';
import { midiToHz } from './tuning';

/** Stable 32-bit hash of a string, for per-parameter phases. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DRIFT_PERIODS = [97, 223, 409];
const DRIFT_WEIGHTS = [1, 0.7, 0.5];
const DRIFT_NORM = DRIFT_WEIGHTS.reduce((a, b) => a + b, 0);

/**
 * A smooth wander in [-1, 1] for one parameter at time t (seconds).
 * Sums three slow sines with incommensurate periods (1.5 to 7 minutes at
 * speed 1), so the path never visibly repeats and never jumps.
 */
export function driftOffset(id: string, t: number, speed: number, seed: number): number {
  const h = hash32(id + ':' + seed);
  let v = 0;
  for (let i = 0; i < DRIFT_PERIODS.length; i++) {
    const phase = (((h >>> (i * 8)) & 0xff) / 256) * Math.PI * 2;
    v += DRIFT_WEIGHTS[i] * Math.sin((2 * Math.PI * t * speed) / DRIFT_PERIODS[i] + phase);
  }
  return v / DRIFT_NORM;
}

export interface ShapeOptions {
  /** Audio-clock seconds since the session began, for drift. */
  t: number;
  seed: number;
  landing: boolean;
}

function applyDrift(id: ParamId, v: number, amount: number, offset: number): number {
  const d: ParamDef = PARAMS[id];
  const reach = (d.drift ?? 0) * amount * offset;
  if (d.scale === 'log') return v * Math.pow(d.max / d.min, reach);
  return v + reach * (d.max - d.min);
}

/** The harmonic of the drone's root that falls between 100 and 200 Hz, for a beat carrier that blends in. */
export function tunedCarrier(p: SoundParams): number {
  const root = midiToHz(p.root, p.a432 ? 432 : 440);
  return root * Math.pow(2, Math.ceil(Math.log2(100 / root)));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function shapeParams(p: SoundParams, o: ShapeOptions): SoundParams {
  const e = { ...p };

  // Drift macro (labelled "Drift"; stored as motion): -1 still … +1 wandering.
  const f = (p.motion - 0.5) * 2;
  const amount = clamp(p.driftAmount * (1 + f) + Math.max(0, f) * 0.2, 0, 1);
  e.driftAmount = amount;
  e.walkEvery = clamp(p.walkEvery * Math.pow(2, -f), 20, 300);
  e.bellsDensity = clamp(p.bellsDensity * Math.pow(2, f * 0.8), 1, 40);
  e.sweepDepth = clamp(p.sweepDepth * (1 + 0.5 * f), 0, 600);

  // Drift itself
  if (amount > 0) {
    for (const id of PARAM_IDS) {
      const d: ParamDef = PARAMS[id];
      // Something turned all the way down stays down: drift never wakes it.
      if (!d.drift || e[id] <= d.min) continue;
      e[id] = clampParam(id, applyDrift(id, e[id], amount, driftOffset(id, o.t, p.driftSpeed, o.seed)));
    }
  }

  // Warmth: an octave warmer to an octave brighter, centred on the preset.
  const w = p.warmth - 0.5;
  const k = Math.pow(2, w * 2);
  e.cutoff = clampParam('cutoff', e.cutoff * k);
  e.breathCenter = clampParam('breathCenter', e.breathCenter * Math.pow(k, 0.7));
  e.noiseTone = clampParam('noiseTone', e.noiseTone * k);
  e.reverbTone = clampParam('reverbTone', e.reverbTone * k);
  // Noise color slides continuously (the generator crossfades between colors).
  e.noiseColor = clamp(p.noiseColor + w, 0, 2);

  if (p.carrierTuned) e.carrier = tunedCarrier(p);

  if (o.landing) {
    e.cutoff = Math.min(e.cutoff, 190);
    e.resonance = Math.min(e.resonance, 1.5);
    e.sweepDepth = Math.min(e.sweepDepth, 40);
    e.walkOn = 0;
    e.beatOn = 0;
    e.bellsOn = 0;
    e.shimmerOn = 0;
    e.shepardOn = 0;
    e.voicesOn = 0;
    e.breathLevel *= 0.35;
    e.noiseLevel *= 0.5;
    e.rainLevel *= 0.5;
    e.oceanLevel *= 0.5;
    e.windLevel *= 0.4;
    e.reverbMix *= 0.8;
    e.reverbTone = Math.min(e.reverbTone, 3000);
    e.sub = Math.min(1, e.sub * 1.15);
    e.droneLevel *= 0.9;
    e.autopan = 0;
  }
  return e;
}
