import { describe, expect, it } from 'vitest';
import { Session, type Snapshot } from '../../src/session/session';
import { sheetAllowed, sheetIs, type SheetName } from '../../src/ui/sheets/host';
import { feelWords } from '../../src/ui/sheets/shape';
import { moreLikeThis, nudgeable } from '../../src/presets/nudge';
import { PARAMS, PARAM_IDS, defaultParams, toSlider, type ParamId } from '../../src/audio/params';
import { SOUND_LAYERS, layersIn } from '../../src/ui/layers';
import { BUILTIN_PRESETS, presetParams } from '../../src/presets/builtin';

const session = new Session();
const base = session.snapshot();
const snap = (patch: Partial<Snapshot>): Snapshot => ({ ...base, ...patch });
const ALL: SheetName[] = ['sound', 'session', 'beat', 'custom', 'shape', 'all', 'guide', 'name'];

describe('which sheets may open', () => {
  it('all of them at rest, while playing and on a break', () => {
    for (const s of [snap({ phase: 'ready' }), snap({ phase: 'playing' }), snap({ phase: 'resting', inBreak: true, timerDone: true })]) {
      for (const n of ALL) expect(sheetAllowed(n, s), `${n} in ${s.phase}`).toBe(true);
    }
  });

  it('only Shape, Beat and Session (and their own) while winding down', () => {
    const s = snap({ phase: 'winding' });
    expect(ALL.filter((n) => sheetAllowed(n, s))).toEqual(['session', 'beat', 'custom', 'shape', 'all', 'name']);
  });

  it('none while resting after the timer, ending, or paused', () => {
    for (const s of [snap({ phase: 'resting', timerDone: true }), snap({ phase: 'ending' }), snap({ phase: 'resting', paused: true })]) {
      for (const n of ALL) expect(sheetAllowed(n, s)).toBe(false);
    }
  });
});

describe('the control that opened a sheet', () => {
  it('still stands for it in the sheet opened from it, so pressing it again closes', () => {
    expect(sheetIs('custom', 'beat')).toBe(true);
    expect(sheetIs('all', 'shape')).toBe(true);
    expect(sheetIs('beat', 'beat')).toBe(true);
    expect(sheetIs('beat', 'custom')).toBe(false);
    expect(sheetIs(null, 'beat')).toBe(false);
    expect(sheetIs('sound', 'shape')).toBe(false);
  });
});

describe('the feel pad, in words', () => {
  it('says "As made." at the center', () => {
    expect(feelWords(0.5, 0.5)).toBe('As made.');
    expect(feelWords(0.51, 0.49)).toBe('As made.');
  });

  it('names warmth first, then motion, with a little and much', () => {
    expect(feelWords(0.4, 0.5)).toBe('A little warmer.');
    expect(feelWords(0.75, 0.5)).toBe('Brighter.');
    expect(feelWords(1, 0.5)).toBe('Much brighter.');
    expect(feelWords(0.6, 0.75)).toBe('A little brighter, and wandering more.');
    expect(feelWords(0.2, 0.3)).toBe('Warmer, and stiller.');
    expect(feelWords(0.5, 0)).toBe('Much stiller.');
  });
});

describe('More like this', () => {
  const p = presetParams(BUILTIN_PRESETS[0]);

  it('never touches switches, choices, the beat, the macros or the root', () => {
    for (const id of PARAM_IDS) {
      const d = PARAMS[id];
      if (d.kind !== 'range' || d.group === 'beat' || d.group === 'macro' || id === 'root') expect(nudgeable(id), id).toBe(false);
    }
    const out = moreLikeThis(p, () => 1);
    for (const id of Object.keys(out) as ParamId[]) expect(nudgeable(id), id).toBe(true);
  });

  it('moves each setting by at most a tenth of its slider, and levels by half that', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let run = 0; run < 20; run++) {
      const out = moreLikeThis(p, rand);
      for (const [id, v] of Object.entries(out) as Array<[ParamId, number]>) {
        const reach = /Level$/.test(id) ? 0.05 : 0.1;
        // Stepping to the setting's own resolution can add a little.
        const step = PARAMS[id].step / (PARAMS[id].max - PARAMS[id].min);
        expect(Math.abs(toSlider(id, v) - toSlider(id, p[id])), id).toBeLessThanOrEqual(reach + step + 0.02);
      }
    }
  });

  it('leaves the registers and the number of voices alone', () => {
    for (const id of ['root', 'bellsRegister', 'voicesRegister', 'voicesDensity'] as ParamId[]) expect(nudgeable(id), id).toBe(false);
  });

  it('leaves anything turned all the way down where it is', () => {
    const quiet = { ...defaultParams(), rainLevel: 0, driftAmount: 0 };
    const out = moreLikeThis(quiet, () => 1);
    expect(out.rainLevel).toBeUndefined();
    expect(out.driftAmount).toBeUndefined();
  });
});

describe('layer lights', () => {
  it('every sound layer has a light, and a preset shows the layers playing in it', () => {
    for (const l of SOUND_LAYERS) expect(l.key).toMatch(/^(drone|breath|bells|voices|shimmer|noise|rain|ocean|wind|rise)$/);
    const keys = layersIn(presetParams(BUILTIN_PRESETS[0])).map((l) => l.key);
    expect(keys).toEqual(['drone', 'breath', 'bells']);
  });
});
