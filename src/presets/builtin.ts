// Built-in presets. Each is a small set of changes over its mode's base, which
// in turn sits over the defaults (the original prototype's sound).

import { defaultParams, mergeParams, type SoundParams } from '../audio/params';

export type Mode = 'meditate' | 'focus';

export interface Preset {
  id: string;
  name: string;
  mode: Mode;
  blurb: string;
  params: Partial<SoundParams>;
  builtin?: boolean;
}

/** What each mode changes before any preset: Focus is steadier, with no bells or beat. */
export const MODE_BASE: Record<Mode, Partial<SoundParams>> = {
  meditate: {},
  focus: {
    walkOn: 0,
    bellsOn: 0,
    beatOn: 0,
    breathOn: 0,
    sweepPeriod: 90,
    sweepDepth: 120,
    resonance: 2.5,
    driftAmount: 0.15,
    reverbMix: 0.45,
    reverbSize: 1,
    noiseOn: 1,
    noiseColor: 0,
    noiseLevel: 0.5,
  },
};

export const BUILTIN_PRESETS: readonly Preset[] = [
  {
    id: 'deep-theta',
    name: 'Deep Theta',
    mode: 'meditate',
    blurb: 'The first Tonewell sound: a wandering drone, breath, slow bells and a 6 Hz beat that settles from 10 Hz.',
    params: { rampOn: 1, rampFrom: 10, beatHz: 6, rampMin: 6 },
  },
  {
    id: 'soft-alpha',
    name: 'Soft Alpha',
    mode: 'meditate',
    blurb: 'Lighter and a little brighter, with a 10 Hz beat. For sits where you want to stay alert.',
    params: { root: 36, voicing: 3, beatHz: 10, cutoff: 620, resonance: 4, bellsDensity: 8, bellsScale: 1, breathLevel: 0.4, reverbSize: 1 },
  },
  {
    id: 'night-drone',
    name: 'Night Drone',
    mode: 'meditate',
    blurb: 'Low, dark and slow, with no bells. A 4.5 Hz beat under a deep hum.',
    params: { root: 28, cutoff: 260, resonance: 3, sweepPeriod: 60, bellsOn: 0, sub: 0.8, beatHz: 4.5, reverbSize: 3, walkEvery: 90, breathLevel: 0.3, edge: 0.6 },
  },
  {
    id: 'rain-bed',
    name: 'Rain Bed',
    mode: 'meditate',
    blurb: 'Soft rain over a quiet drone, with the odd bell far away.',
    params: { rainOn: 1, rainLevel: 0.6, rainDensity: 0.4, droneLevel: 0.5, breathOn: 0, bellsDensity: 5, bellsLevel: 0.4, beatLevel: 0.35, cutoff: 360 },
  },
  {
    id: 'bells-only',
    name: 'Bells Only',
    mode: 'meditate',
    blurb: 'No drone: bells and shimmer in a large room, with a little breath.',
    params: { droneOn: 0, breathLevel: 0.45, bellsLevel: 1, bellsDensity: 18, bellsDecay: 7, echoFeedback: 0.5, beatOn: 0, shimmerOn: 1, shimmerLevel: 0.5 },
  },
  {
    id: 'brown-noise-desk',
    name: 'Brown Noise Desk',
    mode: 'focus',
    blurb: 'Deep, even brown noise and nothing else. The plainest bed there is.',
    params: { droneOn: 0, noiseColor: 0, noiseLevel: 0.7, noiseTone: 1400, reverbMix: 0 },
  },
  {
    id: 'warm-drone',
    name: 'Warm Drone',
    mode: 'focus',
    blurb: 'A steady, rounded drone that barely moves, over a little pink noise.',
    params: { droneLevel: 0.6, cutoff: 340, resonance: 2, sweepPeriod: 120, sweepDepth: 80, noiseColor: 1, noiseLevel: 0.25, edge: 0.5 },
  },
  {
    id: 'rain-room',
    name: 'Rain Room',
    mode: 'focus',
    blurb: 'Steady rain with a low drone underneath.',
    params: { rainOn: 1, rainLevel: 0.7, rainDensity: 0.5, droneLevel: 0.35, cutoff: 300, noiseOn: 0 },
  },
  {
    id: 'low-hum',
    name: 'Low Hum',
    mode: 'focus',
    blurb: 'Mostly sub and a closed filter, like a distant engine room.',
    params: { root: 28, cutoff: 180, resonance: 1.5, sub: 0.9, droneLevel: 0.55, voicing: 1, noiseColor: 0, noiseLevel: 0.3, noiseTone: 600 },
  },
  {
    id: 'shoreline',
    name: 'Shoreline',
    mode: 'focus',
    blurb: 'Slow waves arriving and drawing back, with a faint drone.',
    params: { oceanOn: 1, oceanLevel: 0.7, droneLevel: 0.3, cutoff: 280, noiseOn: 0 },
  },
  {
    id: 'steady-alpha',
    name: 'Steady Alpha',
    mode: 'focus',
    blurb: 'The warm drone with a quiet 10 Hz beat. Headphones needed for the binaural part.',
    params: { droneLevel: 0.6, cutoff: 340, resonance: 2, sweepPeriod: 120, sweepDepth: 80, noiseColor: 1, noiseLevel: 0.3, beatOn: 1, beatHz: 10, beatLevel: 0.4, edge: 0.5 },
  },
].map((p) => ({ ...p, builtin: true }) as Preset);

export function presetParams(preset: Preset): SoundParams {
  return mergeParams(mergeParams(defaultParams(), MODE_BASE[preset.mode]), preset.params);
}

export function modeDefaults(mode: Mode): SoundParams {
  return mergeParams(defaultParams(), MODE_BASE[mode]);
}
