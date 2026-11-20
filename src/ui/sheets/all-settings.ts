// All settings: the tinkerer's view, generated from the parameter table. One
// layer open at a time. Labels and help come from params.ts unchanged.

import { PARAMS, type ParamDef, type ParamId } from '../../audio/params';
import { noteName } from '../../audio/tuning';
import type { Snapshot } from '../../session/session';
import { h } from '../controls';
import { uiIcon } from '../icons';
import { SHAPING_LAYERS, SOUND_LAYERS, isOn, type LayerInfo } from '../layers';
import type { Sheet, SheetEnv } from './host';
import { learnLink, paramChoice, paramField, paramSwitch, sheetHead, switchRow, type Part } from './parts';
import { Click, isPhone } from '../../platform/os';

const LEARN_WORDS: Partial<Record<ParamId, string>> = { a432: 'Why?', voicesOn: 'What is this?', noiseColor: 'Which color?' };
const learnFor = (env: SheetEnv, id: ParamId) => {
  const card = PARAMS[id].learn;
  return card ? learnLink(env, LEARN_WORDS[id] ?? 'What is this?', card) : undefined;
};

export function allSettingsSheet(env: SheetEnv, arg: unknown): Sheet {
  const { session } = env;
  const done = h('button', { class: 'btn', type: 'button' }, 'Done');
  done.addEventListener('click', () => env.back());

  const layers: LayerInfo[] = [...SOUND_LAYERS, ...SHAPING_LAYERS];
  let open = typeof arg === 'string' && layers.some((l) => l.key === arg) ? arg : 'drone';

  const control = (id: ParamId): Part => {
    const d: ParamDef = PARAMS[id];
    if (id === 'root') return rootStepper(env);
    if (d.kind === 'toggle') return paramSwitch(env, id, { extra: learnFor(env, id) });
    if (d.kind === 'choice') {
      const part = paramChoice(env, id);
      const link = learnFor(env, id);
      return link ? { el: h('div', { class: 'field-group' }, part.el, h('div', { class: 'field__link' }, link)), refresh: part.refresh } : part;
    }
    return paramField(env, id);
  };

  interface Section {
    layer: LayerInfo;
    el: HTMLElement;
    head: HTMLButtonElement;
    state: HTMLSpanElement;
    body: HTMLElement;
    parts: Part[];
  }
  const sections: Section[] = layers.map((l) => {
    const parts: Part[] = [];
    if (l.on) {
      const onId = l.on;
      parts.push(
        switchRow(env, `${l.label} on`, (s) => !!s.params[onId], (on) => session.setParam(onId, on ? 1 : 0), {
          help: PARAMS[onId].help,
          extra: learnFor(env, onId),
          hint: () => [{ b: `${l.label}.` }, { t: PARAMS[onId].help ?? 'In the water, or out of it.' }],
        }),
      );
      parts.push(paramField(env, l.level, { label: 'Level' }));
    } else parts.push(paramField(env, l.level));
    for (const id of l.all) parts.push(control(id));
    const count = parts.length - (l.on ? 1 : 0);
    const state = h('span', { class: 'panel__count' }, `${count} setting${count === 1 ? '' : 's'}`);
    const name = h('span', { class: 'panel__name' }, h('span', { class: 'layer__dot', 'data-layer': l.key, 'aria-hidden': 'true' }), h('span', { class: 'panel__label' }, l.label));
    const head = h('button', { class: 'panel__head', type: 'button', 'aria-expanded': 'false', 'aria-controls': `all-${l.key}` }, name, state, uiIcon('chevron-down'));
    const body = h('div', { class: 'panel__body', id: `all-${l.key}` }, ...parts.map((p) => p.el));
    const el = h('section', { class: 'panel panel--fold', 'data-layer': l.key }, head, body);
    head.addEventListener('click', () => {
      open = open === l.key ? '' : l.key;
      paint();
      if (open) for (const p of parts) p.refresh(session.snapshot());
      if (open) queueMicrotask(() => el.scrollIntoView({ block: 'nearest' }));
    });
    env.hints.add(head, () => [{ b: `${l.label}.` }, { t: `${count} setting${count === 1 ? '' : 's'}. ${Click} to ${open === l.key ? 'fold them away' : 'show them'}.` }]);
    return { layer: l, el, head, state, body, parts };
  });

  const paint = () => {
    for (const sec of sections) {
      const isOpen = sec.layer.key === open;
      sec.head.setAttribute('aria-expanded', String(isOpen));
      sec.body.hidden = !isOpen;
      sec.el.toggleAttribute('data-open', isOpen);
    }
  };
  paint();

  const el = h('div', {}, sheetHead('All settings', done), ...sections.map((s) => s.el));

  return {
    el,
    label: 'All settings',
    parent: 'shape',
    rest: () => [{ t: `${isPhone ? 'Touch' : 'Hover'} a setting for what it does. Everything here eases in with the sound.` }],
    initialFocus: () => sections.find((s) => s.layer.key === open)?.head ?? null,
    render(s: Snapshot) {
      for (const sec of sections) {
        const on = isOn(sec.layer, s.params);
        sec.el.toggleAttribute('data-off', !on);
        const label = sec.head.querySelector('.panel__label');
        if (label) label.textContent = on ? sec.layer.label : `${sec.layer.label} · off`;
        if (sec.layer.key === open) for (const p of sec.parts) p.refresh(s);
      }
    },
  };
}

/** The drone's home note, a semitone at a time. */
function rootStepper(env: SheetEnv): Part {
  const { session } = env;
  const value = h('b', { class: 'stepper__value', 'aria-live': 'polite' });
  const down = h('button', { class: 'icon-btn icon-btn--outline', type: 'button', 'aria-label': 'Root down a semitone' }, uiIcon('minus'));
  const up = h('button', { class: 'icon-btn icon-btn--outline', type: 'button', 'aria-label': 'Root up a semitone' }, uiIcon('plus'));
  down.addEventListener('click', () => session.setParam('root', session.params.root - 1));
  up.addEventListener('click', () => session.setParam('root', session.params.root + 1));
  for (const b of [down, up]) env.hints.add(b, () => [{ b: 'Root.' }, { t: PARAMS.root.help ?? '' }]);
  const el = h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Root'), h('span', { class: 'stepper' }, down, value, up), h('span'));
  return { el, refresh: (s) => (value.textContent = noteName(s.params.root)) };
}
