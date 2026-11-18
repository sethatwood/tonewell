import { describe, expect, it } from 'vitest';
import { Session, type Notice, type Snapshot } from '../../src/session/session';
import { description, restMessage, soundMenu } from '../../src/ui/player';
import { BEAT_CHOICES, beatHint, beatName, choiceParams } from '../../src/ui/beats';
import { BUILTIN_PRESETS } from '../../src/presets/builtin';
import { defaultParams } from '../../src/audio/params';

const session = new Session();
const base = session.snapshot();
const snap = (patch: Partial<Snapshot>, prefs: Partial<Snapshot['prefs']> = {}): Snapshot => ({ ...base, ...patch, prefs: { ...base.prefs, ...prefs } });
const at = new Date(2026, 10, 17, 14, 17);

describe('the hint line', () => {
  it('gives the first-run advice until the first session, then the sound’s own line', () => {
    expect(description(snap({ phase: 'ready' }), true)).toBe('Headphones on, then start.');
    expect(description(snap({ phase: 'ready' }), false)).toBe('Wandering drone, breath, slow bells.');
  });

  it('says when a sit ends, and what follows', () => {
    const playing = { phase: 'playing' as const, mode: 'meditate' as const, endsAt: at, remaining: 600 };
    expect(description(snap(playing, { restMinutes: 2, endBell: true }), false)).toMatch(/^Ends .+, then a bell and a rest\.$/);
    expect(description(snap(playing, { restMinutes: 0, endBell: true }), false)).toMatch(/^Ends .+, then a bell\.$/);
    expect(description(snap(playing, { keepPlaying: true, endBell: true }), false)).toMatch(/^Bell at .+, then it carries on\.$/);
    expect(description(snap({ ...playing, mode: 'focus' }), false)).toMatch(/^Ends [^,]+\.$/);
    expect(description(snap({ phase: 'playing', startedAt: at, endsAt: null, remaining: null }), false)).toMatch(/^Since .+\. Open-ended\.$/);
    expect(description(snap({ phase: 'playing', startedAt: at, endsAt: at, remaining: 600 }, { minutes: 50, breakMinutes: 10 }), false)).toMatch(/^Since .+\. 50 on, 10 off\.$/);
  });

  it('explains a binaural beat on speakers', () => {
    const p = { ...defaultParams(), beatOn: 1, beatMode: 0 };
    expect(description(snap({ phase: 'playing', params: p, output: { name: 'Speakers', kind: 'speakers' }, endsAt: at, remaining: 600 }), false)).toBe(
      'On speakers, so the beat plays as monaural.',
    );
  });

  it('gives every built-in sound a line short enough for the player', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.short, p.name).toBeTruthy();
      expect(p.short!.length, p.name).toBeLessThanOrEqual(38);
    }
  });
});

describe('rest messages', () => {
  it('says where the sound is going, and what happens next', () => {
    expect(restMessage(snap({ phase: 'winding' }, { landTo: 'hum' }))).toBe('Settling into a low hum…');
    expect(restMessage(snap({ phase: 'winding' }, { landTo: 'silence' }))).toBe('Settling into silence…');
    expect(restMessage(snap({ phase: 'resting' }, { landTo: 'hum' }))).toBe('A low hum, nothing else. Stay as long as you like.');
    expect(restMessage(snap({ phase: 'resting', timerDone: true }))).toBe('The sit is over. Rest here; it fades out on its own.');
    expect(restMessage(snap({ phase: 'resting', inBreak: true }))).toBe('A break. The next block starts by itself.');
    expect(restMessage(snap({ phase: 'ending' }))).toBe('Fading to silence.');
    expect(restMessage(snap({ phase: 'playing' }))).toBeNull();
  });

  it('a break winds to the hum even when the mode winds down to silence', () => {
    expect(restMessage(snap({ phase: 'winding', inBreak: true }, { landTo: 'silence' }))).toBe('Settling into a low hum…');
  });
});

describe('the beat chip', () => {
  it('names each choice by purpose, with a hint that leads with the beat', () => {
    for (const c of BEAT_CHOICES) {
      const p = { ...defaultParams(), ...choiceParams(c) };
      expect(beatName(p)).toBe(c.name);
      expect(beatHint(p).b).toMatch(/Hz/);
    }
    expect(beatName({ ...defaultParams(), beatOn: 0 })).toBe('No beat');
    expect(beatName({ ...defaultParams(), beatOn: 1, rampOn: 0, beatHz: 7.5 })).toBe('Yours');
    expect(beatHint({ ...defaultParams(), beatOn: 1, rampOn: 0, beatHz: 7.5 })).toEqual({ b: '7.5 Hz,', t: 'set by hand.' });
  });

  it('the sound menu offers both modes and only known actions', () => {
    const ids = soundMenu(session, base).flatMap((n) => (n.kind === 'check' || n.kind === 'item' ? [n.id] : []));
    expect(ids.slice(0, 2)).toEqual(['mode:meditate', 'mode:focus']);
    for (const id of ids) expect(id).toMatch(/^(mode:(meditate|focus)|preset:.+|preset-.+)$/);
  });
});

describe('notices', () => {
  const muted: Notice = { kind: 'muted', text: 'Your Mac’s sound is muted.' };
  const softer: Notice = { kind: 'softer', text: 'A microphone is in use, so the sound is softer.', ttl: 6 };
  const unplugged: Notice = { kind: 'unplugged', text: 'Headphones out, paused.' };

  it('a lower notice waits behind a higher one, and is dropped if it no longer applies', () => {
    const s = new Session();
    s.setNotice(muted);
    s.setNotice(softer);
    expect(s.notice?.kind).toBe('muted');
    // Nothing is softened (no call), so the waiting notice no longer applies.
    s.setNotice(null);
    expect(s.notice).toBeNull();
  });

  it('a higher notice takes the place of a lower one', () => {
    const s = new Session();
    s.setNotice(softer);
    s.setNotice(unplugged);
    expect(s.notice?.kind).toBe('unplugged');
    s.setNotice(null);
  });

  it('a notice replaced by a higher one waits behind it, if it still applies', () => {
    const s = new Session();
    s.onOutputChange({ change: 'muted', previous: null, current: null });
    s.setNotice(muted);
    s.setNotice({ kind: 'slept', text: 'Stopped while your Mac slept.' });
    expect(s.notice?.kind).toBe('slept');
    s.setNotice(null);
    expect(s.notice?.kind).toBe('muted');
    // Unmuting clears it, and nothing comes back.
    s.onOutputChange({ change: 'unmuted', previous: null, current: null });
    expect(s.notice).toBeNull();
  });

  it('a waiting notice that still applies shows when the higher one clears', () => {
    const s = new Session();
    s.setNotice(unplugged);
    s.setNotice({ kind: 'output', text: 'Now through Speakers.', ttl: 4 });
    expect(s.notice?.kind).toBe('unplugged');
    s.setNotice(null);
    expect(s.notice?.kind).toBe('output');
    expect(s.notice?.ttl).toBeLessThanOrEqual(4);
    s.setNotice(null);
    expect(s.notice).toBeNull();
  });
});
