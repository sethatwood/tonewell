import { describe, expect, it } from 'vitest';
import { BAND_EDGES, PARAMS, PARAM_IDS, defaultParams, fromSlider, mergeParams, toSlider, type ParamId } from '../../src/audio/params';
import { driftOffset, shapeParams, tunedCarrier } from '../../src/audio/shape';
import { evalPlan, joinPlans } from '../../src/audio/layers/beat';
import { BUILTIN_PRESETS, presetParams } from '../../src/presets/builtin';
import { bandName, intervalRatio, midiToHz, noteName } from '../../src/audio/tuning';

describe('params', () => {
  it('maps every parameter to a slider and back within one step', () => {
    for (const id of PARAM_IDS) {
      const d = PARAMS[id as ParamId];
      if (d.kind !== 'range') continue;
      for (const v of [d.min, d.def, d.max]) {
        const back = fromSlider(id, toSlider(id, v));
        expect(Math.abs(back - v)).toBeLessThanOrEqual(d.step + 1e-9);
      }
    }
  });

  it('gives each brainwave band an equal share of the beat slider', () => {
    for (let i = 0; i < BAND_EDGES.length - 1; i++) {
      expect(toSlider('beatHz', BAND_EDGES[i])).toBeCloseTo(i / 5, 6);
    }
    expect(bandName(toSlider('beatHz', 6) * 0 + 6)).toBe('theta');
    expect(toSlider('beatHz', 6)).toBeGreaterThan(0.2);
    expect(toSlider('beatHz', 6)).toBeLessThan(0.4);
  });

  it('drops unknown keys and clamps values when merging', () => {
    const p = mergeParams(defaultParams(), { cutoff: 99999, bogus: 3, voicing: 2.7 } as Record<string, number>);
    expect(p.cutoff).toBe(PARAMS.cutoff.max);
    expect(p.voicing).toBe(3);
    expect('bogus' in p).toBe(false);
  });
});

describe('tuning', () => {
  it('names notes and finds frequencies', () => {
    expect(noteName(33)).toBe('A1');
    expect(midiToHz(33)).toBeCloseTo(55, 6);
    expect(midiToHz(33, 432)).toBeCloseTo(54, 6);
  });

  it('uses pure ratios in just tuning', () => {
    expect(intervalRatio(7, true)).toBeCloseTo(1.5, 9);
    expect(intervalRatio(-5, true)).toBeCloseTo(0.75, 9);
    expect(intervalRatio(12, false)).toBeCloseTo(2, 9);
  });

  it('tunes the beat carrier to a drone harmonic between 100 and 200 Hz', () => {
    for (let root = 26; root <= 45; root++) {
      const c = tunedCarrier({ ...defaultParams(), root });
      expect(c).toBeGreaterThanOrEqual(100);
      expect(c).toBeLessThan(200.0001);
    }
    expect(tunedCarrier(defaultParams())).toBeCloseTo(110, 6);
  });
});

describe('shaping', () => {
  const base = { ...defaultParams(), driftAmount: 0 };

  it('leaves the preset as designed when both macros sit in the middle', () => {
    const e = shapeParams(base, { t: 100, seed: 1, landing: false });
    for (const id of ['cutoff', 'reverbMix', 'bellsDensity', 'walkEvery', 'sweepDepth', 'noiseTone'] as ParamId[]) {
      expect(e[id]).toBeCloseTo(base[id], 6);
    }
  });

  it('warmth darkens and brightens the filter by up to an octave', () => {
    const warm = shapeParams({ ...base, warmth: 0 }, { t: 0, seed: 1, landing: false });
    const bright = shapeParams({ ...base, warmth: 1 }, { t: 0, seed: 1, landing: false });
    expect(warm.cutoff).toBeCloseTo(base.cutoff / 2, 6);
    expect(bright.cutoff).toBeCloseTo(base.cutoff * 2, 6);
  });

  it('the Drift macro stills or livens the sound', () => {
    const still = shapeParams({ ...base, driftAmount: 0.3, motion: 0 }, { t: 0, seed: 1, landing: false });
    const wander = shapeParams({ ...base, driftAmount: 0.3, motion: 1 }, { t: 0, seed: 1, landing: false });
    expect(still.driftAmount).toBe(0);
    expect(wander.driftAmount).toBeGreaterThan(0.3);
    expect(still.walkEvery).toBeGreaterThan(base.walkEvery);
    expect(wander.bellsDensity).toBeGreaterThan(base.bellsDensity);
  });

  it('soft landing silences bells and beat and closes the filter', () => {
    const e = shapeParams(defaultParams(), { t: 0, seed: 1, landing: true });
    expect(e.bellsOn).toBe(0);
    expect(e.beatOn).toBe(0);
    expect(e.walkOn).toBe(0);
    expect(e.cutoff).toBeLessThanOrEqual(190);
  });

  it('drift stays within [-1, 1] and moves slowly', () => {
    let prev = driftOffset('cutoff', 0, 1, 7);
    for (let t = 1; t < 3600; t += 1) {
      const v = driftOffset('cutoff', t, 1, 7);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
  });
});

describe('beat plans', () => {
  it('interpolates and holds at the ends', () => {
    const plan: Array<[number, number]> = [[0, 10], [10, 6]];
    expect(evalPlan(plan, -5)).toBe(10);
    expect(evalPlan(plan, 5)).toBe(8);
    expect(evalPlan(plan, 50)).toBe(6);
  });

  it('joins a new plan without a jump', () => {
    const cur: Array<[number, number]> = [[0, 10], [100, 6]];
    const next: Array<[number, number]> = [[0, 4]];
    const joined = joinPlans(cur, next, 50, 2);
    expect(evalPlan(joined, 50)).toBeCloseTo(8, 9);
    expect(evalPlan(joined, 52)).toBeCloseTo(4, 9);
  });

  it('starts directly on a new plan with no blend', () => {
    const joined = joinPlans([[0, 6]], [[0, 10], [20, 6]], 0, 0);
    expect(evalPlan(joined, 0)).toBe(10);
    expect(evalPlan(joined, 10)).toBe(8);
  });
});

describe('presets', () => {
  it('every built-in preset is valid and named', () => {
    const ids = new Set<string>();
    for (const p of BUILTIN_PRESETS) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      for (const k of Object.keys(p.params)) expect(k in PARAMS).toBe(true);
      const full = presetParams(p);
      for (const id of PARAM_IDS) expect(Number.isFinite(full[id])).toBe(true);
    }
  });

  it('Focus presets have no bells and no wander unless they ask', () => {
    for (const p of BUILTIN_PRESETS.filter((x) => x.mode === 'focus')) {
      const full = presetParams(p);
      expect(full.bellsOn).toBe(0);
      expect(full.walkOn).toBe(0);
    }
  });

  it('Deep Theta keeps the original prototype sound', () => {
    const p = presetParams(BUILTIN_PRESETS.find((x) => x.id === 'deep-theta')!);
    expect(p.root).toBe(33);
    expect(p.cutoff).toBe(420);
    expect(p.resonance).toBe(5);
    expect(p.beatHz).toBe(6);
    expect(p.echoTime).toBe(0.48);
  });
});
