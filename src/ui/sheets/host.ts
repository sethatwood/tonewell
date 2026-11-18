// Sheets: everything beyond start and stop, one click away, under the player.
// The window grows downward to fit the sheet (top edge fixed, the system's
// own animation), up to 760 pt in all; past that the sheet scrolls. One sheet
// at a time. Esc, Done or the control that opened it closes it; focus moves
// in when it opens and back to the opener when it closes. Each sheet has its
// own hint line along the bottom.

import type { Session, Snapshot } from '../../session/session';
import { h } from '../controls';
import { HintLine, type Hint } from '../hint';

export type SheetName = 'sound' | 'session' | 'beat' | 'custom' | 'shape' | 'all' | 'guide' | 'name';

/** The naming sheet: keep the current sound, or rename or delete one of yours. */
export interface NameRequest {
  kind: 'keep' | 'rename' | 'delete';
  id?: string;
}

/** What a sheet can ask of the host and the app. */
export interface SheetEnv {
  session: Session;
  hints: HintLine;
  /** Show another sheet in this one's place. */
  open(name: SheetName, arg?: unknown): void;
  /** Done, or Esc: back to the sheet this one came from, or closed. */
  back(): void;
  close(): void;
  openLearn(card: string): void;
}

export interface Sheet {
  readonly el: HTMLElement;
  /** Its name for VoiceOver. */
  readonly label: string;
  /** Where Done and Esc go. */
  parent?: SheetName;
  render(s: Snapshot): void;
  /** What the hint line says when nothing is pointed at. */
  rest(): Hint;
  /** Where focus goes when the sheet opens. */
  initialFocus?(): HTMLElement | null;
  /** Keep keyboard focus inside the sheet (the naming sheet). */
  readonly trap?: boolean;
  dispose?(): void;
}

export type SheetBuilder = (env: SheetEnv, arg: unknown) => Sheet;

/** Sheets opened from inside another: their opener's control still stands for them. */
const PARENT_OF: Partial<Record<SheetName, SheetName>> = { custom: 'beat', all: 'shape' };

/** Whether the sheet `open` is `name`, or one opened from it. */
export function sheetIs(open: SheetName | null, name: SheetName): boolean {
  return open === name || (open !== null && PARENT_OF[open] === name);
}

/** The tallest the window gets with a sheet open, and the player above it. */
export const WINDOW_MAX = 760;
export const PLAYER_H = 156;

/** Which sheets may be open in each state. While resting after the timer, while ending or paused, none. */
export function sheetAllowed(name: SheetName, s: Snapshot): boolean {
  if (s.paused || s.phase === 'ending') return false;
  if (s.phase === 'resting' && s.timerDone && !s.inBreak) return false;
  if (s.phase === 'winding') return name === 'shape' || name === 'beat' || name === 'session' || name === 'custom' || name === 'all' || name === 'name';
  return true;
}

export interface HostDeps {
  /** Make the window this much taller than the player (0: just the player). Resolves when it has. */
  resize(sheetHeight: number): Promise<void>;
  /** Leave mini mode before a sheet opens. */
  leaveMini(): Promise<void>;
  openLearn(card: string): void;
  /** A sheet opened, changed or closed. */
  changed(name: SheetName | null): void;
  /** Where focus goes when nothing better is left: the light. */
  fallbackFocus(): HTMLElement;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

export class SheetHost {
  name: SheetName | null = null;
  readonly hints: HintLine;
  private sheet: Sheet | null = null;
  private opener: HTMLElement | null = null;
  private readonly scroll: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly hintEl: HTMLDivElement;
  private height = 0;
  /** Bumped by every open and close, so a slower one that started earlier gives way. */
  private seq = 0;
  private fitTimer: ReturnType<typeof setTimeout> | null = null;
  private snap: Snapshot | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly session: Session,
    private readonly builders: Record<SheetName, SheetBuilder>,
    private readonly deps: HostDeps,
  ) {
    this.body = h('div', { class: 'sheet-body' });
    this.scroll = h('div', { class: 'sheet-scroll' }, this.body);
    this.hintEl = h('div', { class: 'sheet__hint', 'aria-hidden': 'true' });
    this.hints = new HintLine(container, this.hintEl, () => this.sheet?.rest() ?? []);
    container.append(this.scroll, this.hintEl, this.hints.descs);
    container.hidden = true;
    // The window follows the sheet's height as parts of it open and close.
    new ResizeObserver(() => this.scheduleFit()).observe(this.body);
    container.addEventListener('keydown', (e) => this.trapTab(e));
  }

  get isOpen(): boolean {
    return this.sheet !== null;
  }

  /** Open a sheet, or close it if it's the one already open (its opener was pressed again). */
  toggle(name: SheetName, opener?: HTMLElement | null, arg?: unknown): void {
    if (sheetIs(this.name, name)) void this.close();
    else void this.open(name, opener, arg);
  }

  async open(name: SheetName, opener?: HTMLElement | null, arg?: unknown): Promise<void> {
    const s = this.session.snapshot();
    if (!sheetAllowed(name, s)) return;
    const seq = ++this.seq;
    const prev = this.name;
    if (prev === null) {
      this.opener = opener ?? (document.activeElement as HTMLElement | null);
      await this.deps.leaveMini();
      if (seq !== this.seq) return;
    } else if (opener) {
      // Opened from the player while another sheet was open: this control now closes it.
      this.opener = opener;
    }
    // Show this sheet in place of any other.
    this.unmount();
    const env: SheetEnv = {
      session: this.session,
      hints: this.hints,
      open: (n, a) => void this.open(n, null, a),
      back: () => void this.back(),
      close: () => void this.close(),
      openLearn: (card) => this.deps.openLearn(card),
    };
    const sheet = this.builders[name](env, arg);
    // Naming goes back to the sheet it was asked from (Shape or Sound), if any.
    if (name === 'name' && prev && prev !== 'name' && !sheet.parent) sheet.parent = prev;
    this.sheet = sheet;
    this.name = name;
    sheet.el.classList.add('sheet');
    sheet.el.setAttribute('role', 'dialog');
    sheet.el.setAttribute('aria-label', sheet.label);
    this.body.replaceChildren(sheet.el);
    this.container.hidden = false;
    // A close that was fading out when this opened gave way to it.
    delete this.container.dataset.leaving;
    this.container.dataset.entering = '';
    sheet.render(this.snap ?? s);
    this.hints.reset();
    this.hints.refresh();
    this.deps.changed(name);
    (sheet.initialFocus?.() ?? this.firstFocusable() ?? sheet.el).focus({ preventScroll: true });
    this.scroll.scrollTop = 0;
    // Grow (or shrink) to fit, then let the content fade in.
    await this.fit(true);
    if (seq !== this.seq) return;
    delete this.container.dataset.entering;
    // Anything that changed size meanwhile.
    this.scheduleFit();
  }

  /** Done or Esc: back to the sheet this one came from, or closed. */
  async back(): Promise<void> {
    const parent = this.sheet?.parent;
    if (parent) await this.open(parent);
    else await this.close();
  }

  async close(): Promise<void> {
    if (!this.sheet) return;
    const seq = ++this.seq;
    const opener = this.opener;
    const focusWasIn = this.container.contains(document.activeElement);
    this.container.dataset.leaving = '';
    await wait(140);
    if (seq !== this.seq) return;
    this.unmount();
    this.name = null;
    this.container.hidden = true;
    delete this.container.dataset.leaving;
    this.deps.changed(null);
    if (focusWasIn || document.activeElement === document.body) (opener?.isConnected && !opener.closest('[hidden]') ? opener : this.deps.fallbackFocus()).focus({ preventScroll: true });
    this.opener = null;
    this.height = 0;
    await this.deps.resize(0);
  }

  /** Close at once, with no fade (the window is about to shrink to mini). */
  closeNow(): void {
    if (!this.sheet) return;
    this.seq++;
    this.unmount();
    this.name = null;
    this.container.hidden = true;
    delete this.container.dataset.entering;
    delete this.container.dataset.leaving;
    this.height = 0;
    this.opener = null;
    this.deps.changed(null);
  }

  /** Esc reached the sheet. Returns true if a sheet took it. */
  escape(): boolean {
    if (!this.sheet) return false;
    void this.back();
    return true;
  }

  render(s: Snapshot): void {
    this.snap = s;
    if (!this.sheet || !this.name) return;
    if (!sheetAllowed(this.name, s)) {
      void this.close();
      return;
    }
    try {
      this.sheet.render(s);
    } catch (err) {
      console.warn('Tonewell: sheet render failed', err);
    }
    this.hints.refresh();
  }

  private unmount(): void {
    if (this.fitTimer) clearTimeout(this.fitTimer);
    this.fitTimer = null;
    if (this.sheet) {
      this.hints.forgetWithin(this.sheet.el);
      this.sheet.dispose?.();
      this.sheet.el.remove();
    }
    this.sheet = null;
  }

  /** The sheet's natural height: its content, the hint line (a fixed two lines tall), and the divider above. */
  private naturalHeight(): number {
    return Math.ceil(this.body.scrollHeight + this.hintEl.offsetHeight + 1);
  }

  private scheduleFit(): void {
    if (!this.sheet || this.container.dataset.entering !== undefined) return;
    if (this.fitTimer) clearTimeout(this.fitTimer);
    this.fitTimer = setTimeout(() => void this.fit(false), 60);
  }

  private async fit(force: boolean): Promise<void> {
    if (!this.sheet) return;
    const target = Math.min(WINDOW_MAX - PLAYER_H, this.naturalHeight());
    if (!force && Math.abs(target - this.height) < 2) return;
    this.height = target;
    await this.deps.resize(target);
  }

  private firstFocusable(): HTMLElement | null {
    return this.sheet?.el.querySelector<HTMLElement>('input:checked, [aria-checked="true"], button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? null;
  }

  /** The naming sheet keeps Tab inside it. */
  private trapTab(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.sheet?.trap) return;
    const items = [...this.sheet.el.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')].filter((el) => !el.closest('[hidden]'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
  }
}
