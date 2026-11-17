// Turns stored parameters into what the engine actually plays: drift wanders
// chosen parameters, the two macros bend several at once, and soft landing
// overrides everything toward a low, warm hum.

import { PARAMS, PARAM_IDS, clampParam, type ParamDef, type ParamId, type SoundParams } from './params';

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

export function shapeParams(p: SoundParams, o: ShapeOptions): SoundParams {
  const e = { ...p };

  // Drift
  if (p.driftAmount > 0) {
    for (const id of PARAM_IDS) {
      const d: ParamDef = PARAMS[id];
      if (!d.drift) continue;
      e[id] = clampParam(id, applyDrift(id, p[id], p.driftAmount, driftOffset(id, o.t, p.driftSpeed, o.seed)));
    }
  }

  // Tone: one octave darker to one octave brighter.
  const k = Math.pow(2, (p.tone - 0.5) * 2);
  e.cutoff = clampParam('cutoff', e.cutoff * k);
  e.breathCenter = clampParam('breathCenter', e.breathCenter * Math.pow(k, 0.7));
  e.noiseTone = clampParam('noiseTone', e.noiseTone * k);

  // Depth: space and low end.
  const d = p.depth;
  e.reverbMix = Math.min(1, e.reverbMix * (0.5 + d));
  e.sub = Math.min(1, e.sub * (0.6 + 0.8 * d));
  e.width = clampParam('width', e.width * (0.8 + 0.4 * d));
  e.echoFeedback = clampParam('echoFeedback', e.echoFeedback * (0.7 + 0.6 * d));

  if (o.landing) {
    e.cutoff = Math.min(e.cutoff, 190);
    e.resonance = Math.min(e.resonance, 1.5);
    e.sweepDepth = Math.min(e.sweepDepth, 40);
    e.walkOn = 0;
    e.beatOn = 0;
    e.bellsOn = 0;
    e.shimmerOn = 0;
    e.shepardOn = 0;
    e.breathLevel *= 0.35;
    e.noiseLevel *= 0.5;
    e.rainLevel *= 0.5;
    e.oceanLevel *= 0.5;
    e.windLevel *= 0.4;
    e.reverbMix *= 0.8;
    e.sub = Math.min(1, e.sub * 1.15);
    e.droneLevel *= 0.9;
    e.autopan = 0;
  }
  return e;
}
