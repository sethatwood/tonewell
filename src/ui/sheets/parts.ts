// Small pieces the sheets are built from: sliders bound to sound settings,
// switch rows, chips that open a small native menu, segmented choices.
// Each returns its element and a refresh that repaints it from a snapshot.

import { PARAMS, formatParam, fromSlider, toSlider, type ParamDef, type ParamId } from '../../audio/params';
import type { Snapshot } from '../../session/session';
import { h, nextId } from '../controls';
import type { Hint } from '../hint';
import { uiIcon } from '../icons';
import { popup, type MenuNode } from '../menu';
import type { SheetEnv } from './host';

export interface Part {
  el: HTMLElement;
  refresh(s: Snapshot): void;
}

/** A setting's hint: its name in bold, then its help, or what it's set to. */
export function paramHint(id: ParamId, label = PARAMS[id].label): () => Hint {
  const d: ParamDef = PARAMS[id];
  return () => [{ b: `${label}.` }, { t: d.help ?? '' }];
}

/** A range input whose filled part follows its value. */
export function range(label: string, min = 0, max = 1000): HTMLInputElement {
  return h('input', { class: 'range', type: 'range', min, max, step: 1, 'aria-label': label });
}

export function paintRange(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  input.style.setProperty('--v', String((Number(input.value) - min) / (max - min)));
}

/** A row: label, slider, value. Bound to a sound setting, following its own scale (log, bands). */
export function paramField(env: SheetEnv, id: ParamId, opts: { label?: string; hint?: () => Hint; onSet?: (v: number) => void; format?: (v: number) => string } = {}): Part & { input: HTMLInputElement } {
  const label = opts.label ?? PARAMS[id].label;
  const show = opts.format ?? ((v: number) => formatParam(id, v));
  const input = range(label);
  const value = h('span', { class: 'field__value', 'aria-hidden': 'true' });
  const set = (v: number) => (opts.onSet ? opts.onSet(v) : env.session.setParam(id, v));
  input.addEventListener('input', () => {
    const v = fromSlider(id, Number(input.value) / 1000);
    paintRange(input);
    value.textContent = show(v);
    input.setAttribute('aria-valuetext', value.textContent);
    set(v);
  });
  const name = h('span', { class: 'field__label' }, label);
  const el = h('label', { class: 'field' }, name, input, value);
  env.hints.add(input, opts.hint ?? paramHint(id, label));
  return {
    el,
    input,
    refresh: (s) => {
      const v = s.params[id];
      // Never move the thumb out from under a pointer that's holding it.
      if (!input.matches(':active')) input.value = String(Math.round(toSlider(id, v) * 1000));
      paintRange(input);
      value.textContent = show(v);
      input.setAttribute('aria-valuetext', value.textContent);
    },
  };
}

/** A switch (a real button with role="switch"). */
export function switchButton(label: string, onChange: (on: boolean) => void): { el: HTMLButtonElement; set(on: boolean): void } {
  const el = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': label });
  el.addEventListener('click', () => {
    const on = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(on));
    onChange(on);
  });
  return { el, set: (on) => el.setAttribute('aria-checked', String(on)) };
}

/** A row: label (and help) at the left, a switch at the right. */
export function switchRow(env: SheetEnv, label: string, get: (s: Snapshot) => boolean, set: (on: boolean) => void, opts: { help?: string | ((s: Snapshot) => string); hint?: () => Hint; extra?: HTMLElement } = {}): Part {
  const sw = switchButton(label, set);
  const help = opts.help ? h('span', { class: 'row__help' }) : null;
  const text = h('div', { class: 'row__text' }, h('span', { class: 'row__label' }, label), help, opts.extra);
  const el = h('div', { class: 'row' }, text, sw.el);
  env.hints.add(sw.el, opts.hint ?? (() => [{ b: `${label}.` }, { t: typeof opts.help === 'string' ? opts.help : '' }]));
  return {
    el,
    refresh: (s) => {
      sw.set(get(s));
      if (help && opts.help) help.textContent = typeof opts.help === 'string' ? opts.help : opts.help(s);
    },
  };
}

/** A switch row bound to an on/off sound setting. */
export function paramSwitch(env: SheetEnv, id: ParamId, opts: { label?: string; extra?: HTMLElement; help?: string } = {}): Part {
  const d: ParamDef = PARAMS[id];
  const label = opts.label ?? d.label;
  const help = opts.help ?? d.help;
  return switchRow(env, label, (s) => !!s.params[id], (on) => env.session.setParam(id, on ? 1 : 0), {
    help,
    extra: opts.extra,
    hint: () => [{ b: `${label}.` }, { t: help ?? '' }],
  });
}

/** A chip that opens a small native menu of choices. */
export function menuChip(label: string, nodes: () => MenuNode[], pick: (id: string) => void): { el: HTMLButtonElement; set(text: string): void } {
  const text = h('span');
  const el = h('button', { class: 'chip chip--menu', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, text, uiIcon('chevron-down'));
  el.addEventListener('click', async () => {
    el.setAttribute('aria-expanded', 'true');
    const id = await popup(nodes(), el);
    el.setAttribute('aria-expanded', 'false');
    if (id) pick(id);
  });
  return {
    el,
    set: (t) => {
      if (text.textContent !== t) text.textContent = t;
      el.setAttribute('aria-label', `${label}: ${t}`);
    },
  };
}

/** A row: label (and help) at the left, a chip with a small menu at the right. */
export function menuRow(env: SheetEnv, label: string, help: string | null, value: (s: Snapshot) => string, nodes: () => MenuNode[], pick: (id: string) => void): Part {
  const chip = menuChip(label, nodes, pick);
  const text = h('div', { class: 'row__text' }, h('span', { class: 'row__label' }, label), help ? h('span', { class: 'row__help' }, help) : null);
  env.hints.add(chip.el, () => [{ b: `${label}.` }, { t: help ?? '' }]);
  return { el: h('div', { class: 'row' }, text, chip.el), refresh: (s) => chip.set(value(s)) };
}

/** A choice-kind sound setting as a field: label, then a chip with its choices. */
export function paramChoice(env: SheetEnv, id: ParamId): Part {
  const d: ParamDef = PARAMS[id];
  const choices = d.choices ?? [];
  const chip = menuChip(d.label, () => choices.map((c, i) => ({ kind: 'check', id: String(i), label: c, checked: Math.round(env.session.params[id]) === i })), (v) => env.session.setParam(id, Number(v)));
  env.hints.add(chip.el, () => [{ b: `${d.label}.` }, { t: d.help ?? `Now ${formatParam(id, env.session.params[id])}.` }]);
  const el = h('div', { class: 'field field--chip' }, h('span', { class: 'field__label' }, d.label), h('span', { class: 'field__chip' }, chip.el));
  return { el, refresh: (s) => chip.set(formatParam(id, Math.round(s.params[id]))) };
}

/** Radios drawn as tiles: lengths, beat types, modes. */
export function segmented<T extends string | number>(
  label: string,
  options: Array<{ value: T; label: string; key?: string }>,
  pick: (v: T) => void,
  columns = options.length,
): { el: HTMLElement; set(v: T | null): void; inputs: HTMLInputElement[] } {
  const name = nextId('seg');
  const inputs: HTMLInputElement[] = [];
  const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label, style: `grid-template-columns:repeat(${columns},minmax(0,1fr))` });
  for (const o of options) {
    const input = h('input', { type: 'radio', name, value: String(o.value) });
    input.addEventListener('change', () => {
      if (input.checked) pick(o.value);
    });
    inputs.push(input);
    el.append(h('label', {}, input, h('span', {}, o.label, ...(o.key ? [h('kbd', { class: 'kbd' }, o.key)] : []))));
  }
  return {
    el,
    inputs,
    set: (v) => options.forEach((o, i) => (inputs[i].checked = o.value === v)),
  };
}

/** A small link that opens a Learn card. */
export function learnLink(env: SheetEnv, text: string, card: string): HTMLButtonElement {
  const b = h('button', { class: 'link', type: 'button' }, text);
  b.addEventListener('click', () => env.openLearn(card));
  env.hints.add(b, () => [{ b: text }, { t: 'opens in Learn.' }]);
  return b;
}

/** A sheet's title row, with an optional button at the right (Done, Close). */
export function sheetHead(title: string, button?: HTMLElement): HTMLElement {
  return h('div', { class: 'sheet__head' }, h('h2', { class: 'sheet__title' }, title), button ?? null);
}

/** A caps label with an optional note at the right. */
export function sheetLabel(text: string, note?: string): HTMLElement {
  return h('div', { class: 'sheet__label' }, h('span', {}, text), note ? h('span', {}, note) : null);
}
