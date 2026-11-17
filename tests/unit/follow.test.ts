import { describe, expect, it } from 'vitest';
import { SoundFollower, STILL, type Heard } from '../../src/visuals/follow';
import { approach } from '../../src/visuals/renderer';

const DT = 0.05;
/** Levels for -100..0 dB on a 0..1 scale, as WebAudioEngine.bedLevels gives them. */
const db = (v: number): number => (v + 100) / 100;
const bed = (low: number, high: number, rms: number, rootHz = 110): Heard => ({ low: db(low), high: db(high), rms: db(rms), rootHz });

function run(f: SoundFollower, seconds: number, heard: Heard | null) {
  let out = STILL;
  for (let t = 0; t < seconds; t += DT) out = f.update(DT, heard);
  return out;
}

describe('sound follower', () => {
  it('stays still while the sound holds steady', () => {
    const f = new SoundFollower();
    const out = run(f, 30, bed(-30, -60, -20));
    expect(Math.abs(out.swell)).toBeLessThan(0.01);
    expect(out.bloom).toBeLessThan(0.01);
    expect(Math.abs(out.drive)).toBeLessThan(0.01);
    expect(out.hue).toBe(0);
  });

  it('blooms when the high end rises, then settles as that becomes the new normal', () => {
    const f = new SoundFollower();
    run(f, 30, bed(-30, -60, -20));
    const bell = run(f, 1, bed(-30, -48, -20));
    expect(bell.bloom).toBeGreaterThan(0.5);
    const later = run(f, 60, bed(-30, -48, -20));
    expect(later.bloom).toBeLessThan(0.05);
  });

  it('never blooms below zero when the high end falls', () => {
    const f = new SoundFollower();
    run(f, 30, bed(-30, -40, -20));
    expect(run(f, 2, bed(-30, -70, -20)).bloom).toBe(0);
  });

  it('eases the picture when the low end drops', () => {
    const f = new SoundFollower();
    run(f, 30, bed(-30, -60, -20));
    expect(run(f, 2, bed(-36, -60, -20)).swell).toBeLessThan(-0.5);
  });

  it('shifts color with a new note, then lets it settle', () => {
    const f = new SoundFollower();
    run(f, 30, bed(-30, -60, -20, 110));
    // Down a major third, as in the drone's Wander walk.
    const step = run(f, 1, bed(-30, -60, -20, 110 * 2 ** (-4 / 12)));
    expect(step.hue).toBeLessThan(-0.2);
    expect(step.hue).toBeGreaterThanOrEqual(-0.5);
    const settled = run(f, 240, bed(-30, -60, -20, 110 * 2 ** (-4 / 12)));
    expect(Math.abs(settled.hue)).toBeLessThan(0.01);
  });

  it('goes still in silence and starts afresh after a gap', () => {
    const f = new SoundFollower();
    run(f, 30, bed(-30, -60, -20));
    expect(f.update(DT, null)).toEqual(STILL);
    run(f, 5, null);
    // A much louder bed after the gap is the new normal, not a swell.
    expect(Math.abs(f.update(DT, bed(-10, -30, -5)).swell)).toBeLessThan(0.01);
  });

  it('treats silence and a suspended context as nothing heard, so resuming is not a swell', () => {
    const f = new SoundFollower();
    run(f, 30, bed(-30, -60, -20));
    // A suspended context reports zeros: that is not a 50 dB drop.
    expect(run(f, 5, { rms: 0, low: 0, high: 0, rootHz: 110 })).toEqual(STILL);
    let peak = 0;
    for (let t = 0; t < 30; t += DT) {
      const out = f.update(DT, bed(-30, -60, -20));
      peak = Math.max(peak, Math.abs(out.swell), out.bloom, Math.abs(out.drive));
    }
    expect(peak).toBeLessThan(0.01);
  });

  it('eases in at the start while the bed fills in, instead of pinning at full', () => {
    const f = new SoundFollower();
    // The first frames of a session read as silence, then the bed rises 10 dB over five seconds as reverb fills in.
    run(f, 0.1, { rms: 0, low: 0, high: 0 });
    let peak = 0;
    let strong = 0;
    let late = 0;
    for (let t = 0; t < 30; t += DT) {
      const lift = Math.min(10, t * 2);
      const out = f.update(DT, bed(-40 + lift, -70 + lift, -30 + lift));
      const m = Math.max(Math.abs(out.swell), out.bloom, Math.abs(out.drive));
      peak = Math.max(peak, m);
      if (m > 0.5) strong += DT;
      if (t > 25) late = Math.max(late, m);
    }
    // A real rise shows, briefly; it never sits at full while the averages catch up.
    expect(peak).toBeLessThan(0.75);
    expect(strong).toBeLessThan(6);
    expect(late).toBeLessThan(0.15);
  });

  it('ignores bad numbers instead of passing them on', () => {
    const f = new SoundFollower();
    run(f, 30, bed(-30, -60, -20));
    expect(f.update(DT, { rms: Number.NaN, low: 0.7, high: 0.4 })).toEqual(STILL);
    for (const rootHz of [0, Number.NaN, -5, undefined]) {
      const out = f.update(DT, { ...bed(-30, -60, -20), rootHz });
      expect(out.hue).toBe(0);
      expect(Object.values(out).every(Number.isFinite)).toBe(true);
    }
    expect(Object.values(f.update(Number.NaN, bed(-30, -60, -20))).every(Number.isFinite)).toBe(true);
  });

  it('keeps every output in range however extreme the input', () => {
    for (const [from, to] of [
      [bed(-80, -84, -80, 30), bed(0, 0, 0, 4000)],
      [bed(0, 0, 0, 4000), bed(-84, -84, -84, 30)],
    ]) {
      const f = new SoundFollower();
      run(f, 20, from);
      for (let t = 0; t < 3; t += DT) {
        const out = f.update(DT, to);
        expect(out.swell).toBeGreaterThanOrEqual(-1);
        expect(out.swell).toBeLessThanOrEqual(1);
        expect(out.bloom).toBeGreaterThanOrEqual(0);
        expect(out.bloom).toBeLessThanOrEqual(1);
        expect(out.drive).toBeGreaterThanOrEqual(-1);
        expect(out.drive).toBeLessThanOrEqual(1);
        expect(Math.abs(out.hue)).toBeLessThanOrEqual(0.5);
      }
    }
  });
});

describe('renderer limits', () => {
  it('never moves a value faster than its rate cap, whatever the target', () => {
    let v = 0;
    for (let i = 0; i < 20; i++) {
      const next = approach(v, 1, 0.05, 1, 0.5);
      expect(next - v).toBeLessThanOrEqual(0.5 * 0.05 + 1e-12);
      v = next;
    }
    expect(v).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('holds still on a bad number instead of carrying it forever', () => {
    expect(approach(0.4, Number.NaN, 0.05, 1, 0.5)).toBe(0.4);
    expect(approach(Number.NaN, 1, 0.05, 1, 0.5)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(approach(Number.NaN, Number.NaN, 0.05, 1, 0.5))).toBe(true);
  });
});
