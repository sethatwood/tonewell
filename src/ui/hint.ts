// Hints: one line of help about whatever is pointed at or focused. The player
// and every sheet have a hint line; each control carries its hint, and the
// same words reach VoiceOver through a hidden description, read once with
// the control.

import { h } from './controls';

/** One hint: bold words, plain words and key caps, in order. */
type Part = { b: string } | { t: string } | { k: string };
export type Hint = Part[];

export const plain = (hint: Hint): string => hint.map((p) => ('b' in p ? p.b : 't' in p ? p.t : p.k)).join(' ');

/** The hint's words as nodes: bold in <b>, keys in <kbd>. */
export function hintNodes(hint: Hint): Array<Node | string> {
  return hint.flatMap((p, i) => {
    const sp = i ? [' '] : [];
    if ('b' in p) return [...sp, h('b', {}, p.b)];
    if ('k' in p) return [...sp, h('kbd', {}, p.k)];
    return [...sp, p.t];
  });
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Hinted {
  el: HTMLElement;
  hint: () => Hint;
  desc: HTMLSpanElement;
}

let nextId = 0;

/**
 * Hints for the controls inside `scope`, shown in `line`. With nothing
 * pointed at or focused, the line shows `rest()`. Text swaps fade out and in
 * over 240 ms.
 */
export class HintLine {
  /** Hidden copies of each hint, for aria-describedby. */
  readonly descs: HTMLDivElement = h('div', { hidden: true });
  private readonly hinted = new Map<string, Hinted>();
  private hovered: HTMLElement | null = null;
  private focused: HTMLElement | null = null;
  private key = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly scope: HTMLElement,
    private readonly line: HTMLElement,
    private readonly rest: () => Hint,
    /** Where focus counts: by default, the whole scope. */
    focusScope: HTMLElement = scope,
  ) {
    scope.addEventListener('pointerover', (e) => this.setHovered(this.from(e.target)));
    scope.addEventListener('pointerleave', () => this.setHovered(null));
    focusScope.addEventListener('focusin', (e) => {
      const el = this.from(e.target);
      this.focused = el && el.matches(':focus-visible') ? el : null;
      this.paint();
    });
    focusScope.addEventListener('focusout', () => {
      this.focused = null;
      this.paint();
    });
  }

  /** Give a control a hint. */
  add(el: HTMLElement, hint: () => Hint): void {
    const id = `hint-${++nextId}`;
    const desc = h('span', { id });
    el.setAttribute('aria-describedby', id);
    el.dataset.hinted = id;
    this.hinted.set(id, { el, hint, desc });
    this.descs.append(desc);
    desc.textContent = plain(hint());
  }

  /** Forget a control (it was removed). */
  forget(el: HTMLElement): void {
    const id = el.dataset.hinted;
    if (!id) return;
    this.hinted.get(id)?.desc.remove();
    this.hinted.delete(id);
    if (this.hovered === el) this.hovered = null;
    if (this.focused === el) this.focused = null;
  }

  /** Forget every control inside `root`. */
  forgetWithin(root: Element): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-hinted]')) this.forget(el);
  }

  /** Refresh the hidden descriptions and the line, after the state changed. */
  refresh(): void {
    for (const [id, entry] of this.hinted) {
      if (!entry.el.isConnected) {
        entry.desc.remove();
        this.hinted.delete(id);
        continue;
      }
      const text = plain(entry.hint());
      if (entry.desc.textContent !== text) entry.desc.textContent = text;
    }
    this.paint();
  }

  private from(target: EventTarget | null): HTMLElement | null {
    const el = (target as HTMLElement | null)?.closest?.('[data-hinted]') as HTMLElement | null;
    return el && this.scope.contains(el) && this.hinted.has(el.dataset.hinted ?? '') ? el : null;
  }

  private setHovered(el: HTMLElement | null): void {
    if (el === this.hovered) return;
    this.hovered = el;
    this.paint();
  }

  private hintOf(el: HTMLElement): Hint | null {
    const entry = this.hinted.get(el.dataset.hinted ?? '');
    return entry && el.isConnected && !el.closest('[hidden]') ? entry.hint() : null;
  }

  /** Draw the next text at once, with no fade (a sheet just opened, and is being measured). */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.key = '';
    this.hovered = null;
    this.focused = null;
  }

  paint(): void {
    const target = this.hovered ?? this.focused;
    const hint = (target && this.hintOf(target)) || this.rest();
    const key = JSON.stringify(hint);
    if (key === this.key) return;
    const first = this.key === '';
    this.key = key;
    const draw = () => this.line.replaceChildren(...hintNodes(hint));
    if (this.timer) clearTimeout(this.timer);
    if (first || reducedMotion()) {
      draw();
      this.line.removeAttribute('data-swapping');
      return;
    }
    // 120 ms out, 120 ms in.
    this.line.dataset.swapping = '';
    this.timer = setTimeout(() => {
      draw();
      this.line.removeAttribute('data-swapping');
    }, 120);
  }
}
