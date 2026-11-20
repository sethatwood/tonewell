// The Session sheet, from the length chip: how long, and how a sit begins
// and ends. Each mode keeps its own; Focus adds work cycles.

import type { Snapshot } from '../../session/session';
import { h } from '../controls';
import { check } from '../menu';
import type { Sheet, SheetEnv } from './host';
import { menuRow, segmented, sheetHead, switchRow, type Part } from './parts';
import { isPhone } from '../../platform/os';

const LENGTHS = [10, 15, 20, 30, 45, 60, 90, 0];
const CYCLES: Array<{ id: string; label: string; minutes: number; rest: number }> = [
  { id: 'off', label: 'Off', minutes: 0, rest: 0 },
  { id: '25', label: '25 + 5', minutes: 25, rest: 5 },
  { id: '50', label: '50 + 10', minutes: 50, rest: 10 },
  { id: '90', label: '90 + 15', minutes: 90, rest: 15 },
];
const RESTS = [0, 1, 2, 3, 5];
const FADES = [5, 10, 15, 20, 30];

export function sessionSheet(env: SheetEnv): Sheet {
  const { session } = env;
  const prefs = () => session.prefs;

  const length = segmented<number>('How long, in minutes', LENGTHS.map((m) => ({ value: m, label: m ? String(m) : 'Open' })), (m) => session.setLength(m || null), 4);
  length.inputs.forEach((input, i) => {
    const m = LENGTHS[i];
    env.hints.add(input, () => (m ? [{ b: `${m} minutes.` }, { k: '+' }, { k: '−' }, { t: 'change it by 5.' }] : [{ b: 'Open-ended.' }, { t: 'It plays until you wind it down.' }]));
  });
  const helper = h('p', { class: 'sheet__help' });

  const cycles = menuRow(
    env,
    'Cycles',
    'Work blocks with a short break between. A soft bell marks each edge.',
    (s) => (s.prefs.breakMinutes > 0 ? `${s.prefs.minutes ?? 25} + ${s.prefs.breakMinutes}` : 'Off'),
    () => CYCLES.map((c) => check(c.id, c.label, c.id === 'off' ? prefs().breakMinutes === 0 : prefs().breakMinutes === c.rest && prefs().minutes === c.minutes)),
    (id) => {
      const c = CYCLES.find((x) => x.id === id);
      if (!c) return;
      if (c.id === 'off') session.setPrefs({ breakMinutes: 0 });
      else session.setPrefs({ minutes: c.minutes, breakMinutes: c.rest });
    },
  );
  const rows: Part[] = [
    switchRow(env, 'Keep playing after the timer', (s) => s.prefs.keepPlaying, (on) => session.setPrefs({ keepPlaying: on }), { help: 'The bell rings, the sound carries on.' }),
    menuRow(
      env,
      'Rest after the timer',
      'Stay in the hum before the fade.',
      (s) => (s.prefs.restMinutes ? `${s.prefs.restMinutes} min` : 'None'),
      () => RESTS.map((m) => check(String(m), m ? `${m} min` : 'None', prefs().restMinutes === m)),
      (id) => session.setPrefs({ restMinutes: Number(id) }),
    ),
    menuRow(
      env,
      'Wind down to',
      null,
      (s) => (s.prefs.landTo === 'silence' ? 'Silence' : 'A low hum'),
      () => [check('hum', 'A low hum', prefs().landTo === 'hum'), check('silence', 'Silence', prefs().landTo === 'silence')],
      (id) => session.setPrefs({ landTo: id === 'silence' ? 'silence' : 'hum' }),
    ),
    menuRow(
      env,
      'Fade in',
      null,
      (s) => `${s.prefs.fadeIn} s`,
      () => FADES.map((v) => check(String(v), `${v} seconds`, prefs().fadeIn === v)),
      (id) => session.setPrefs({ fadeIn: Number(id) }),
    ),
    switchRow(env, 'Bell at the end', (s) => s.prefs.endBell, (on) => session.setPrefs({ endBell: on }), { hint: () => [{ b: 'Bell at the end.' }, { t: 'One soft bell when the timer ends.' }] }),
    switchRow(env, 'Bell at the start', (s) => s.prefs.startBell, (on) => session.setPrefs({ startBell: on }), { hint: () => [{ b: 'Bell at the start.' }, { t: 'One soft bell as the sound begins.' }] }),
    switchRow(env, 'Keep the screen awake', (s) => s.prefs.keepScreenAwake, (on) => session.setPrefs({ keepScreenAwake: on }), {
      hint: () => [{ b: 'Keep the screen awake.' }, { t: 'While a session runs, the display stays on.' }],
    }),
  ];
  const el = h('div', {}, sheetHead('How long?'), length.el, helper, h('div', { class: 'rows' }, cycles.el, ...rows.map((r) => r.el)));

  return {
    el,
    label: 'Session',
    rest: () => {
      const s = session.snapshot();
      return s.mode === 'focus' ? [{ t: 'These belong to Focus.' }] : [{ t: 'These belong to Meditate. Focus keeps its own, plus cycles.' }];
    },
    initialFocus: () => length.inputs.find((i) => i.checked) ?? length.inputs[0],
    render(s: Snapshot) {
      const m = s.prefs.minutes;
      const listed = LENGTHS.includes(m ?? 0);
      length.set(listed ? (m ?? 0) : null);
      // A phone has no + and − keys.
      const keysNote = isPhone ? '' : ' + and − change it by 5 from anywhere in the player.';
      helper.textContent = listed ? `Minutes.${keysNote}` : `Now ${m} minutes.${keysNote}`;
      cycles.el.hidden = s.mode !== 'focus';
      cycles.refresh(s);
      for (const r of rows) r.refresh(s);
    },
  };
}
