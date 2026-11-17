// Small control builders shared by the player, the panel and Settings.

import { PARAMS, formatParam, fromSlider, toSlider, type ParamId } from '../audio/params';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}

let uid = 0;
export const nextId = (prefix: string) => `${prefix}-${++uid}`;

/** Paint the lit part of an engraved scale. Bipolar scales light from the center. */
export function paintScale(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const v = (Number(input.value) - min) / (max - min);
  const pct = v * 100;
  if (input.classList.contains('bipolar')) {
    input.style.setProperty('--lit-x', `${Math.min(pct, 50)}%`);
    input.style.setProperty('--lit-w', `${Math.abs(pct - 50)}%`);
  } else {
    input.style.setProperty('--lit-x', '0%');
    input.style.setProperty('--lit-w', `${pct}%`);
  }
}

export interface ScaleOptions {
  label: string;
  value: number; // 0..1 slider position
  bipolar?: boolean;
  valueText?: (pos: number) => string;
  onInput: (pos: number) => void;
  /** Double-click resets a bipolar scale to its center. */
  resetTo?: number;
  step?: number;
  hideLabel?: boolean;
}

export function scale(o: ScaleOptions): { el: HTMLElement; input: HTMLInputElement; set: (pos: number) => void } {
  const id = nextId('scale');
  const input = h('input', {
    type: 'range', id, min: 0, max: 1000, step: (o.step ?? 0.001) * 1000, class: o.bipolar ? 'scale bipolar' : 'scale',
  });
  const out = h('span', { class: 'scale-value', 'aria-hidden': 'true' });
  const set = (pos: number) => {
    input.value = String(Math.round(pos * 1000));
    paintScale(input);
    const text = o.valueText?.(pos);
    if (text !== undefined) {
      input.setAttribute('aria-valuetext', text);
      out.textContent = text;
    }
  };
  input.addEventListener('input', () => {
    let pos = Number(input.value) / 1000;
    // A soft detent at the center of bipolar scales.
    if (o.bipolar && Math.abs(pos - 0.5) < 0.025) {
      pos = 0.5;
      input.value = '500';
    }
    paintScale(input);
    const text = o.valueText?.(pos);
    if (text !== undefined) {
      input.setAttribute('aria-valuetext', text);
      out.textContent = text;
    }
    o.onInput(pos);
  });
  if (o.resetTo !== undefined) {
    input.addEventListener('dblclick', () => {
      set(o.resetTo!);
      o.onInput(o.resetTo!);
    });
  }
  const label = h('label', { for: id, class: o.hideLabel ? 'sr-only' : 'scale-label' }, o.label);
  const head = h('span', { class: 'scale-head' }, label, out);
  const el = h('div', { class: 'scale-field' }, head, input);
  set(o.value);
  return { el, input, set };
}

/** A slider bound to a sound parameter. */
export function paramScale(id: ParamId, get: () => number, setParam: (id: ParamId, v: number) => void, label?: string) {
  const def = PARAMS[id];
  const s = scale({
    label: label ?? def.label,
    value: toSlider(id, get()),
    bipolar: def.group === 'macro',
    resetTo: def.group === 'macro' ? 0.5 : undefined,
    valueText: (pos) => formatParam(id, fromSlider(id, pos)),
    onInput: (pos) => setParam(id, fromSlider(id, pos)),
  });
  return { ...s, refresh: () => s.set(toSlider(id, get())) };
}

export function switchControl(label: string, checked: boolean, onChange: (on: boolean) => void, hideLabel = false) {
  const btn = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(checked), 'aria-label': hideLabel ? label : undefined });
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', String(on));
    onChange(on);
  });
  const set = (on: boolean) => btn.setAttribute('aria-checked', String(on));
  return { el: btn, set };
}

export function radios<T extends string | number>(
  label: string,
  options: Array<{ value: T; label: string }>,
  value: T,
  onChange: (v: T) => void,
) {
  const group = h('div', { class: 'radios', role: 'radiogroup', 'aria-label': label });
  const buttons = options.map((o) => {
    const b = h('button', { role: 'radio', 'aria-checked': String(o.value === value), tabindex: o.value === value ? 0 : -1 }, o.label);
    b.addEventListener('click', () => {
      set(o.value);
      onChange(o.value);
    });
    group.append(b);
    return b;
  });
  group.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % buttons.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + buttons.length) % buttons.length;
    if (j >= 0) {
      e.preventDefault();
      buttons[j].focus();
      buttons[j].click();
    }
  });
  const set = (v: T) => {
    options.forEach((o, i) => {
      buttons[i].setAttribute('aria-checked', String(o.value === v));
      buttons[i].tabIndex = o.value === v ? 0 : -1;
    });
  };
  return { el: group, set };
}

/** Inline SVG icon from a path list, drawn with currentColor strokes. */
export function icon(paths: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

export const ICONS = {
  // An eight-petal rosette: a nod to the Chrysanthemum scene.
  visuals:
    '<circle cx="12" cy="12" r="2.2"/>' +
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<ellipse cx="12" cy="6.4" rx="2" ry="3.6" transform="rotate(${a} 12 12)"/>`).join(''),
  // A panel glyph: the lid opening.
  expand: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16"/><path d="M9 14.5l3 2.5 3-2.5"/>',
  collapse: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16"/><path d="M9 17l3-2.5 3 2.5"/>',
  close: '<path d="M7 7l10 10M17 7L7 17"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  speaker: '<path d="M5 10v4h3l4 3.5v-11L8 10H5z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M17.8 7.2a6.8 6.8 0 0 1 0 9.6"/>',
  disclosure: '<path d="M10 7l5 5-5 5"/>',
  book: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
};
