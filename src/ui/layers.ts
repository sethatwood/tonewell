// The kinds of sound in the water, with their lights. One list for the
// Shape sheet's layer chips, All settings and the sound cards' dots.

import type { ParamId, SoundParams } from '../audio/params';

export interface LayerInfo {
  key: string;
  label: string;
  /** Turns the layer on and off. Space and Drift have no switch. */
  on?: ParamId;
  /** Its level, or the setting that stands for it (Space: reverb mix). */
  level: ParamId;
  /** The two or three settings shown when its chip is opened. */
  most: ParamId[];
  /** Everything else about it, for All settings. */
  all: ParamId[];
}

/** The sound layers, as layer chips. */
export const SOUND_LAYERS: readonly LayerInfo[] = [
  {
    key: 'drone', label: 'Drone', on: 'droneOn', level: 'droneLevel', most: ['cutoff', 'sweepPeriod'],
    all: ['voicing', 'root', 'justTuning', 'a432', 'cutoff', 'resonance', 'sweepPeriod', 'sweepDepth', 'edge', 'detune', 'droneWidth', 'sub', 'walkOn', 'walkPattern', 'walkEvery', 'glide'],
  },
  { key: 'breath', label: 'Breath', on: 'breathOn', level: 'breathLevel', most: ['breathPeriod', 'breathCenter'], all: ['breathCenter', 'breathPeriod', 'breathDepth', 'breathQ'] },
  {
    key: 'bells', label: 'Bells', on: 'bellsOn', level: 'bellsLevel', most: ['bellsDensity', 'bellsDecay'],
    all: ['bellsDensity', 'bellsScale', 'bellsRegister', 'bellsDecay', 'bellsSpread', 'echoTime', 'echoFeedback'],
  },
  { key: 'voices', label: 'Voices', on: 'voicesOn', level: 'voicesLevel', most: ['voicesDensity', 'voicesSpace'], all: ['voicesDensity', 'voicesRegister', 'voicesMorph', 'voicesBreath', 'voicesSpace'] },
  { key: 'shimmer', label: 'Shimmer', on: 'shimmerOn', level: 'shimmerLevel', most: [], all: [] },
  { key: 'noise', label: 'Noise', on: 'noiseOn', level: 'noiseLevel', most: ['noiseColor', 'noiseTone'], all: ['noiseColor', 'noiseTone'] },
  { key: 'rain', label: 'Rain', on: 'rainOn', level: 'rainLevel', most: ['rainDensity'], all: ['rainDensity'] },
  { key: 'ocean', label: 'Ocean', on: 'oceanOn', level: 'oceanLevel', most: [], all: [] },
  { key: 'wind', label: 'Wind', on: 'windOn', level: 'windLevel', most: [], all: [] },
  { key: 'rise', label: 'Endless rise', on: 'shepardOn', level: 'shepardLevel', most: ['shepardMinutes'], all: ['shepardMinutes'] },
];

/** Space and Drift: always there, shaped only in All settings. */
export const SHAPING_LAYERS: readonly LayerInfo[] = [
  { key: 'space', label: 'Space', level: 'reverbMix', most: [], all: ['reverbSize', 'reverbTone', 'width', 'autopan'] },
  { key: 'drift', label: 'Drift', level: 'driftAmount', most: [], all: ['driftSpeed'] },
];

export const isOn = (l: LayerInfo, p: SoundParams): boolean => !l.on || !!p[l.on];

/** The layers playing in a sound, for its card's lights. */
export function layersIn(p: SoundParams): LayerInfo[] {
  return SOUND_LAYERS.filter((l) => isOn(l, p) && p[l.level] > 0);
}
