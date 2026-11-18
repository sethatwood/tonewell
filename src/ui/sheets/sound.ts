// The Sound sheet: the mode, and the sound. Every preset has a face here: its
// name, its blurb and the lights of what plays in it. Choosing one while
// playing cross-fades over about eight seconds.

import { presetParams, type Preset } from '../../presets/builtin';
import type { Snapshot } from '../../session/session';
import { h } from '../controls';
import { uiIcon } from '../icons';
import { layersIn } from '../layers';
import { item, popup, sep } from '../menu';
import { keys } from '../../platform/os';
import type { Sheet, SheetEnv } from './host';
import { segmented } from './parts';

export function soundSheet(env: SheetEnv): Sheet {
  const { session } = env;
  const mode = segmented<'meditate' | 'focus'>(
    'Mode',
    [
      { value: 'meditate', label: 'Meditate', key: keys('⌘1') },
      { value: 'focus', label: 'Focus', key: keys('⌘2') },
    ],
    (m) => session.setMode(m),
  );
  mode.el.classList.add('segmented--mode');
  env.hints.add(mode.inputs[0], () => [{ b: 'Meditate.' }, { t: 'Its own sound, length and beat.' }, { k: keys('⌘1') }]);
  env.hints.add(mode.inputs[1], () => [{ b: 'Focus.' }, { t: 'Its own sound, length and beat, and work cycles.' }, { k: keys('⌘2') }]);

  const builtins = h('div', { class: 'sounds', role: 'radiogroup' });
  const yoursLabel = h('div', { class: 'group-label' }, 'Yours');
  const yours = h('div', { class: 'sounds', role: 'radiogroup', 'aria-label': 'Your sounds' });
  const keep = h(
    'button',
    { class: 'sound sound--add', type: 'button' },
    h('span', { class: 'sound__name' }, uiIcon('plus'), 'Keep the current sound'),
    h('span', { class: 'sound__blurb' }, 'Saves what you are hearing now as one of yours.'),
  );
  keep.addEventListener('click', () => env.open('name', { kind: 'keep' }));
  env.hints.add(keep, () => [{ b: 'Keep the current sound.' }, { t: 'Name it, and it joins your sounds.' }]);
  const el = h('div', {}, mode.el, builtins, yoursLabel, yours);

  let key = '';
  const cards = new Map<string, HTMLButtonElement>();

  const card = (p: Preset): HTMLButtonElement => {
    const lights = layersIn(presetParams(p));
    const b = h(
      'button',
      { class: 'sound', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-id': p.id },
      h('span', { class: 'sound__name' }, p.name),
      h('span', { class: 'sound__blurb' }, p.blurb),
      h('span', { class: 'sound__dots', 'aria-hidden': 'true' }, ...lights.map((l) => h('i', { 'data-layer': l.key }))),
    );
    b.addEventListener('click', () => session.setPreset(p.id));
    if (!p.builtin) {
      const menu = async (at?: { x: number; y: number }) => {
        const id = await popup([item('rename', 'Rename…'), item('duplicate', 'Duplicate'), sep, item('delete', 'Delete…')], b, at);
        if (id === 'rename') env.open('name', { kind: 'rename', id: p.id });
        else if (id === 'duplicate') session.duplicatePreset(p.id);
        else if (id === 'delete') env.open('name', { kind: 'delete', id: p.id });
      };
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        void menu({ x: e.clientX, y: e.clientY });
      });
      // The keyboard's way to the same menu.
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault();
          void menu();
        }
      });
    }
    const words = lights.map((l) => l.label.toLowerCase());
    env.hints.add(b, () => [{ b: `${p.name}.` }, { t: words.length ? `${words.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()) : '' }, ...(p.builtin ? [] : [{ t: 'Right-click to rename, duplicate or delete.' }])]);
    return b;
  };

  // Arrow keys move through every card, as one set of radios.
  el.addEventListener('keydown', (e) => {
    const all = [...el.querySelectorAll<HTMLButtonElement>('.sound[role="radio"]')];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (e.key === 'ArrowDown' ? 2 : 1) : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (e.key === 'ArrowUp' ? -2 : -1) : 0;
    if (!step) return;
    e.preventDefault();
    const next = all[Math.min(all.length - 1, Math.max(0, i + step))];
    next.focus();
    next.click();
  });

  return {
    el,
    label: 'Choose a sound',
    rest: () => [{ k: '[' }, { k: ']' }, { t: 'step through sounds. Right-click one of yours to rename, duplicate or delete.' }],
    initialFocus: () => el.querySelector<HTMLElement>('.sound[aria-checked="true"]'),
    render(s: Snapshot) {
      mode.set(s.mode);
      const list = session.presetsFor(s.mode);
      const k = `${s.mode}|${list.map((p) => `${p.id}:${p.name}`).join(',')}`;
      if (k !== key) {
        key = k;
        const hadFocus = el.contains(document.activeElement) && (document.activeElement as HTMLElement).classList.contains('sound');
        for (const c of cards.values()) env.hints.forget(c);
        cards.clear();
        const make = (p: Preset) => {
          const c = card(p);
          cards.set(p.id, c);
          return c;
        };
        builtins.setAttribute('aria-label', `${s.mode === 'meditate' ? 'Meditate' : 'Focus'} sounds`);
        builtins.replaceChildren(...list.filter((p) => p.builtin).map(make));
        yours.replaceChildren(...list.filter((p) => !p.builtin).map(make), keep);
        if (hadFocus) queueMicrotask(() => cards.get(s.preset.id)?.focus());
      }
      for (const [id, c] of cards) {
        const on = id === s.preset.id;
        c.setAttribute('aria-checked', String(on));
        c.tabIndex = on ? 0 : -1;
      }
    },
  };
}
