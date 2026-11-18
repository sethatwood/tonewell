// The Beat sheet: purpose first, hertz second. The current mode's group comes
// first. "Yours" appears only when a beat was set by hand in Custom beat.

import type { Snapshot } from '../../session/session';
import { keys } from '../../platform/os';
import { BEAT_CHOICES, choiceParams, currentChoice, fmtHz, type BeatChoice } from '../beats';
import { h, nextId } from '../controls';
import type { Hint } from '../hint';
import { uiIcon } from '../icons';
import { curveSvg, drawCurve } from './curve';
import type { Sheet, SheetEnv } from './host';
import { learnLink, sheetHead } from './parts';

const GLIDE_WORDS: Record<string, Hint> = {
  settle: [{ b: 'Settle' }, { t: 'starts at 10 Hz (alpha) and glides to 6 Hz (theta).' }],
};

export function beatSheet(env: SheetEnv): Sheet {
  const { session } = env;
  const group = nextId('beat');
  const outputIcon = h('span', { class: 'output-line__icon', 'aria-hidden': 'true' });
  const outputText = h('span');
  const output = h('p', { class: 'output-line' }, outputIcon, outputText);

  interface Row {
    id: string;
    el: HTMLLabelElement;
    input: HTMLInputElement;
    meta: HTMLSpanElement;
    desc: HTMLSpanElement;
    curve?: SVGSVGElement;
  }
  const rows = new Map<string, Row>();
  const row = (id: string, name: string, meta: string, desc: string, pick: () => void, hint: () => Hint): Row => {
    const input = h('input', { type: 'radio', name: group, value: id });
    const metaEl = h('span', { class: 'choice__meta' }, meta);
    const descEl = h('span', { class: 'choice__desc' }, desc);
    const body = h('span', { class: 'choice__body' }, h('span', { class: 'choice__top' }, h('span', { class: 'choice__name' }, name), metaEl), descEl);
    const el = h('label', { class: 'choice' }, input, body);
    input.addEventListener('change', () => {
      if (input.checked) pick();
    });
    env.hints.add(input, hint);
    const r: Row = { id, el, input, meta: metaEl, desc: descEl };
    if (id === 'settle') {
      r.curve = curveSvg();
      body.append(r.curve);
    }
    rows.set(id, r);
    return r;
  };
  const choiceRow = (c: BeatChoice) =>
    row(c.id, c.name, c.meta, c.desc, () => session.setParams(choiceParams(c)), () => GLIDE_WORDS[c.id] ?? [{ b: `${c.name}.` }, { t: c.desc }]);

  const groups = {
    meditate: h('div', { class: 'choices', role: 'group', 'aria-label': 'For meditation' }, h('div', { class: 'group-label' }, 'For meditation'), ...BEAT_CHOICES.filter((c) => c.use === 'meditate').map((c) => choiceRow(c).el)),
    focus: h('div', { class: 'choices', role: 'group', 'aria-label': 'For focus' }, h('div', { class: 'group-label' }, 'For focus'), ...BEAT_CHOICES.filter((c) => c.use === 'focus').map((c) => choiceRow(c).el)),
  };
  const yours = row('yours', 'Yours', '', 'Set by hand in Custom.', () => undefined, () => [{ b: 'Yours.' }, { t: 'Set by hand in Custom beat.' }]);
  const off = row('off', 'No beat', '', 'Just the sound.', () => session.setParam('beatOn', 0), () => [{ b: 'No beat.' }, { t: 'Just the sound.' }, { k: keys('⌘B') }, { t: 'brings it back.' }]);
  const other = h('div', { class: 'choices', role: 'group', 'aria-label': 'Other' }, h('div', { class: 'group-label' }, 'Other'), yours.el, off.el);
  const list = h('div', { class: 'choice-groups', role: 'radiogroup', 'aria-label': 'What is the beat for?' });

  const honest = h('div', { class: 'honest' }, 'These are common uses, not proven effects. ', learnLink(env, 'The evidence, honestly', 'evidence'));
  const custom = h('button', { class: 'btn btn--lg btn--block', type: 'button' }, 'Custom: frequency, glide, type');
  custom.addEventListener('click', () => env.open('custom'));
  env.hints.add(custom, () => [{ b: 'Custom beat.' }, { t: 'Every setting: the frequency, a glide, the type and the level.' }]);

  const el = h('div', {}, sheetHead('What is the beat for?'), output, list, honest, custom);
  let orderKey = '';

  return {
    el,
    label: 'Beat',
    rest: () => {
      const c = currentChoice(session.params);
      const lead: Hint = !session.params.beatOn ? [{ b: 'No beat.' }] : c ? (GLIDE_WORDS[c.id] ?? [{ b: `${c.name}:` }, { t: c.desc }]) : [{ b: 'Yours:' }, { t: 'set by hand.' }];
      return [...lead, { k: keys('⌘B') }, { t: 'off and on.' }];
    },
    initialFocus: () => list.querySelector<HTMLInputElement>('input:checked'),
    render(s: Snapshot) {
      const key = s.mode;
      if (key !== orderKey) {
        orderKey = key;
        list.replaceChildren(...(s.mode === 'focus' ? [groups.focus, groups.meditate] : [groups.meditate, groups.focus]), other);
      }
      const speakers = s.output?.kind === 'speakers';
      const icon = speakers ? 'speaker' : 'headphones';
      if (outputIcon.dataset.icon !== icon) {
        outputIcon.dataset.icon = icon;
        outputIcon.replaceChildren(uiIcon(icon));
      }
      outputText.textContent = speakers ? 'On speakers, so beats play as monaural.' : s.output?.kind === 'headphones' ? 'On headphones, so beats play binaurally.' : 'Binaural beats need headphones.';
      const c = currentChoice(s.params);
      const id = !s.params.beatOn ? 'off' : c ? c.id : 'yours';
      yours.el.hidden = id !== 'yours';
      if (id === 'yours') yours.meta.textContent = s.params.rampOn ? `${fmtHz(s.params.rampFrom)} → ${fmtHz(s.params.beatHz)} Hz` : `${fmtHz(s.params.beatHz)} Hz`;
      for (const r of rows.values()) r.input.checked = r.id === id;
      const settle = rows.get('settle')!;
      if (settle.curve) {
        settle.curve.style.display = id === 'settle' ? '' : 'none';
        if (id === 'settle') drawCurve(settle.curve, s.params, s.prefs.minutes);
      }
      // The glide takes as long as Custom beat's "Over" says (choosing Settle keeps it).
      settle.desc.textContent = `Eases from alert toward calm over ${s.params.rampMin} minutes.`;
    },
  };
}
