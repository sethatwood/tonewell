// The Shape sheet. One point on a feel pad sets Warmth (across) and Motion (up
// and down); the middle is the sound as made. Below it, the layers "in the
// water" as chips: click to add or remove one, open one for its two or three
// most useful settings. More like this nudges every hidden setting a little;
// Keep as my sound saves it. Every change eases in with the sound.

import { PARAMS } from '../../audio/params';
import { moreLikeThis } from '../../presets/nudge';
import type { Snapshot } from '../../session/session';
import { keys } from '../../platform/os';
import { beatName, currentChoice, fmtHz } from '../beats';
import { h } from '../controls';
import type { Hint } from '../hint';
import { uiIcon } from '../icons';
import { SOUND_LAYERS, isOn, type LayerInfo } from '../layers';
import type { Sheet, SheetEnv } from './host';
import { paramChoice, paramField, sheetLabel, type Part } from './parts';

/** "More like this" glides over a few seconds, so nothing jumps. */
const NUDGE_TAU = 1.5;

/** The pad's position, in words: "A little warmer, and stiller." */
export function feelWords(warmth: number, motion: number): string {
  const amount = (d: number) => (Math.abs(d) < 0.4 ? 'a little ' : Math.abs(d) > 0.75 ? 'much ' : '');
  const w = (warmth - 0.5) * 2;
  const m = (motion - 0.5) * 2;
  const still = 0.05;
  const warm = Math.abs(w) < still ? '' : `${amount(w)}${w < 0 ? 'warmer' : 'brighter'}`;
  let move = '';
  if (Math.abs(m) >= still) {
    if (m < 0) move = `${amount(m)}stiller`;
    else move = Math.abs(m) < 0.4 ? 'wandering a little more' : Math.abs(m) > 0.75 ? 'wandering much more' : 'wandering more';
  }
  const text = warm && move ? `${warm}, and ${move}` : warm || move;
  return text ? `${text[0].toUpperCase()}${text.slice(1)}.` : 'As made.';
}

const STEP = 0.05;
const BIG_STEP = 0.2;

export function shapeSheet(env: SheetEnv): Sheet {
  const { session } = env;

  // ---------- the feel pad ----------
  const point = h('span', { class: 'pad__point', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), h('span'));
  const pad = h(
    'div',
    { class: 'pad', role: 'slider', tabindex: '0', 'aria-label': 'Feel: warmth across, motion up and down', 'aria-valuemin': '0', 'aria-valuemax': '100' },
    h('span', { class: 'pad__axis-x' }),
    h('span', { class: 'pad__axis-y' }),
    h('span', { class: 'pad__home' }),
    h('span', { class: 'pad__home-label' }, 'as made'),
    h('span', { class: 'pad__label pad__label--l' }, 'Warmer'),
    h('span', { class: 'pad__label pad__label--r' }, 'Brighter'),
    h('span', { class: 'pad__label pad__label--t' }, 'Wandering'),
    h('span', { class: 'pad__label pad__label--b' }, 'Still'),
    point,
  );
  const readout = h('div', { class: 'pad-readout', 'aria-hidden': 'true' });
  // The point is placed by transform, in pixels of the pad's inside.
  const measure = new ResizeObserver(() => {
    if (!pad.clientWidth) return;
    pad.style.setProperty('--pad-w', `${pad.clientWidth}px`);
    pad.style.setProperty('--pad-h', `${pad.clientHeight}px`);
  });
  measure.observe(pad);
  const setFeel = (warmth: number, motion: number) => {
    const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    session.setParams({ warmth: c(warmth), motion: c(motion) });
  };
  const fromPointer = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    setFeel((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
  };
  let dragging = false;
  pad.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pad.setPointerCapture(e.pointerId);
    pad.focus({ preventScroll: true });
    dragging = true;
    // A click jumps there; the point eases over 240 ms, the sound at its own pace.
    fromPointer(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!dragging || !pad.hasPointerCapture(e.pointerId)) return;
    pad.dataset.dragging = '';
    fromPointer(e);
  });
  const endDrag = () => {
    dragging = false;
    delete pad.dataset.dragging;
  };
  pad.addEventListener('pointerup', endDrag);
  pad.addEventListener('pointercancel', endDrag);
  pad.addEventListener('dblclick', () => setFeel(0.5, 0.5));
  pad.addEventListener('keydown', (e) => {
    const p = session.params;
    const step = e.shiftKey ? BIG_STEP : STEP;
    let w = p.warmth;
    let m = p.motion;
    if (e.key === 'ArrowLeft') w -= step;
    else if (e.key === 'ArrowRight') w += step;
    else if (e.key === 'ArrowUp') m += step;
    else if (e.key === 'ArrowDown') m -= step;
    else if (e.key === '0' || e.key === 'Home') {
      w = 0.5;
      m = 0.5;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    setFeel(w, m);
  });
  env.hints.add(pad, () => [{ b: 'Feel.' }, { t: 'Arrow keys move the feel point;' }, { k: '0' }, { t: 'recenters.' }]);

  // ---------- the layers ----------
  const chips = h('div', { class: 'layers' });
  const panelSlot = h('div', { class: 'layer-panel-slot' });
  let open: string | null = null;
  let order = '';
  let panel: { key: string; parts: Part[]; el: HTMLElement } | null = null;
  const chipEls = new Map<string, { wrap: HTMLElement; toggle: HTMLButtonElement; more: HTMLButtonElement }>();

  const openPanel = (key: string | null) => {
    open = key;
    if (panel) {
      env.hints.forgetWithin(panel.el);
      panel.el.remove();
      panel = null;
    }
    if (key) {
      const l = SOUND_LAYERS.find((x) => x.key === key)!;
      const level = paramField(env, l.level, { label: 'Level', hint: () => [{ b: `${l.label} level.` }, { t: 'How loud it sits in the mix.' }] });
      const parts: Part[] = [level, ...l.most.map((id) => (PARAMS[id].kind === 'choice' ? paramChoice(env, id) : paramField(env, id)))];
      const all = h('button', { class: 'link', type: 'button' }, `All ${l.label.toLowerCase()} settings`);
      all.addEventListener('click', () => env.open('all', l.key));
      env.hints.add(all, () => [{ b: `All ${l.label.toLowerCase()} settings.` }, { t: 'The full list, from the tinkerer’s view.' }]);
      const el = h('div', { class: 'panel', id: `layer-panel-${l.key}` }, h('div', { class: 'panel__title' }, h('span', {}, l.label), all), ...parts.map((p) => p.el));
      panel = { key, parts, el };
      panelSlot.append(el);
      for (const p of parts) p.refresh(session.snapshot());
    }
    for (const [k, c] of chipEls) {
      c.more.setAttribute('aria-expanded', String(k === key));
      c.more.replaceChildren(uiIcon(k === key ? 'chevron-up' : 'chevron-down'));
      c.wrap.toggleAttribute('data-open', k === key);
    }
  };

  const chip = (l: LayerInfo) => {
    const toggle = h('button', { class: 'layer__toggle', type: 'button', 'aria-pressed': 'false' }, h('span', { class: 'layer__dot', 'aria-hidden': 'true' }), l.label);
    const more = h('button', { class: 'layer__more', type: 'button', 'aria-expanded': 'false', 'aria-controls': `layer-panel-${l.key}`, 'aria-label': `${l.label} settings` }, uiIcon('chevron-down'));
    const wrap = h('span', { class: 'layer', 'data-layer': l.key }, toggle, more);
    toggle.addEventListener('click', (e) => {
      if (e.altKey) {
        env.open('all', l.key);
        return;
      }
      const on = !isOn(l, session.params);
      if (l.on) session.setParam(l.on, on ? 1 : 0);
      if (!on && open === l.key) openPanel(null);
    });
    toggle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' && isOn(l, session.params)) {
        e.preventDefault();
        openPanel(l.key);
        more.focus();
      } else if (e.key === 'ArrowLeft' && open === l.key) {
        e.preventDefault();
        openPanel(null);
      }
    });
    more.addEventListener('click', () => openPanel(open === l.key ? null : l.key));
    env.hints.add(toggle, (): Hint => (isOn(l, session.params) ? [{ b: `${l.label},` }, { t: 'in the water. Click to take it out; → for its settings.' }] : [{ b: `${l.label}.` }, { t: 'Click to add it. ⌥-click for all its settings.' }]));
    env.hints.add(more, () => [{ b: `${l.label}:` }, { t: 'its level and most-used settings.' }]);
    chipEls.set(l.key, { wrap, toggle, more });
    return wrap;
  };
  for (const l of SOUND_LAYERS) chip(l);

  // ---------- the beat, what changed, and the two buttons ----------
  const beatValue = h('span', { class: 'beat-row__value' });
  const beatRow = h('button', { class: 'beat-row', type: 'button' }, uiIcon('beat'), h('b', {}, 'Beat'), beatValue, uiIcon('chevron-right'));
  beatRow.addEventListener('click', () => env.open('beat'));
  env.hints.add(beatRow, () => [{ b: 'Beat.' }, { t: 'Choose what it is for.' }, { k: keys('⌘B') }, { t: 'off and on.' }]);

  const changedText = h('span');
  const revert = h('button', { class: 'btn btn--small', type: 'button' }, 'Revert');
  revert.addEventListener('click', () => session.revert());
  env.hints.add(revert, () => [{ b: 'Revert.' }, { t: `Back to ${session.preset.name} as it was.` }]);
  const changed = h('div', { class: 'edited' }, h('span', { class: 'edited__dot', 'aria-hidden': 'true' }), changedText, revert);

  const more = h('button', { class: 'btn btn--lg btn--block', type: 'button' }, uiIcon('more-like-this'), 'More like this');
  more.addEventListener('click', () => session.setParams(moreLikeThis(session.params), NUDGE_TAU));
  env.hints.add(more, () => [{ b: 'More like this.' }, { t: 'Nudges every hidden setting a little. Revert undoes it.' }]);
  const keep = h('button', { class: 'btn btn--lg btn--primary btn--block', type: 'button' }, 'Keep as my sound');
  keep.addEventListener('click', () => env.open('name', { kind: 'keep' }));
  env.hints.add(keep, () => [{ b: 'Keep as my sound.' }, { t: 'Name what you hear; it joins your sounds.' }]);

  const el = h(
    'div',
    {},
    sheetLabel('Feel', 'Double-click to return to center'),
    pad,
    readout,
    sheetLabel('In the water', 'Click to add or remove'),
    chips,
    panelSlot,
    beatRow,
    changed,
    h('div', { class: 'sheet__foot' }, more, keep),
  );

  return {
    el,
    label: 'Shape the sound',
    rest: () => [{ t: 'Changes ease in with the sound.' }, { b: 'Revert' }, { t: 'is always one click away.' }],
    initialFocus: () => pad,
    dispose: () => measure.disconnect(),
    render(s: Snapshot) {
      const p = s.params;
      // The point moves by transform only.
      pad.style.setProperty('--x', String(p.warmth));
      pad.style.setProperty('--y', String(1 - p.motion));
      const words = feelWords(p.warmth, p.motion);
      readout.textContent = words;
      pad.setAttribute('aria-valuetext', words);
      pad.setAttribute('aria-valuenow', String(Math.round(p.warmth * 100)));

      // Playing layers first; only re-ordered when the sound changes, never under the pointer.
      const key = `${s.mode}:${s.preset.id}`;
      if (key !== order) {
        order = key;
        const on = SOUND_LAYERS.filter((l) => isOn(l, p));
        const offs = SOUND_LAYERS.filter((l) => !isOn(l, p));
        chips.replaceChildren(...[...on, ...offs].map((l) => chipEls.get(l.key)!.wrap));
      }
      for (const l of SOUND_LAYERS) {
        const c = chipEls.get(l.key)!;
        const on = isOn(l, p);
        c.toggle.setAttribute('aria-pressed', String(on));
        c.wrap.toggleAttribute('data-on', on);
        c.more.hidden = !on;
      }
      if (open && !isOn(SOUND_LAYERS.find((l) => l.key === open)!, p)) openPanel(null);
      for (const part of panel?.parts ?? []) part.refresh(s);

      const c = currentChoice(p);
      beatValue.textContent = !p.beatOn ? 'No beat' : c ? `${c.name}, ${c.meta}` : `${beatName(p)}, ${p.rampOn ? `${fmtHz(p.rampFrom)} → ${fmtHz(p.beatHz)}` : fmtHz(p.beatHz)} Hz`;
      beatRow.setAttribute('aria-label', `Beat: ${beatValue.textContent}. Choose a beat`);
      changed.hidden = !s.edited;
      changedText.textContent = `Changed from ${s.preset.name}`;
    },
  };
}
