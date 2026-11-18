// The player: the light, what is playing, one line of help, and two chips.
//
// The hint line is the help system. At rest it shows a one-line description
// of the sound (while playing, when it ends); pointing at a control, or
// reaching it with the keyboard, swaps in one sentence about that control at
// once. Rest messages and notices take the place of the name, the hint line
// and the chips. Only text, opacity and colour change between states: the
// layout holds still, and nothing on screen counts seconds. Everything else
// is a sheet away: the eyebrow and name open Sound, the chips open Session
// and Beat, the tools open Shape and the Field guide.

import type { Notice, Session, Snapshot } from '../session/session';
import { h } from './controls';
import { uiIcon, type UiIcon } from './icons';
import { BEAT_CHOICES, beatHint, beatLong, beatName, choiceParams } from './beats';
import { HintLine, type Hint } from './hint';
import { sheetIs, type NameRequest, type SheetName } from './sheets/host';
// Windows writes shortcuts longer (Ctrl+Shift+V), so a few hints say less there to fit the line.
import { isMac, keys } from '../platform/os';

export type { Hint } from './hint';

export interface PlayerActions {
  /** Open a sheet under the player, or close it if it's the one open. `opener` gets focus back when it closes. */
  toggleSheet(name: SheetName, opener: HTMLElement | null): void;
  /** Open a sheet (from the menu bar, or another sheet). */
  openSheet(name: SheetName, arg?: unknown): void;
  openVisuals(): void;
  openLearn(card?: string): void;
  openSettings(): void;
  hideWindow(): void;
  /** The right-click menu, at the pointer. */
  contextMenu(anchor: HTMLElement, at?: { x: number; y: number }): void;
  /** Shrink to the light alone, or grow back to the player. */
  toggleMini(): void;
  /** Move the window with the pointer (mini mode). */
  startDrag(): void;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const LENGTHS: Array<number | null> = [10, 15, 20, 30, 45, 60, 90, null];

export function lengthLabel(m: number | null): string {
  return m === null ? 'Open' : `${m} min`;
}

/** Handle ids shared by the menu bar and the right-click menu. Returns false if unknown. */
export async function handleMenuId(id: string, session: Session, actions: PlayerActions): Promise<boolean> {
  const s = session.snapshot();
  if (id.startsWith('length:')) {
    const v = id.slice(7);
    session.setLength(v === 'open' ? null : Number(v));
  } else if (id === 'keep-playing') {
    session.setPrefs({ keepPlaying: !s.prefs.keepPlaying });
  } else if (id.startsWith('beat:')) {
    const v = id.slice(5);
    if (v === 'more') actions.openSheet('custom');
    else if (v === 'learn') actions.openLearn('evidence');
    else if (v === 'off') session.setParam('beatOn', 0);
    else {
      const choice = BEAT_CHOICES.find((c) => c.id === v);
      if (choice) session.setParams(choiceParams(choice));
    }
  } else if (id.startsWith('preset:')) {
    session.setPreset(id.slice(7));
  } else if (id === 'sound-sheet') actions.openSheet('sound');
  else if (id === 'preset-save-as') actions.openSheet('name', { kind: 'keep' } satisfies NameRequest);
  else if (id === 'preset-save') session.savePreset();
  else if (id === 'preset-rename') actions.openSheet('name', { kind: 'rename', id: s.preset.id } satisfies NameRequest);
  else if (id === 'preset-duplicate') session.duplicatePreset(s.preset.id);
  else if (id === 'preset-delete') actions.openSheet('name', { kind: 'delete', id: s.preset.id } satisfies NameRequest);
  else if (id === 'preset-revert') session.revert();
  else if (id.startsWith('volume:')) {
    const v = id.slice(7);
    if (v === 'up') session.nudgeVolume(0.05);
    else if (v === 'down') session.nudgeVolume(-0.05);
    else session.setVolume(Number(v) / 100);
  } else if (id === 'mode:meditate' || id === 'mode:focus') session.setMode(id.slice(5) as 'meditate' | 'focus');
  else return false;
  return true;
}

// ---------- the words ----------

/** The sound's one-line description: its own line, or the start of its blurb. */
export function shortDescription(s: Snapshot): string {
  return s.preset.short ?? s.preset.blurb;
}

const minutesWord = (n: number): string => `${n} minute${n === 1 ? '' : 's'}`;
const lengthWords = (m: number | null): string => (m === null ? 'open-ended' : minutesWord(m));
const cycling = (s: Snapshot): boolean => s.prefs.breakMinutes > 0 && s.prefs.minutes !== null;
const toSilence = (s: Snapshot): boolean => s.prefs.landTo === 'silence' && !s.inBreak;
const onSpeakers = (s: Snapshot): boolean => s.output?.kind === 'speakers';

/** Whole minutes for the light, never a countdown of seconds. */
const minutesLeft = (seconds: number): number => Math.max(1, Math.ceil(seconds / 60 - 1e-6));
const minutesIn = (s: Snapshot): number => (s.startedAt ? Math.max(0, Math.floor((Date.now() - s.startedAt.getTime()) / 60000)) : 0);

/** What the hint line says when nothing is pointed at. */
export function description(s: Snapshot, firstRun: boolean): string {
  if (s.phase === 'ready') return firstRun ? 'Headphones on, then start.' : shortDescription(s);
  if (s.phase !== 'playing') return '';
  if (onSpeakers(s) && s.params.beatOn && s.params.beatMode === 0) return 'On speakers, so the beat plays as monaural.';
  const since = s.startedAt ? timeFmt.format(s.startedAt) : '';
  if (cycling(s)) return `Since ${since}. ${s.prefs.minutes} on, ${s.prefs.breakMinutes} off.`;
  if (!s.endsAt) return `Since ${since}. Open-ended.`;
  const at = timeFmt.format(s.endsAt);
  if (s.mode === 'focus') return `Ends ${at}.`;
  if (s.prefs.keepPlaying) return s.prefs.endBell ? `Bell at ${at}, then it carries on.` : `Timer ends ${at}; the sound carries on.`;
  const rest = s.prefs.restMinutes > 0;
  if (s.prefs.endBell) return rest ? `Ends ${at}, then a bell and a rest.` : `Ends ${at}, then a bell.`;
  return rest ? `Ends ${at}, then a rest.` : `Ends ${at}.`;
}

/** The line that takes the place of the name and hint line while winding, resting or ending. */
export function restMessage(s: Snapshot): string | null {
  switch (s.phase) {
    case 'winding':
      return toSilence(s) ? 'Settling into silence…' : 'Settling into a low hum…';
    case 'resting':
      if (s.inBreak) return 'A break. The next block starts by itself.';
      if (s.timerDone) return 'The sit is over. Rest here; it fades out on its own.';
      return toSilence(s) ? 'Resting in silence. Resume when you’re ready.' : 'A low hum, nothing else. Stay as long as you like.';
    case 'ending':
      return 'Fading to silence.';
    default:
      return null;
  }
}

const NOTICE_WORD: Record<Notice['kind'], string> = {
  unplugged: 'Paused', interrupted: 'Paused', slept: 'Stopped', muted: 'Muted', back: 'Back', output: 'Output', softer: 'Softer', done: 'Done', update: 'Update',
};

function noticeSub(n: Notice, s: Snapshot): string | null {
  switch (n.kind) {
    case 'unplugged':
      return 'Went quiet at once. Nothing plays through the speakers.';
    case 'muted':
      return 'This clears itself when you unmute.';
    case 'back':
      return 'Fading back in.';
    case 'output':
      return onSpeakers(s) && s.params.beatOn && s.params.beatMode === 0 ? 'The beat plays as monaural on speakers.' : null;
    case 'softer':
      return 'Back to full when the call ends.';
    default:
      return n.sub ?? null;
  }
}

/** What pressing the light does now, and what it shows. */
interface LightState {
  /** Where things stand, for the accessible name: "14 minutes left". */
  status: string;
  /** What pressing does, for the accessible name: "Wind down". */
  action: string;
  hint: Hint;
  icon?: UiIcon;
  num?: number;
  unit?: string;
  press: 'go' | 'end' | 'none';
}

function lightState(s: Snapshot): LightState {
  const name = s.preset.name;
  if (s.paused) {
    const icon: UiIcon = s.notice?.kind === 'interrupted' ? 'speaker' : 'headphones';
    return { status: 'Paused', action: 'Resume', hint: [{ b: 'Resume.' }, { t: 'It fades back in gently.' }], icon, press: 'go' };
  }
  switch (s.phase) {
    case 'ready': {
      const m = s.prefs.minutes;
      return {
        status: m === null ? `${name}, open-ended` : `${name}, ${minutesWord(m)}`,
        action: m === null ? `Start ${name}, open-ended` : `Start ${name} for ${minutesWord(m)}`,
        // The name is just above; the hint says what pressing does.
        hint: m === null ? [{ b: 'Start,' }, { t: 'open-ended.' }, { k: 'Space' }] : [{ b: 'Start' }, { t: `for ${minutesWord(m)}.` }, { k: 'Space' }],
        icon: 'play',
        press: 'go',
      };
    }
    case 'playing': {
      const hint: Hint = [{ b: 'Wind down' }, { t: s.prefs.landTo === 'silence' ? 'to silence.' : 'to a low hum.' }, { k: 'esc' }];
      if (s.remaining === null) {
        const n = minutesIn(s);
        return { status: `Open-ended, ${minutesWord(n)} in`, action: 'Wind down', hint, num: n, unit: 'min in', press: 'go' };
      }
      const n = minutesLeft(s.remaining);
      if (cycling(s)) return { status: `${minutesWord(n)} to the break`, action: 'Wind down', hint, num: n, unit: 'to break', press: 'go' };
      return { status: `${minutesWord(n)} left`, action: 'Wind down', hint, num: n, unit: 'min left', press: 'go' };
    }
    case 'winding':
    case 'resting': {
      // A Focus break, or the rest after the timer (including the wind-down into it), shows its minutes.
      if (s.inBreak) {
        const n = s.restLeft !== null ? minutesLeft(s.restLeft) : undefined;
        return {
          status: n !== undefined ? `Break, ${minutesWord(n)}` : 'Break',
          action: 'Start the next block now',
          hint: [{ b: 'Start the next block' }, { t: 'now.' }, { k: 'Space' }],
          ...(n !== undefined ? { num: n, unit: 'min break' } : { icon: 'hum' as UiIcon }),
          press: 'go',
        };
      }
      if (s.timerDone) {
        const n = s.restLeft !== null ? minutesLeft(s.restLeft) : undefined;
        return {
          status: n !== undefined ? `Resting, ${minutesWord(n)} until the fade` : 'Resting',
          action: 'End now',
          hint: [{ b: 'End now' }, { t: 'with a slow fade.' }],
          ...(n !== undefined ? { num: n, unit: 'min rest' } : { icon: 'hum' as UiIcon }),
          press: 'end',
        };
      }
      const how = toSilence(s) ? 'in silence' : 'in a low hum';
      return {
        status: s.phase === 'winding' ? 'Winding down' : `Resting ${how}`,
        action: 'Resume',
        hint: [{ b: 'Resume.' }, { k: 'Space' }],
        icon: 'hum',
        press: 'go',
      };
    }
    case 'ending':
      return { status: 'Ending', action: '', hint: [{ t: 'Fading to silence.' }], icon: 'hum', press: 'none' };
  }
}

// ---------- the player ----------

type ChipSpec = { label: string; hint: () => Hint; build: (b: HTMLButtonElement) => void; onClick: (b: HTMLButtonElement) => void; className: string; key?: string };

const VOLUME_IDLE_MS = 4000;
/** A chip that has just appeared ignores clicks for this long. */
const CHIP_SETTLE_MS = 500;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Player {
  readonly el: HTMLElement;
  /** Where the full controls go, under the player. */
  readonly sheet: HTMLElement;
  firstRun = false;

  private readonly ripple: HTMLButtonElement;
  private readonly core: HTMLSpanElement;
  private readonly eyebrowBtn: HTMLButtonElement;
  private readonly eyebrowText: HTMLSpanElement;
  private readonly eyebrowWord: HTMLSpanElement;
  private readonly editedDot: HTMLSpanElement;
  private readonly shapeBtn: HTMLButtonElement;
  private readonly nameBtn: HTMLButtonElement;
  private readonly hintEl: HTMLDivElement;
  private readonly restEl: HTMLDivElement;
  private readonly actionsEl: HTMLDivElement;
  private readonly noticeEl: HTMLDivElement;
  private readonly volumeRow: HTMLDivElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly volumeValue: HTMLSpanElement;
  private readonly volumeIcon: HTMLSpanElement;
  private readonly hints: HintLine;
  private readonly main: HTMLDivElement;
  private readonly helpBtn: HTMLButtonElement;
  /** The Field guide's numbers beside the controls. */
  private readonly badgeLayer: HTMLDivElement;
  private sheetName: SheetName | null = null;

  private snap: Snapshot | null = null;
  private light: LightState | null = null;
  private glowKey = '';
  private minuteTimer: ReturnType<typeof setTimeout> | null = null;
  private chipsKey = '';
  private shownNotice: Notice | null = null;
  private leavingTimer: ReturnType<typeof setTimeout> | null = null;
  private volumeOpen = false;
  private volumeTimer: ReturnType<typeof setTimeout> | null = null;
  private volumeChip: HTMLButtonElement | null = null;
  private mini = false;
  private dragFrom: { x: number; y: number; id: number } | null = null;
  private dragged = false;

  constructor(private readonly session: Session, private readonly actions: PlayerActions) {
    // The hint line comes first: every control registers its hint with it.
    this.main = h('div', { class: 'player__main', 'data-tauri-drag-region': true });
    this.hintEl = h('div', { class: 'hint', 'aria-hidden': 'true', 'data-tauri-drag-region': 'deep' });
    this.hints = new HintLine(this.main, this.hintEl, () => [{ t: this.snap ? description(this.snap, this.firstRun) : '' }]);

    // The light
    this.core = h('span', { class: 'ripple__core' });
    this.ripple = h(
      'button',
      { class: 'ripple', type: 'button' },
      h('span', { class: 'ripple__disc', 'aria-hidden': 'true' }),
      h('span', { class: 'ripple__glow', 'aria-hidden': 'true' }, h('span', { class: 'ripple__halo' })),
      h('span', { class: 'ripple__ring', 'aria-hidden': 'true' }),
      h('span', { class: 'ripple__ring ripple__ring--inner', 'aria-hidden': 'true' }),
      this.core,
    );
    this.bindLight();

    // Eyebrow: the sound menu at rest, a status word otherwise
    this.eyebrowWord = h('span');
    this.editedDot = h('span', { class: 'eyebrow__dot', 'aria-hidden': 'true' });
    this.eyebrowBtn = h('button', { class: 'eyebrow', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, this.eyebrowWord, this.editedDot, uiIcon('chevron-down'));
    this.eyebrowText = h('span', { class: 'eyebrow' });
    this.eyebrowBtn.addEventListener('click', () => actions.toggleSheet('sound', this.eyebrowBtn));
    this.hints.add(this.eyebrowBtn, () => [{ b: 'Choose a sound.' }, { k: '[' }, { k: ']' }, { t: 'step through.' }]);

    // Tools: shown when the pointer is over the window or focus is inside it
    this.shapeBtn = this.tool('shape', 'Shape the sound', () => actions.toggleSheet('shape', this.shapeBtn), () => [{ b: 'Shape:' }, { t: 'warmer, stiller, more rain.' }]);
    this.shapeBtn.setAttribute('aria-expanded', 'false');
    const visualsBtn = this.tool('visuals', 'Open visuals', () => actions.openVisuals(), () => [{ b: 'Visuals,' }, { t: isMac ? 'in their own window.' : 'in a window.' }, { k: keys('⇧⌘V') }]);
    this.helpBtn = this.tool('help', 'Field guide', () => actions.toggleSheet('guide', this.helpBtn), () => [{ b: 'Field guide.' }, { t: 'What everything does.' }, { k: '?' }]);
    this.helpBtn.setAttribute('aria-expanded', 'false');
    this.helpBtn.setAttribute('aria-keyshortcuts', '?');
    const miniBtn = this.tool('mini', 'Shrink to the light', () => actions.toggleMini(), () => [{ b: isMac ? 'Mini player:' : 'Mini:' }, { t: 'just the light.' }, { k: keys('⌘M') }]);
    miniBtn.setAttribute('aria-keyshortcuts', 'Meta+M');
    const tools = h('div', { class: 'player__tools' }, this.shapeBtn, visualsBtn, this.helpBtn, miniBtn);
    const top = h('div', { class: 'player__top', 'data-tauri-drag-region': true }, this.eyebrowBtn, this.eyebrowText, tools);

    // What is playing, and the hint line
    this.nameBtn = h('button', { class: 'player__name', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    this.nameBtn.addEventListener('click', () => actions.toggleSheet('sound', this.nameBtn));
    this.hints.add(this.nameBtn, () => [{ b: 'Choose a sound.' }, { k: '[' }, { k: ']' }, { t: 'step through.' }]);
    this.restEl = h('div', { class: 'rest-message', role: 'status', 'data-tauri-drag-region': 'deep' });
    this.actionsEl = h('div', { class: 'player__actions', 'data-tauri-drag-region': true });
    this.noticeEl = h('div', { class: 'notice', role: 'status', 'aria-live': 'polite', 'data-tauri-drag-region': 'deep' });

    // Volume, adjusting: a slider in place of the chips
    this.volumeIcon = h('span', { class: 'volume-row__icon', 'aria-hidden': 'true' });
    this.volumeInput = h('input', { class: 'range', type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Volume' });
    this.volumeValue = h('span', { class: 'volume-row__value num', 'aria-hidden': 'true' });
    this.volumeRow = h('div', { class: 'volume-row', hidden: true }, this.volumeIcon, this.volumeInput, this.volumeValue);
    this.bindVolume();

    const body = h('div', { class: 'player__body', 'data-tauri-drag-region': true }, top, this.nameBtn, this.hintEl, this.restEl, this.noticeEl, this.actionsEl, this.volumeRow);
    this.badgeLayer = h('div', { class: 'badges', 'aria-hidden': 'true', hidden: true });
    const main = this.main;
    main.append(this.ripple, body, this.badgeLayer);
    this.sheet = h('div', { class: 'player__sheet' });
    const ground = h('div', { class: 'player__ground', 'aria-hidden': 'true' });
    this.el = h('section', { class: 'player', 'aria-label': 'Tonewell player' }, ground, main, this.sheet, this.hints.descs);

    main.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      actions.contextMenu(main, { x: e.clientX, y: e.clientY });
    });
  }

  // ---------- building blocks ----------

  private tool(icon: UiIcon, label: string, onClick: () => void, hint: () => Hint): HTMLButtonElement {
    const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': label }, uiIcon(icon));
    b.addEventListener('click', onClick);
    this.hints.add(b, hint);
    return b;
  }

  // ---------- the light ----------

  private bindLight(): void {
    const r = this.ripple;
    r.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragged = false;
      this.dragFrom = this.mini ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    });
    r.addEventListener('pointermove', (e) => {
      // In mini mode the light is also the handle: a press that moves becomes a drag.
      if (!this.dragFrom || this.dragged || e.pointerId !== this.dragFrom.id) return;
      if (Math.hypot(e.clientX - this.dragFrom.x, e.clientY - this.dragFrom.y) < 4) return;
      this.dragged = true;
      this.actions.startDrag();
    });
    r.addEventListener('pointerup', () => (this.dragFrom = null));
    r.addEventListener('click', (e) => {
      if (this.dragged) {
        this.dragged = false;
        e.preventDefault();
        return;
      }
      if (this.mini) {
        this.actions.toggleMini();
        return;
      }
      const l = this.light;
      if (!l || l.press === 'none') return;
      if (l.press === 'end') this.session.end();
      else void this.session.go();
    });
    this.hints.add(r, () => (this.mini ? [{ b: 'Open the player.' }, { k: keys('⌘M') }] : (this.light?.hint ?? [])));
  }

  private paintLight(s: Snapshot): void {
    const l = lightState(s);
    this.light = l;
    this.ripple.dataset.state = s.paused ? 'paused' : s.phase;
    // Not pressable while ending, but still focusable, so keyboard focus never falls out of the player.
    this.ripple.setAttribute('aria-disabled', String(!this.mini && l.press === 'none'));
    this.ripple.setAttribute('aria-label', this.mini ? `${l.status}. Open the player` : l.action ? `${l.status}. ${l.action}` : l.status);
    // The content cross-fades when what it shows changes (play, minutes, hum); a new minute
    // just changes the number, with no animation, so the light never dips.
    const kind = l.icon ? `i:${l.icon}` : `n:${l.unit}`;
    if (this.core.dataset.kind !== kind) {
      this.core.dataset.kind = kind;
      const inner = l.icon
        ? h('span', { class: 'ripple__content' }, uiIcon(l.icon))
        : h('span', { class: 'ripple__content' }, h('span', { class: 'ripple__num' }, String(l.num)), h('span', { class: 'ripple__unit' }, l.unit ?? ''));
      this.core.replaceChildren(inner);
      this.fadeIn(inner, 240);
    } else if (!l.icon) {
      const num = this.core.querySelector('.ripple__num');
      if (num && num.textContent !== String(l.num)) num.textContent = String(l.num);
    }
    // The glow breathes with the drone's filter sweep. Its phase is set once, when playing
    // begins (or the sweep changes): resetting a running animation would make it jump.
    const glowKey = s.phase === 'playing' ? `on:${s.params.sweepPeriod}` : 'off';
    if (glowKey !== this.glowKey) {
      if (glowKey !== 'off') {
        this.ripple.style.setProperty('--sweep-period', `${s.params.sweepPeriod}s`);
        this.ripple.style.setProperty('--sweep-delay', `${-s.sweepPhase}s`);
      }
      this.glowKey = glowKey;
    }
  }

  // ---------- render ----------

  render(s: Snapshot): void {
    this.snap = s;
    const focusWasIn = this.el.contains(document.activeElement);
    this.paintLight(s);

    // Eyebrow
    const notice = s.notice;
    const atRest = !notice && (s.phase === 'ready' || (s.phase === 'playing' && !cycling(s)));
    this.eyebrowBtn.hidden = !atRest;
    this.eyebrowText.hidden = atRest;
    const modeName = s.mode === 'meditate' ? 'Meditate' : 'Focus';
    this.eyebrowWord.textContent = modeName;
    this.eyebrowBtn.setAttribute('aria-label', `${modeName}${s.edited ? ', changed' : ''}: choose a sound`);
    this.editedDot.hidden = !s.edited;
    if (!atRest) {
      let word: string;
      if (notice) word = NOTICE_WORD[notice.kind];
      else if (s.phase === 'playing') word = `${modeName} · block ${s.block}`;
      else if (s.phase === 'winding') word = 'Winding down';
      else if (s.phase === 'resting') word = s.inBreak ? 'Break' : 'Resting';
      else word = 'Ending';
      this.eyebrowText.replaceChildren(...(notice?.kind === 'softer' ? [uiIcon('mic')] : []), word);
    }

    this.nameBtn.textContent = s.preset.name;
    this.nameBtn.setAttribute('aria-label', `Sound: ${s.preset.name}${s.edited ? ', changed' : ''}. Choose a sound`);

    // Notices take the place of the name, hint line and chips; leaving, they fade first.
    if (notice) {
      if (this.leavingTimer) clearTimeout(this.leavingTimer);
      this.leavingTimer = null;
      this.noticeEl.removeAttribute('data-leaving');
      if (notice !== this.shownNotice) this.paintNotice(notice, s);
    } else if (this.shownNotice && !this.leavingTimer) {
      this.noticeEl.dataset.leaving = '';
      this.leavingTimer = setTimeout(() => {
        this.leavingTimer = null;
        this.shownNotice = null;
        this.noticeEl.removeAttribute('data-leaving');
        if (this.snap) this.render(this.snap);
        // The content comes back the way the notice left: slowly. The eyebrow just changes its word.
        for (const el of [this.nameBtn, this.hintEl, this.restEl, this.actionsEl]) if (!el.hidden) this.fadeIn(el, 600);
      }, reducedMotion() ? 0 : 600);
    }
    const showingNotice = !!this.shownNotice;
    const message = showingNotice ? null : restMessage(s);
    this.noticeEl.hidden = !showingNotice;
    this.restEl.hidden = message === null;
    // A status region: only touch it when the words change, so it isn't announced again each minute.
    if (this.restEl.textContent !== (message ?? '')) this.restEl.textContent = message ?? '';
    this.nameBtn.hidden = showingNotice || message !== null;
    this.hintEl.hidden = showingNotice || message !== null;

    if (showingNotice) {
      this.actionsEl.hidden = true;
      this.closeVolume(false);
    } else {
      this.actionsEl.hidden = this.volumeOpen;
      this.paintChips(s);
    }
    if (this.volumeOpen || !this.volumeRow.hidden) this.paintVolume(s);

    this.hints.refresh();
    if (!this.badgeLayer.hidden) this.placeBadges();
    this.scheduleMinute(s);

    // If what had keyboard focus just went away (chips replaced by a notice, the volume row
    // closing), keep focus in the player: on the notice's first button, or the light.
    const active = document.activeElement as HTMLElement | null;
    if (focusWasIn && (!active || active === document.body || !this.el.contains(active) || active.closest('[hidden]'))) {
      ((this.shownNotice && this.noticeEl.querySelector('button')) || this.ripple).focus({ preventScroll: true });
    }
  }

  private paintNotice(n: Notice, s: Snapshot): void {
    this.shownNotice = n;
    const title = h('div', { class: n.text.length > 32 ? 'notice__title notice__title--small' : 'notice__title' }, n.text);
    const sub = noticeSub(n, s);
    const buttons = (n.actions ?? []).map((a, i) => {
      const b = h('button', { class: i === 0 ? 'btn btn--primary' : 'btn', type: 'button' }, a.label);
      const born = performance.now();
      b.addEventListener('click', () => {
        if (performance.now() - born >= CHIP_SETTLE_MS) void this.session.noticeAction(a.id);
      });
      return b;
    });
    this.noticeEl.replaceChildren(title, ...(sub ? [h('div', { class: 'notice__sub' }, sub)] : []), ...(buttons.length ? [h('div', { class: 'notice__actions' }, ...buttons)] : []));
    this.fadeIn(this.noticeEl, 600);
  }

  private fadeIn(el: Element | null, ms: number): void {
    if (!el || reducedMotion()) return;
    el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'cubic-bezier(0, 0, 0.2, 1)' });
  }

  /** The two chips, rebuilt only when what they are changes (so focus survives a re-render). */
  private paintChips(s: Snapshot): void {
    const specs = this.chipSpecs(s);
    const key = specs.map((c) => `${c.className}|${c.key ?? c.label}`).join('/');
    if (key !== this.chipsKey) {
      this.chipsKey = key;
      const hadFocus = this.actionsEl.contains(document.activeElement);
      const index = hadFocus ? [...this.actionsEl.children].indexOf(document.activeElement as Element) : -1;
      this.hints.forgetWithin(this.actionsEl);
      this.volumeChip = null;
      this.actionsEl.replaceChildren(
        ...specs.map((c) => {
          const b = h('button', { class: c.className, type: 'button' });
          const born = performance.now();
          b.addEventListener('click', () => {
            // A chip that just took the place of another ignores the second half of a double-click.
            if (performance.now() - born < CHIP_SETTLE_MS) return;
            c.onClick(b);
          });
          this.hints.add(b, c.hint);
          return b;
        }),
      );
      if (index >= 0) (this.actionsEl.children[Math.min(index, this.actionsEl.children.length - 1)] as HTMLElement | undefined)?.focus();
    }
    [...this.actionsEl.children].forEach((b, i) => {
      const spec = specs[i];
      b.setAttribute('aria-label', spec.label);
      spec.build(b as HTMLButtonElement);
    });
  }

  private chipSpecs(s: Snapshot): ChipSpec[] {
    const session = this.session;
    // The length and beat chips open their sheets, and close them again.
    const sheetChip = (name: SheetName) => (b: HTMLButtonElement) => this.actions.toggleSheet(name, b);
    const opens = (b: HTMLButtonElement, name: SheetName) => {
      b.dataset.sheet = name;
      b.setAttribute('aria-haspopup', 'dialog');
      b.setAttribute('aria-expanded', String(sheetIs(this.sheetName, name)));
    };
    const resume: ChipSpec = {
      className: 'btn btn--primary', label: 'Resume', key: 'resume',
      hint: () => [{ b: 'Resume.' }, { t: 'It fades back in gently.' }],
      build: (b) => (b.textContent = 'Resume'),
      onClick: () => void session.resume(),
    };
    const end = (withKey: boolean, word = 'End'): ChipSpec => ({
      className: 'btn', label: word, key: `${word}:${withKey}`,
      hint: () => (word === 'End now' ? [{ b: 'End now' }, { t: 'with a slow fade.' }] : [{ b: 'End' }, { t: 'with a slow fade to silence.' }]),
      build: (b) => b.replaceChildren(word, ...(withKey ? [h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, 'esc')] : [])),
      onClick: () => session.end(),
    });
    if (s.paused) return [];
    switch (s.phase) {
      case 'ready':
        return [
          {
            className: 'chip', label: `Length: ${lengthWords(s.prefs.minutes)}`, key: 'length',
            hint: () => {
              const m = this.snap?.prefs.minutes ?? null;
              return [{ b: m === null ? 'Open-ended.' : `${minutesWord(m)}.` }, { t: 'Length and more.' }, { k: '+' }, { k: '−' }];
            },
            build: (b) => {
              const m = s.prefs.minutes;
              opens(b, 'session');
              b.replaceChildren(uiIcon(m === null ? 'open-ended' : 'clock'), m === null ? 'Open-ended' : h('span', {}, h('span', { class: 'num' }, String(m)), ' min'));
            },
            onClick: sheetChip('session'),
          },
          {
            className: 'chip', label: `Beat: ${beatLong(s.params)}`, key: 'beat',
            hint: () => {
              const h = beatHint(this.snap?.params ?? s.params);
              return [{ b: h.b }, { t: h.t }, { k: keys('⌘B') }];
            },
            build: (b) => {
              opens(b, 'beat');
              b.replaceChildren(uiIcon(s.params.beatOn ? 'beat' : 'beat-off'), beatName(s.params));
            },
            onClick: sheetChip('beat'),
          },
        ];
      case 'playing':
        return [
          {
            className: 'chip chip--action', label: 'Wind down', key: 'wind',
            hint: () => [{ b: 'Wind down' }, { t: (this.snap?.prefs.landTo ?? 'hum') === 'silence' ? 'to silence.' : 'to a low hum.' }, { k: 'esc' }],
            build: (b) => {
              b.setAttribute('aria-keyshortcuts', 'Escape');
              b.replaceChildren('Wind down', h('kbd', { class: 'kbd', 'aria-hidden': 'true' }, 'esc'));
            },
            onClick: () => void session.windDown(),
          },
          {
            className: 'chip', label: this.volumeLabel(s), key: 'volume',
            hint: () => [{ b: 'Volume.' }, { k: keys('⌘↑') }, { k: keys('⌘↓') }, ...(isMac ? [{ t: 'from anywhere.' }] : [])],
            build: (b) => {
              this.volumeChip = b;
              b.setAttribute('aria-haspopup', 'true');
              b.replaceChildren(uiIcon(this.outputIcon(s)), h('span', { class: 'num' }, `${Math.round(s.volume * 100)}%`));
            },
            onClick: () => this.openVolume(true),
          },
        ];
      case 'winding':
      case 'resting':
        if (s.inBreak) {
          return [
            {
              ...resume, label: 'Start now', key: 'start-now',
              hint: () => [{ b: 'Start now.' }, { t: 'The next block begins.' }],
              build: (b) => (b.textContent = 'Start now'),
            },
            end(false),
          ];
        }
        if (s.timerDone) return [end(false, 'End now')];
        // Esc ends from here, so End shows the key; while winding, Esc's second press waits a second.
        return [resume, end(s.phase === 'resting')];
      case 'ending':
        return [];
    }
  }

  // ---------- volume ----------

  private outputIcon(s: Snapshot): UiIcon {
    if (s.output?.kind === 'speakers') return 'speaker';
    if (s.output?.kind === 'headphones') return 'headphones';
    return 'volume';
  }

  private volumeLabel(s: Snapshot): string {
    const where = s.output?.kind === 'speakers' ? ', on speakers' : s.output?.kind === 'headphones' ? ', on headphones' : '';
    return `Volume, ${Math.round(s.volume * 100)} percent${where}`;
  }

  private bindVolume(): void {
    this.volumeInput.addEventListener('input', () => {
      this.session.setVolume(Number(this.volumeInput.value) / 100);
      this.armVolumeClose();
    });
    this.volumeRow.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.closeVolume(true);
      }
    });
    this.volumeRow.addEventListener('pointerdown', () => this.armVolumeClose());
  }

  private paintVolume(s: Snapshot): void {
    const v = Math.round(s.volume * 100);
    if (document.activeElement !== this.volumeInput) this.volumeInput.value = String(v);
    this.volumeInput.style.setProperty('--v', String(Number(this.volumeInput.value) / 100));
    const where = s.output?.kind === 'speakers' ? ', on speakers' : s.output?.kind === 'headphones' ? ', on headphones' : '';
    this.volumeInput.setAttribute('aria-valuetext', `${this.volumeInput.value} percent${where}`);
    this.volumeValue.textContent = `${this.volumeInput.value}%`;
    const icon = this.outputIcon(s);
    if (this.volumeIcon.dataset.icon !== icon) {
      this.volumeIcon.dataset.icon = icon;
      this.volumeIcon.replaceChildren(uiIcon(icon));
    }
  }

  /** Open the slider row in place of the chips; `focus` moves the keyboard to it. */
  openVolume(focus: boolean): void {
    if (!this.snap || this.shownNotice || this.mini) return;
    if (!this.volumeOpen) {
      this.volumeOpen = true;
      this.volumeRow.hidden = false;
      this.actionsEl.hidden = true;
      this.paintVolume(this.snap);
      this.fadeIn(this.volumeRow, 140);
    }
    if (focus) this.volumeInput.focus();
    this.armVolumeClose();
  }

  private armVolumeClose(): void {
    if (this.volumeTimer) clearTimeout(this.volumeTimer);
    this.volumeTimer = setTimeout(() => {
      // Never while the slider is held.
      if (this.volumeRow.matches(':active')) return this.armVolumeClose();
      this.closeVolume(this.volumeRow.contains(document.activeElement));
    }, VOLUME_IDLE_MS);
  }

  private closeVolume(returnFocus: boolean): void {
    if (this.volumeTimer) clearTimeout(this.volumeTimer);
    this.volumeTimer = null;
    if (!this.volumeOpen) return;
    this.volumeOpen = false;
    this.volumeRow.hidden = true;
    this.actionsEl.hidden = !!this.shownNotice;
    if (this.snap) this.paintChips(this.snap);
    this.fadeIn(this.actionsEl, 140);
    if (returnFocus) (this.volumeChip ?? (this.actionsEl.querySelector('button') as HTMLElement | null))?.focus();
  }

  /** Esc closes the volume row before it reaches the stop ladder. Returns true if it did. */
  handleEscape(): boolean {
    if (!this.volumeOpen) return false;
    this.closeVolume(true);
    return true;
  }

  // ---------- modes of the window ----------

  /** The light: where focus goes when nothing better is left. */
  lightButton(): HTMLButtonElement {
    return this.ripple;
  }

  /** Which sheet is open under the player: its opener shows it, and says so to VoiceOver. */
  setSheet(name: SheetName | null): void {
    this.sheetName = name;
    this.shapeBtn.setAttribute('aria-expanded', String(sheetIs(name, 'shape')));
    this.helpBtn.setAttribute('aria-expanded', String(name === 'guide'));
    for (const b of [this.eyebrowBtn, this.nameBtn]) b.setAttribute('aria-expanded', String(name === 'sound'));
    for (const b of this.actionsEl.querySelectorAll<HTMLButtonElement>('[data-sheet]')) {
      b.setAttribute('aria-expanded', String(sheetIs(name, b.dataset.sheet as SheetName)));
    }
  }

  /** The Field guide's numbers, beside (never over) the controls they describe. */
  setBadges(on: boolean): void {
    if (on && this.badgeLayer.hidden) {
      // Made once, faded in once; afterwards they only move.
      this.badgeLayer.replaceChildren(...[1, 2, 3, 4, 5, 6].map((n) => h('span', { class: 'badge' }, String(n))));
    }
    this.badgeLayer.hidden = !on;
    if (on) this.placeBadges();
  }

  private placeBadges(): void {
    const box = this.main.getBoundingClientRect();
    const at = (el: Element | null, side: 'left' | 'right' | 'corner'): { x: number; y: number } | null => {
      if (!el || el.closest('[hidden]')) return null;
      const r = el.getBoundingClientRect();
      if (!r.width) return null;
      const y = side === 'corner' ? r.top + 2 : r.top + r.height / 2 - 9;
      const x = side === 'left' ? r.left - 21 : side === 'right' ? r.right + 3 : r.left + 2;
      return { x: x - box.left, y: y - box.top };
    };
    const chips = this.actionsEl.querySelectorAll('[data-sheet]');
    const spots = [
      at(this.ripple, 'corner'),
      at(this.eyebrowBtn.hidden ? this.eyebrowText : this.eyebrowBtn, 'left'),
      at(this.nameBtn, 'left'),
      at(chips[0] ?? null, 'left'),
      at(chips[1] ?? null, 'right'),
      at(this.shapeBtn.parentElement, 'left'),
    ];
    spots.forEach((p, i) => {
      const badge = this.badgeLayer.children[i] as HTMLElement | undefined;
      if (!badge) return;
      badge.hidden = !p;
      if (p) badge.style.transform = `translate(${Math.round(p.x)}px,${Math.round(p.y)}px)`;
    });
  }

  setMini(on: boolean): void {
    this.mini = on;
    this.closeVolume(false);
    // In mini mode the rim of the light moves the window, as the player's background does.
    for (const ring of this.ripple.querySelectorAll('.ripple__ring')) {
      if (on) ring.setAttribute('data-tauri-drag-region', '');
      else ring.removeAttribute('data-tauri-drag-region');
    }
    if (this.snap) this.render(this.snap);
  }

  /** Re-render when the light's minute changes, and no more often. */
  private scheduleMinute(s: Snapshot): void {
    if (this.minuteTimer) clearTimeout(this.minuteTimer);
    this.minuteTimer = null;
    let seconds: number | null = null;
    if (s.phase === 'playing') {
      if (s.remaining !== null) seconds = s.remaining % 60 || 60;
      else if (s.startedAt) seconds = 60 - (((Date.now() - s.startedAt.getTime()) / 1000) % 60);
    } else if (s.phase === 'resting' && s.restLeft !== null) {
      seconds = s.restLeft % 60 || 60;
    }
    if (seconds === null) return;
    this.minuteTimer = setTimeout(() => this.render(this.session.snapshot()), Math.max(1, seconds) * 1000 + 60);
  }
}
