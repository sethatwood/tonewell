// The sound parameter schema. One table drives the engine, presets, the
// drift macro and the control panel, so every control has exactly one
// definition of its range, default, units and label.

import { BELL_SCALES, VOICINGS, WALKS, bandName, noteName } from './tuning';

export type Group = 'drone' | 'beat' | 'breath' | 'bells' | 'textures' | 'space' | 'drift' | 'macro';

export interface ParamDef {
  label: string;
  group: Group;
  kind: 'range' | 'toggle' | 'choice';
  min: number;
  max: number;
  step: number;
  def: number;
  /** Slider mapping: 'log' for frequencies and rates; 'bands' gives each brainwave band equal width. */
  scale?: 'log' | 'bands';
  choices?: readonly string[];
  /** How far drift may wander, as a fraction of the range (0 or absent: never drifts). */
  drift?: number;
  format?: (v: number) => string;
  /** Short, plain-language help shown under the control. */
  help?: string;
}

const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (v: number) => (v >= 90 ? `${(v / 60).toFixed(1).replace(/\.0$/, '')} min` : `${Math.round(v)} s`);
const beatHz = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} Hz ${bandName(v)}`;

function macroWord(v: number, low: string, high: string): string {
  const d = v - 0.5;
  if (Math.abs(d) < 0.03) return 'as designed';
  const amount = Math.abs(d) > 0.35 ? 'much ' : Math.abs(d) > 0.15 ? '' : 'a little ';
  return amount + (d < 0 ? low : high);
}

/** Edges of the brainwave bands: delta, theta, alpha, beta, gamma. */
export const BAND_EDGES = [0.5, 4, 8, 13, 30, 40];

const toggle = (group: Group, label: string, def: 0 | 1, help?: string): ParamDef => ({
  label, group, kind: 'toggle', min: 0, max: 1, step: 1, def, help,
});
const choice = (group: Group, label: string, choices: readonly string[], def = 0, help?: string): ParamDef => ({
  label, group, kind: 'choice', min: 0, max: choices.length - 1, step: 1, def, choices, help,
});
const range = (
  group: Group, label: string, min: number, max: number, def: number, step: number,
  extra: Partial<ParamDef> = {},
): ParamDef => ({ label, group, kind: 'range', min, max, def, step, format: pct, ...extra });

export const PARAMS = {
  // Drone
  droneOn: toggle('drone', 'Drone', 1),
  droneLevel: range('drone', 'Level', 0, 1, 0.7, 0.01),
  root: range('drone', 'Root', 26, 45, 33, 1, { format: noteName, help: 'The home note the drone wanders from.' }),
  voicing: choice('drone', 'Chord', VOICINGS.map((v) => v.name)),
  justTuning: toggle('drone', 'Just tuning', 0, 'Pure-ratio steps for the wander and the bells. Equal tuning matches a piano.'),
  a432: toggle('drone', 'A = 432', 0, 'A tuning preference some people like. It has no proven effect.'),
  edge: range('drone', 'Edge', 0, 1, 1, 0.01, { help: 'Soft and rounded at the left, bright and reedy at the right.' }),
  detune: range('drone', 'Detune', 0, 20, 7, 0.5, { format: (v) => `${v} ct`, help: 'Slow beating between voices.' }),
  droneWidth: range('drone', 'Width', 0, 1, 0.2, 0.01),
  cutoff: range('drone', 'Filter', 80, 2400, 420, 1, { scale: 'log', format: hz, drift: 0.22 }),
  resonance: range('drone', 'Resonance', 0.5, 12, 5, 0.1, { format: (v) => v.toFixed(1), drift: 0.12 }),
  sweepPeriod: range('drone', 'Sweep', 8, 180, 32, 1, { scale: 'log', format: (v) => `every ${secs(v)}` }),
  sweepDepth: range('drone', 'Sweep depth', 0, 600, 280, 1, { format: hz, drift: 0.18 }),
  sub: range('drone', 'Sub', 0, 1, 0.5, 0.01),
  walkOn: toggle('drone', 'Wander', 1, 'The root drifts between nearby notes, gliding slowly.'),
  walkPattern: choice('drone', 'Wander path', WALKS.map((w) => w.name)),
  walkEvery: range('drone', 'Wander every', 20, 300, 50, 1, { scale: 'log', format: secs }),
  glide: range('drone', 'Glide', 1, 20, 5, 0.5, { format: (v) => `${v} s` }),

  // Beat (binaural, monaural, isochronic)
  beatOn: toggle('beat', 'Beat', 1),
  beatMode: choice('beat', 'Type', ['Binaural', 'Monaural', 'Isochronic']),
  beatHz: range('beat', 'Beat', 0.5, 40, 6, 0.1, { scale: 'bands', format: beatHz }),
  carrierTuned: toggle('beat', 'Tuned to the drone', 1, 'The carrier tone sits on a harmonic of the drone instead of clashing with it.'),
  carrier: range('beat', 'Carrier', 100, 400, 111, 1, { format: hz }),
  beatLevel: range('beat', 'Level', 0, 1, 0.5, 0.01),
  rampOn: toggle('beat', 'Glide', 0, 'Start at one beat and glide to another.'),
  rampFrom: range('beat', 'Start at', 0.5, 40, 10, 0.1, { scale: 'bands', format: beatHz }),
  rampMin: range('beat', 'Glide over', 1, 30, 8, 1, { format: (v) => `${v} min` }),
  rampReturn: toggle('beat', 'Come back up', 1, 'Glide back to the start beat at the end of a timed session.'),
  returnMin: range('beat', 'Come back over', 1, 10, 3, 1, { format: (v) => `${v} min` }),

  // Breath (filtered noise)
  breathOn: toggle('breath', 'Breath', 1),
  breathLevel: range('breath', 'Level', 0, 1, 0.5, 0.01, { drift: 0.15 }),
  breathCenter: range('breath', 'Color', 200, 2400, 700, 1, { scale: 'log', format: hz, drift: 0.2 }),
  breathPeriod: range('breath', 'Rise and fall', 4, 60, 14, 0.5, { scale: 'log', format: (v) => `every ${secs(v)}` }),
  breathDepth: range('breath', 'Movement', 0, 800, 500, 1, { format: hz }),
  breathQ: range('breath', 'Focus', 0.5, 6, 1.6, 0.1, { format: (v) => v.toFixed(1) }),

  // Bells
  bellsOn: toggle('bells', 'Bells', 1),
  bellsLevel: range('bells', 'Level', 0, 1, 0.5, 0.01),
  bellsDensity: range('bells', 'How often', 1, 40, 16, 0.5, { format: (v) => `${Math.round(v)} a minute`, drift: 0.25 }),
  bellsRegister: range('bells', 'Register', -1, 2, 0, 1, { format: (v) => (v === 0 ? 'middle' : v < 0 ? 'low' : v === 1 ? 'high' : 'highest') }),
  bellsDecay: range('bells', 'Ring', 1, 12, 5, 0.1, { format: (v) => `${v.toFixed(1)} s` }),
  bellsScale: choice('bells', 'Scale', BELL_SCALES.map((s) => s.name)),
  bellsSpread: range('bells', 'Spread', 0, 1, 0.8, 0.01),
  echoTime: range('bells', 'Echo time', 0.1, 1.5, 0.48, 0.01, { format: (v) => `${v.toFixed(2)} s` }),
  echoFeedback: range('bells', 'Echo repeats', 0, 0.75, 0.45, 0.01),

  // Textures
  noiseOn: toggle('textures', 'Noise bed', 0),
  noiseLevel: range('textures', 'Level', 0, 1, 0.5, 0.01),
  noiseColor: choice('textures', 'Color', ['Brown', 'Pink', 'White'], 0),
  noiseTone: range('textures', 'Tone', 200, 12000, 2400, 1, { scale: 'log', format: hz, drift: 0.12 }),
  rainOn: toggle('textures', 'Rain', 0),
  rainLevel: range('textures', 'Level', 0, 1, 0.5, 0.01),
  rainDensity: range('textures', 'Heaviness', 0, 1, 0.45, 0.01, { drift: 0.2 }),
  oceanOn: toggle('textures', 'Ocean', 0),
  oceanLevel: range('textures', 'Level', 0, 1, 0.5, 0.01),
  windOn: toggle('textures', 'Wind', 0),
  windLevel: range('textures', 'Level', 0, 1, 0.5, 0.01),
  shimmerOn: toggle('textures', 'Shimmer', 0),
  shimmerLevel: range('textures', 'Level', 0, 1, 0.4, 0.01),
  shepardOn: toggle('textures', 'Endless rise', 0, 'A very slow Shepard tone that seems to climb forever.'),
  shepardLevel: range('textures', 'Level', 0, 1, 0.3, 0.01),
  shepardMinutes: range('textures', 'Octave every', 1, 10, 4, 0.5, { format: (v) => `${v} min` }),

  // Space
  reverbMix: range('space', 'Reverb', 0, 1, 0.7, 0.01, { drift: 0.12 }),
  reverbSize: choice('space', 'Room', ['Room', 'Hall', 'Cathedral', 'Cavern'], 2),
  reverbTone: range('space', 'Reverb tone', 1500, 16000, 9000, 10, { scale: 'log', format: hz }),
  width: range('space', 'Stereo width', 0, 1.5, 1, 0.01, { drift: 0.08 }),
  autopan: range('space', 'Slow pan', 0, 1, 0, 0.01),

  // Drift
  driftAmount: range('drift', 'Drift', 0, 1, 0.3, 0.01, { help: 'Lets the filter, breath, bells and space wander slowly on their own.' }),
  driftSpeed: range('drift', 'Drift speed', 0.25, 4, 1, 0.05, { scale: 'log', format: (v) => `${v.toFixed(2)}×` }),

  // Macros shown in the mini player. Both are centred on the preset as designed.
  warmth: range('macro', 'Warmth', 0, 1, 0.5, 0.01, { format: (v) => macroWord(v, 'warmer', 'brighter'), help: 'Warm at the left, bright at the right. The middle is the preset as designed.' }),
  motion: range('macro', 'Drift', 0, 1, 0.5, 0.01, { format: (v) => macroWord(v, 'stiller', 'wandering'), help: 'Still at the left, wandering at the right: drift, root walk, bells and sweep together.' }),
} satisfies Record<string, ParamDef>;

export type ParamId = keyof typeof PARAMS;
export type SoundParams = Record<ParamId, number>;

export const PARAM_IDS = Object.keys(PARAMS) as ParamId[];

export function defaultParams(): SoundParams {
  const out = {} as SoundParams;
  for (const id of PARAM_IDS) out[id] = PARAMS[id].def;
  return out;
}

export function clampParam(id: ParamId, v: number): number {
  const d: ParamDef = PARAMS[id];
  if (!Number.isFinite(v)) return d.def;
  const c = Math.min(d.max, Math.max(d.min, v));
  return d.kind === 'range' ? c : Math.round(c);
}

/** Merge partial values over a base, dropping unknown keys and clamping the rest. */
export function mergeParams(base: SoundParams, patch: Partial<Record<string, number>> | undefined): SoundParams {
  const out = { ...base };
  if (!patch) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (k in PARAMS && typeof v === 'number') out[k as ParamId] = clampParam(k as ParamId, v);
  }
  return out;
}

/** Slider position (0..1) for a value, honoring log scales. */
export function toSlider(id: ParamId, v: number): number {
  const d: ParamDef = PARAMS[id];
  if (d.scale === 'bands') {
    const n = BAND_EDGES.length - 1;
    for (let i = 0; i < n; i++) {
      const lo = BAND_EDGES[i];
      const hi = BAND_EDGES[i + 1];
      if (v <= hi || i === n - 1) return (i + Math.min(1, Math.max(0, (v - lo) / (hi - lo)))) / n;
    }
  }
  if (d.scale === 'log') return Math.log(v / d.min) / Math.log(d.max / d.min);
  return (v - d.min) / (d.max - d.min);
}

export function fromSlider(id: ParamId, s: number): number {
  const d: ParamDef = PARAMS[id];
  const x = Math.min(1, Math.max(0, s));
  let raw: number;
  if (d.scale === 'bands') {
    const n = BAND_EDGES.length - 1;
    const i = Math.min(n - 1, Math.floor(x * n));
    const f = x * n - i;
    raw = BAND_EDGES[i] + f * (BAND_EDGES[i + 1] - BAND_EDGES[i]);
  } else {
    raw = d.scale === 'log' ? d.min * Math.pow(d.max / d.min, x) : d.min + x * (d.max - d.min);
  }
  const stepped = Math.round(raw / d.step) * d.step;
  return clampParam(id, Number(stepped.toFixed(4)));
}

export function formatParam(id: ParamId, v: number): string {
  const d: ParamDef = PARAMS[id];
  if (d.kind === 'toggle') return v ? 'On' : 'Off';
  if (d.kind === 'choice') return d.choices?.[v] ?? String(v);
  return d.format ? d.format(v) : String(v);
}
