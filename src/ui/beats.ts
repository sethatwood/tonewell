// The beat choices people actually pick, named by what each is commonly
// used for. One source for the player's chip, the Beat sheet and the menu
// bar, so they always agree.
//
// "Commonly used for" is a convention, not a promise: the evidence that a
// beat changes your state is mixed (see Learn: The evidence, honestly).

import type { SoundParams } from '../audio/params';
import { bandName } from '../audio/tuning';
import type { Mode } from '../presets/builtin';
import { check, item, sep, type MenuNode } from './menu';

export interface BeatChoice {
  id: string;
  /** Menu label: the name, then the hertz. */
  label: string;
  /** The beat it settles on. */
  hz: number;
  /** For a glide: where it starts. */
  from?: number;
  use: 'meditate' | 'focus';
  /** A few words on what it's commonly used for. */
  purpose: string;
  /** Its name in the player, by purpose. */
  name: string;
  /** For the hint line: the beat in bold, then a few words. */
  hint: { b: string; t: string };
  /** The Beat sheet: the hertz beside the name, and one line about it. */
  meta: string;
  desc: string;
}

export const BEAT_CHOICES: readonly BeatChoice[] = [
  {
    id: 'settle', label: 'Settle, 10 → 6 Hz', hz: 6, from: 10, use: 'meditate', purpose: 'eases from alpha into theta', name: 'Settle',
    hint: { b: '10 → 6 Hz', t: 'over a few minutes.' }, meta: '10 → 6 Hz', desc: 'Eases from alert toward calm.',
  },
  {
    id: '6', label: 'Theta, 6 Hz', hz: 6, use: 'meditate', purpose: 'meditation', name: 'Theta',
    hint: { b: '6 Hz.', t: 'A steady theta beat.' }, meta: '6 Hz', desc: 'A steady, common choice for meditation.',
  },
  {
    id: '2', label: 'Deep rest, 2 Hz', hz: 2, use: 'meditate', purpose: 'deep rest; can make you drowsy', name: 'Deep rest',
    hint: { b: '2 Hz.', t: 'Can make you drowsy.' }, meta: 'Delta, 2 Hz', desc: 'For lying down. Can make you drowsy.',
  },
  {
    id: '10', label: 'Calm focus, 10 Hz', hz: 10, use: 'focus', purpose: 'calm, unhurried focus', name: 'Calm focus',
    hint: { b: '10 Hz.', t: 'Alpha, for unhurried work.' }, meta: 'Alpha, 10 Hz', desc: 'Unhurried work, reading, writing.',
  },
  {
    id: '15', label: 'Alert work, 15 Hz', hz: 15, use: 'focus', purpose: 'alert work', name: 'Alert work',
    hint: { b: '15 Hz.', t: 'Low beta, for brisk tasks.' }, meta: 'Low beta, 15 Hz', desc: 'Brisk tasks when you want to stay sharp.',
  },
];

const near = (a: number, b: number) => Math.abs(a - b) < 0.05;

export function fmtHz(v: number): string {
  return v < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
}

/** Which choice matches the current settings, if any. */
export function currentChoice(p: SoundParams): BeatChoice | null {
  if (!p.beatOn) return null;
  return (
    BEAT_CHOICES.find((c) =>
      c.from !== undefined ? !!p.rampOn && near(p.beatHz, c.hz) && near(p.rampFrom, c.from) : !p.rampOn && near(p.beatHz, c.hz),
    ) ?? null
  );
}

/** The chip's text: the setting, never a passing value mid-glide. */
export function beatShort(p: SoundParams): string {
  if (!p.beatOn) return 'Off';
  if (p.rampOn) return `${fmtHz(p.rampFrom)}→${fmtHz(p.beatHz)} Hz`;
  return `${fmtHz(p.beatHz)} Hz`;
}

/** The beat by purpose, as the player names it: "Settle", "Yours", "No beat". */
export function beatName(p: SoundParams): string {
  if (!p.beatOn) return 'No beat';
  return currentChoice(p)?.name ?? 'Yours';
}

/** The current beat for the hint line: the beat in bold, then a few words. The chip already shows its name. */
export function beatHint(p: SoundParams): { b: string; t: string } {
  if (!p.beatOn) return { b: 'No beat.', t: 'Click to choose one.' };
  const c = currentChoice(p);
  if (!c) return { b: p.rampOn ? `${fmtHz(p.rampFrom)} → ${fmtHz(p.beatHz)} Hz,` : `${fmtHz(p.beatHz)} Hz,`, t: 'set by hand.' };
  // A glide says how long it takes, which is a setting of its own.
  return c.from !== undefined ? { b: `${fmtHz(c.from)} → ${fmtHz(c.hz)} Hz`, t: `over ${p.rampMin} min.` } : c.hint;
}

/** A sentence describing the setting, for labels and screen readers. */
export function beatLong(p: SoundParams): string {
  if (!p.beatOn) return 'Beat off';
  const c = currentChoice(p);
  const what = p.rampOn ? `gliding from ${fmtHz(p.rampFrom)} to ${fmtHz(p.beatHz)} hertz` : `${fmtHz(p.beatHz)} hertz, ${bandName(p.beatHz)}`;
  return c ? `Beat ${what}, commonly used for ${c.purpose}` : `Beat ${what}`;
}

/** What each band is, and what people commonly use it for. */
export const BAND_USES: Record<string, string> = {
  delta: 'Delta is the slowest band, the rhythm that dominates deep sleep. People choose it for deep rest; it can make you drowsy.',
  theta: 'Theta is a common choice for meditation and settling down.',
  alpha: 'Alpha goes with relaxed, eyes-closed rest. It’s a common choice for calm, unhurried focus.',
  beta: 'Beta goes with ordinary alert wakefulness. Low beta is a common choice for alert work.',
  gamma: 'Above about 30 Hz a beat is hard to hear as a beat at all, and there’s little evidence either way.',
};

/** The beat menu, grouped by purpose, with the current mode's group first: the Beat sheet's list, in its words. */
export function beatMenuNodes(p: SoundParams, mode: Mode): MenuNode[] {
  const current = currentChoice(p);
  const group = (use: 'meditate' | 'focus') => [
    item(`beat:header-${use}`, use === 'meditate' ? 'For meditation' : 'For focus', false),
    ...BEAT_CHOICES.filter((c) => c.use === use).map((c) => check(`beat:${c.id}`, c.label, current === c)),
  ];
  const nodes: MenuNode[] = [];
  const order: Array<'meditate' | 'focus'> = mode === 'focus' ? ['focus', 'meditate'] : ['meditate', 'focus'];
  nodes.push(...group(order[0]), ...group(order[1]));
  // Something set by hand: show it, checked, so the menu always says what's playing.
  if (p.beatOn && !current) nodes.push(check('beat:custom', `Yours, ${beatShort(p)}`, true, false));
  nodes.push(sep, check('beat:off', 'No beat', !p.beatOn), sep, item('beat:learn', 'What these mean, honestly'), item('beat:more', 'Custom beat…'));
  return nodes;
}

/** The settings a choice stands for. */
export function choiceParams(c: BeatChoice): Partial<SoundParams> {
  return c.from !== undefined ? { beatOn: 1, rampOn: 1, rampFrom: c.from, beatHz: c.hz } : { beatOn: 1, rampOn: 0, beatHz: c.hz };
}
