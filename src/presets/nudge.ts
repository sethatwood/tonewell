// "More like this": the same sound, a little different. Every setting that
// shapes the sound without changing what it is moves by a small random
// amount, about a tenth of its range, measured along its own slider (so a
// filter moves by a musical interval, not a fixed number of hertz).
//
// Left alone: switches and choices (which layers play, the chord, the room),
// the root note, the bells' and voices' registers and how many voices sing,
// the beat (a beat is chosen on purpose, never by chance) and the feel pad's
// two macros.

import { PARAMS, PARAM_IDS, fromSlider, toSlider, type ParamDef, type ParamId, type SoundParams } from '../audio/params';

/** How far a setting may move, as a fraction of its slider. */
const REACH = 0.1;
/** Levels move half as far, so no layer jumps out. */
const LEVEL_REACH = 0.05;

const FIXED = new Set<ParamId>(['root', 'bellsRegister', 'voicesRegister', 'voicesDensity']);

/** Whether "More like this" may move a setting. */
export function nudgeable(id: ParamId): boolean {
  const d: ParamDef = PARAMS[id];
  return d.kind === 'range' && d.group !== 'beat' && d.group !== 'macro' && !FIXED.has(id);
}

const isLevel = (id: ParamId) => /Level$/.test(id);

/** A few small random changes around `p`. `rand` returns 0..1. */
export function moreLikeThis(p: SoundParams, rand: () => number = Math.random): Partial<SoundParams> {
  const out: Partial<SoundParams> = {};
  for (const id of PARAM_IDS) {
    if (!nudgeable(id)) continue;
    // Something turned all the way down stays down: a nudge never wakes it.
    if (p[id] <= PARAMS[id].min) continue;
    const reach = isLevel(id) ? LEVEL_REACH : REACH;
    const pos = toSlider(id, p[id]) + (rand() * 2 - 1) * reach;
    const v = fromSlider(id, Math.min(1, Math.max(0, pos)));
    if (v !== p[id]) out[id] = v;
  }
  return out;
}
