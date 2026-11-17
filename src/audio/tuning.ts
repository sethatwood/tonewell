// Pitch helpers: note names, tuning systems, drone voicings, root walks and bell scales.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

export function midiToHz(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function noteName(midi: number): string {
  const m = Math.round(midi);
  return NOTE_NAMES[((m % 12) + 12) % 12] + String(Math.floor(m / 12) - 1);
}

/** 5-limit just ratios for each semitone of the octave. */
const JUST: readonly number[] = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];

/** Frequency ratio for an interval of `semis` semitones, in just or equal temperament. */
export function intervalRatio(semis: number, just: boolean): number {
  if (!just) return Math.pow(2, semis / 12);
  const octave = Math.floor(semis / 12);
  const pc = semis - octave * 12;
  return JUST[pc] * Math.pow(2, octave);
}

/**
 * A drone voicing: five voices, each [ratio to root, detune unit, gain].
 * The detune unit is multiplied by the Detune control (in cents); the
 * first voicing reproduces the original prototype exactly at 7 cents.
 */
export interface Voicing {
  name: string;
  voices: ReadonlyArray<readonly [number, number, number]>;
}

export const VOICINGS: readonly Voicing[] = [
  { name: 'Open fifth', voices: [[1, -1, 1], [1, 6 / 7, 1], [1.5, -4 / 7, 0.7], [2, 3 / 7, 0.6], [3, 0, 0.25]] },
  { name: 'Octaves', voices: [[1, -1, 1], [1, 6 / 7, 1], [2, -3 / 7, 0.65], [2, 4 / 7, 0.5], [4, 0, 0.18]] },
  { name: 'Minor', voices: [[1, -1, 1], [1, 6 / 7, 1], [1.2, -4 / 7, 0.5], [1.5, 3 / 7, 0.6], [2, 0, 0.35]] },
  { name: 'Suspended', voices: [[1, -1, 1], [1, 6 / 7, 1], [4 / 3, -4 / 7, 0.55], [1.5, 3 / 7, 0.6], [2, 0, 0.35]] },
];

/** Root walks, as semitone offsets from the chosen root. */
export interface Walk {
  name: string;
  steps: readonly number[];
}

export const WALKS: readonly Walk[] = [
  // The prototype's walk: A1, F1, G1, E1.
  { name: 'Wander', steps: [0, -4, -2, -5] },
  { name: 'Pendulum', steps: [0, -2] },
  { name: 'Fourths', steps: [0, -7, -2, -5] },
  { name: 'Long road', steps: [0, -4, -2, -5, -7, -4, -9, -5] },
];

/** Bell pitches as multiples of the current root. */
export interface BellScale {
  name: string;
  ratios: readonly number[];
}

export const BELL_SCALES: readonly BellScale[] = [
  // The prototype's set: harmonics of the root.
  { name: 'Harmonic', ratios: [2, 3, 4, 4.5, 5, 6, 8, 9, 10, 12] },
  { name: 'Pentatonic', ratios: [4, 4.5, 5, 6, 20 / 3, 8, 9, 10, 12] },
  { name: 'Minor pentatonic', ratios: [4, 4.8, 16 / 3, 6, 7.2, 8, 9.6, 32 / 3, 12] },
  { name: 'Fifths', ratios: [2, 3, 4, 6, 8, 12] },
];

/** Brainwave band for a beat frequency, for labels only. */
export function bandName(hz: number): string {
  if (hz < 4) return 'delta';
  if (hz < 8) return 'theta';
  if (hz < 13) return 'alpha';
  if (hz < 30) return 'beta';
  return 'gamma';
}
