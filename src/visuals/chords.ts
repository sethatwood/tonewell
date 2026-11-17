// The drone's chord as the small whole-number ratio the Harmonograph scene
// draws. Kept apart from the shader so the main window can use it cheaply.

/** Each drone voicing as a ratio: fifth, octave, minor third, fourth. */
export const CHORD_RATIOS: ReadonlyArray<[number, number]> = [[3, 2], [2, 1], [6, 5], [4, 3]];

export function chordRatio(voicing: number): [number, number] {
  return CHORD_RATIOS[voicing] ?? [3, 2];
}
