// The beat choices people actually pick, labeled by what each is commonly
// used for. One source for the mini player's chip, its pop-up menu, the menu
// bar and the Beat panel, so they always agree.
//
// "Commonly used for" is a convention, not a promise: the evidence that a
// beat changes your state is mixed (see Learn: The evidence, honestly).

import type { SoundParams } from '../audio/params';
import { bandName } from '../audio/tuning';
import type { Mode } from '../presets/builtin';
import { check, item, sep, type MenuNode } from './menu';

export interface BeatChoice {
  id: string;
  /** Menu label. */
  label: string;
  /** The beat it settles on. */
  hz: number;
  /** For a glide: where it starts. */
  from?: number;
  use: 'meditate' | 'focus';
  /** A few words on what it's commonly used for. */
  purpose: string;
}

export const BEAT_CHOICES: readonly BeatChoice[] = [
  { id: '6', label: 'Theta, 6 Hz', hz: 6, use: 'meditate', purpose: 'meditation' },
  { id: 'settle', label: 'Settle, 10 to 6 Hz', hz: 6, from: 10, use: 'meditate', purpose: 'eases from alpha into theta' },
  { id: '2', label: 'Delta, 2 Hz', hz: 2, use: 'meditate', purpose: 'deep rest; can make you drowsy' },
  { id: '10', label: 'Alpha, 10 Hz', hz: 10, use: 'focus', purpose: 'calm, unhurried focus' },
  { id: '15', label: 'Low beta, 15 Hz', hz: 15, use: 'focus', purpose: 'alert work' },
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

/** The beat menu, grouped by purpose, with the current mode's group first. */
export function beatMenuNodes(p: SoundParams, mode: Mode): MenuNode[] {
  const current = currentChoice(p);
  const group = (use: 'meditate' | 'focus') => [
    item(`beat:header-${use}`, use === 'meditate' ? 'For meditation' : 'For focus', false),
    ...BEAT_CHOICES.filter((c) => c.use === use).map((c) => check(`beat:${c.id}`, `${c.label}: ${c.purpose}`, current === c)),
  ];
  const nodes: MenuNode[] = [check('beat:off', 'Off', !p.beatOn), sep];
  const order: Array<'meditate' | 'focus'> = mode === 'focus' ? ['focus', 'meditate'] : ['meditate', 'focus'];
  nodes.push(...group(order[0]), sep, ...group(order[1]));
  // Something set by hand in the panel: show it, checked, so the menu always says what's playing.
  if (p.beatOn && !current) nodes.push(sep, check('beat:custom', `Yours: ${beatShort(p)}`, true, false));
  nodes.push(sep, item('beat:learn', 'What these mean, honestly'), item('beat:more', 'More beat settings…'));
  return nodes;
}

/** The settings a choice stands for. */
export function choiceParams(c: BeatChoice): Partial<SoundParams> {
  return c.from !== undefined ? { beatOn: 1, rampOn: 1, rampFrom: c.from, beatHz: c.hz } : { beatOn: 1, rampOn: 0, beatHz: c.hz };
}
