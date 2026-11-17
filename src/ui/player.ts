// The mini player: the well, the mode, the preset, the time line, the stop
// ladder, and three scales (Volume, Warmth, Drift) plus the Beat chip.
// Only text and color change between states; the layout never moves.

import { toSlider, fromSlider, formatParam } from '../audio/params';
import type { Session, Snapshot } from '../session/session';
import { ICONS, h, icon, radios, scale } from './controls';
import { check, item, popup, sep, submenu, type MenuNode } from './menu';
import { Well } from './well';
import { BEAT_CHOICES, beatLong, beatMenuNodes, beatShort, choiceParams } from './beats';

export interface PlayerActions {
  toggleExpanded(): void;
  /** Open the panel (never closes it). */
  expand(): void;
  openVisuals(): void;
  openLearn(card?: string): void;
  openSettings(): void;
  hideWindow(): void;
  contextMenu(anchor: HTMLElement): void;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export const LENGTHS: Array<number | null> = [10, 15, 20, 30, 45, 60, 90, null];

export function lengthLabel(m: number | null): string {
  return m === null ? 'Open' : `${m} min`;
}

export function lengthMenu(s: Snapshot): MenuNode[] {
  return [
    ...LENGTHS.map((m) => check(`length:${m ?? 'open'}`, m === null ? 'Open-ended' : `${m} minutes`, s.prefs.minutes === m)),
    sep,
    check('keep-playing', 'Keep playing after', s.prefs.keepPlaying),
  ];
}

export function beatMenu(s: Snapshot): MenuNode[] {
  return beatMenuNodes(s.params, s.mode);
}

export function presetMenu(session: Session, s: Snapshot): MenuNode[] {
  const list = session.presetsFor(s.mode);
  const builtin = list.filter((p) => p.builtin);
  const mine = list.filter((p) => !p.builtin);
  const nodes: MenuNode[] = builtin.map((p) => check(`preset:${p.id}`, p.name, p.id === s.preset.id));
  if (mine.length) {
    nodes.push(sep, ...mine.map((p) => check(`preset:${p.id}`, p.name, p.id === s.preset.id)));
  }
  nodes.push(sep, item('preset-save-as', 'Save as new preset…'));
  if (!s.preset.builtin) {
    nodes.push(
      submenu(`“${s.preset.name}”`, [
        item('preset-save', 'Save changes', s.edited),
        item('preset-rename', 'Rename…'),
        item('preset-duplicate', 'Duplicate'),
        item('preset-delete', 'Delete'),
      ]),
    );
  }
  if (s.edited) nodes.push(item('preset-revert', 'Revert to saved'));
  return nodes;
}

/** Handle ids shared by the pop-up menus and the menu-bar menu. Returns false if unknown. */
export async function handleMenuId(id: string, session: Session, actions: PlayerActions, ask: (q: string, def: string) => Promise<string | null>): Promise<boolean> {
  const s = session.snapshot();
  if (id.startsWith('length:')) {
    const v = id.slice(7);
    session.setLength(v === 'open' ? null : Number(v));
  } else if (id === 'keep-playing') {
    session.setPrefs({ keepPlaying: !s.prefs.keepPlaying });
  } else if (id.startsWith('beat:')) {
    const v = id.slice(5);
    if (v === 'more') {
      actions.expand();
      document.dispatchEvent(new CustomEvent('tonewell:panel-tab', { detail: 'beat' }));
    } else if (v === 'learn') actions.openLearn('brainwave-bands');
    else if (v === 'off') session.setParam('beatOn', 0);
    else {
      const choice = BEAT_CHOICES.find((c) => c.id === v);
      if (choice) session.setParams(choiceParams(choice));
    }
  } else if (id.startsWith('preset:')) {
    session.setPreset(id.slice(7));
  } else if (id === 'preset-save-as') {
    const name = await ask('Name your preset', `${s.preset.name} (mine)`);
    if (name) session.saveAsPreset(name);
  } else if (id === 'preset-save') session.savePreset();
  else if (id === 'preset-rename') {
    const name = await ask('Rename preset', s.preset.name);
    if (name) session.renamePreset(s.preset.id, name);
  } else if (id === 'preset-duplicate') session.duplicatePreset(s.preset.id);
  else if (id === 'preset-delete') session.deletePreset(s.preset.id);
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

export class Player {
  readonly el: HTMLElement;
  private readonly well: Well;
  private readonly modeRadios: ReturnType<typeof radios<'meditate' | 'focus'>>;
  private readonly presetBtn: HTMLButtonElement;
  private readonly presetName: HTMLSpanElement;
  private readonly editedMark: HTMLSpanElement;
  private readonly timeBtn: HTMLButtonElement;
  private readonly timeText: HTMLSpanElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly stopText: HTMLSpanElement;
  private readonly hint: HTMLSpanElement;
  private readonly rowD: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly message: HTMLElement;
  private readonly messageText: HTMLParagraphElement;
  private readonly messageActions: HTMLElement;
  private readonly volume;
  private readonly warmth;
  private readonly drift;
  private readonly beatBtn: HTMLButtonElement;
  private readonly beatValue: HTMLSpanElement;
  private readonly beatGlyph: HTMLSpanElement;
  private readonly expandBtn: HTMLButtonElement;
  private minuteTimer: ReturnType<typeof setTimeout> | null = null;
  firstRun = false;

  constructor(private readonly session: Session, actions: PlayerActions, ask: (q: string, def: string) => Promise<string | null>) {
    this.well = new Well({ go: () => void session.go(), wind: (d) => session.wind(d) });

    const close = h('button', { class: 'icon-btn player-close', 'aria-label': 'Hide window (the sound keeps playing)', title: 'Hide' });
    close.append(icon(ICONS.close));
    close.addEventListener('click', () => actions.hideWindow());

    this.modeRadios = radios<'meditate' | 'focus'>('Mode', [
      { value: 'meditate', label: 'Meditate' },
      { value: 'focus', label: 'Focus' },
    ], session.mode, (m) => session.setMode(m));
    this.modeRadios.el.classList.add('mode-radios');

    const visualsBtn = h('button', { class: 'icon-btn', 'aria-label': 'Open visuals', title: 'Visuals' });
    visualsBtn.append(icon(ICONS.visuals));
    visualsBtn.addEventListener('click', () => actions.openVisuals());
    this.expandBtn = h('button', { class: 'icon-btn', 'aria-label': 'Show all controls', 'aria-expanded': 'false', title: 'All controls' });
    this.expandBtn.append(icon(ICONS.expand));
    this.expandBtn.addEventListener('click', () => actions.toggleExpanded());
    const rowA = h('div', { class: 'row-a', 'data-tauri-drag-region': true }, this.modeRadios.el, h('span', { class: 'spacer', 'data-tauri-drag-region': true }), visualsBtn, this.expandBtn);

    this.presetName = h('span', { class: 'preset-name voice' });
    this.editedMark = h('span', { class: 'edited-mark' }, 'edited');
    const chev = icon(ICONS.chevron);
    chev.classList.add('chev');
    this.presetBtn = h('button', { class: 'preset-btn', 'aria-haspopup': 'menu' }, this.presetName, this.editedMark, chev);
    this.presetBtn.addEventListener('click', async () => {
      const id = await popup(presetMenu(session, session.snapshot()), this.presetBtn);
      if (id) await handleMenuId(id, session, actions, ask);
    });

    this.timeText = h('span', { class: 'time-text' });
    const chev2 = icon(ICONS.chevron);
    chev2.classList.add('chev');
    this.timeBtn = h('button', { class: 'time-btn', 'aria-haspopup': 'menu' }, this.timeText, chev2);
    this.timeBtn.addEventListener('click', async () => {
      const id = await popup(lengthMenu(session.snapshot()), this.timeBtn);
      if (id) await handleMenuId(id, session, actions, ask);
    });
    this.stopText = h('span', { class: 'stop-text' });
    this.stopBtn = h('button', { class: 'btn stop-btn' }, this.stopText, h('span', { class: 'kbd', 'aria-hidden': 'true' }, 'esc'));
    // The button acts at once (Esc has a one-second guard against key repeat; a click doesn't need it).
    this.stopBtn.addEventListener('click', () => {
      if (session.phase === 'playing') void session.windDown();
      else if (session.phase === 'winding' || session.phase === 'resting') session.end();
    });
    this.hint = h('span', { class: 'first-hint' }, 'Headphones on, then start.');
    const rowC = h('div', { class: 'row-c', 'data-tauri-drag-region': true }, this.timeBtn, h('span', { class: 'stop-slot', 'data-tauri-drag-region': true }, this.stopBtn, this.hint));

    // The background of the player is the handle for moving the window.
    const content = h('div', { class: 'player-content', 'data-tauri-drag-region': true }, rowA, this.presetBtn, rowC);

    const s = session.snapshot();
    this.volume = scale({
      label: 'Volume', value: s.volume,
      valueText: (p) => `${Math.round(p * 100)}%`,
      onInput: (p) => session.setVolume(p),
    });
    this.warmth = scale({
      label: 'Warmth', value: toSlider('warmth', s.params.warmth), bipolar: true, resetTo: 0.5,
      valueText: (p) => formatParam('warmth', fromSlider('warmth', p)),
      onInput: (p) => session.setParam('warmth', fromSlider('warmth', p)),
    });
    this.drift = scale({
      label: 'Drift', value: toSlider('motion', s.params.motion), bipolar: true, resetTo: 0.5,
      valueText: (p) => formatParam('motion', fromSlider('motion', p)),
      onInput: (p) => session.setParam('motion', fromSlider('motion', p)),
    });
    this.beatValue = h('span', { class: 'beat-value' });
    this.beatGlyph = h('span', { class: 'beat-glyph', 'aria-hidden': 'true' });
    this.beatBtn = h('button', { class: 'beat-chip', 'aria-haspopup': 'menu' }, h('span', { class: 'beat-label' }, 'Beat'), h('span', { class: 'beat-line' }, this.beatValue, this.beatGlyph));
    this.beatBtn.addEventListener('click', async () => {
      const id = await popup(beatMenu(session.snapshot()), this.beatBtn);
      if (id) await handleMenuId(id, session, actions, ask);
    });
    this.controls = h('div', { class: 'row-d-controls' }, this.volume.el, this.warmth.el, this.drift.el, this.beatBtn);
    this.messageText = h('p', { class: 'row-d-text' });
    this.messageActions = h('div', { class: 'row-d-actions' });
    this.message = h('div', { class: 'row-d-message', 'aria-live': 'polite' }, this.messageText, this.messageActions);
    this.controls.setAttribute('data-tauri-drag-region', '');
    this.rowD = h('div', { class: 'row-d', 'data-tauri-drag-region': true }, this.controls, this.message);

    this.el = h('section', { class: 'player', 'aria-label': 'Tonewell player', 'data-tauri-drag-region': true }, close, this.well.el, content, this.rowD);
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      actions.contextMenu(this.el);
    });
  }

  setExpanded(on: boolean): void {
    this.expandBtn.setAttribute('aria-expanded', String(on));
    this.expandBtn.setAttribute('aria-label', on ? 'Hide controls' : 'Show all controls');
    this.expandBtn.replaceChildren(icon(on ? ICONS.collapse : ICONS.expand));
  }

  render(s: Snapshot): void {
    this.well.render(s);
    this.modeRadios.set(s.mode);
    this.presetName.textContent = s.preset.name;
    this.presetBtn.setAttribute('aria-label', `Preset: ${s.preset.name}${s.edited ? ', edited' : ''}. Choose a preset`);
    this.editedMark.hidden = !s.edited;

    // Time line
    let time: string;
    if (s.phase === 'ready') time = lengthLabel(s.prefs.minutes);
    else if (s.phase === 'winding') time = 'Winding down…';
    else if (s.phase === 'resting') time = s.inBreak ? 'Break' : 'Resting';
    else if (s.phase === 'ending') time = 'Ending…';
    else if (s.endsAt) time = `${s.inBreak ? 'Break until' : 'Ends'} ${timeFmt.format(s.endsAt)}`;
    else time = s.startedAt ? `Since ${timeFmt.format(s.startedAt)}` : 'Open';
    this.timeText.textContent = time;
    this.timeBtn.setAttribute('aria-label', `${time}. Change length`);

    // The stop ladder
    const running = s.phase !== 'ready';
    this.stopBtn.style.visibility = running ? 'visible' : 'hidden';
    this.stopText.textContent = s.phase === 'playing' ? 'Wind down' : 'End';
    this.stopBtn.disabled = s.phase === 'ending';
    this.hint.hidden = running || !this.firstRun;

    // Row D: controls, or a message in their place
    let message: string | null = null;
    let actions: Array<{ id: string; label: string }> = [];
    if (s.notice) {
      message = s.notice.text;
      actions = s.notice.actions ?? [];
    } else if (s.phase === 'resting' || s.phase === 'winding') {
      if (s.inBreak) message = 'A break. The next block starts by itself.';
      else if (s.prefs.landTo === 'silence' && s.mode === 'focus') message = 'Resting in silence. Resume when you’re ready.';
      else message = 'A low hum, nothing else. Stay as long as you like.';
    }
    this.rowD.dataset.message = String(message !== null);
    this.messageText.textContent = message ?? '';
    this.messageActions.replaceChildren(
      ...actions.map((a) => {
        const b = h('button', { class: 'btn' }, a.label);
        b.addEventListener('click', () => void this.session.noticeAction(a.id));
        return b;
      }),
    );
    this.controls.inert = message !== null;

    if (document.activeElement !== this.volume.input) this.volume.set(s.volume);
    if (document.activeElement !== this.warmth.input) this.warmth.set(toSlider('warmth', s.params.warmth));
    if (document.activeElement !== this.drift.input) this.drift.set(toSlider('motion', s.params.motion));

    // The chip shows the setting (what the menu ticks), never a passing value mid-glide.
    const beatOn = !!s.params.beatOn;
    this.beatValue.textContent = beatShort(s.params);
    const speakers = s.output?.kind === 'speakers';
    this.beatGlyph.replaceChildren(icon(speakers ? ICONS.speaker : ICONS.headphones));
    const long = beatLong(s.params);
    this.beatBtn.setAttribute('aria-label', `${long}.${beatOn && speakers ? ' Playing through speakers.' : ''} Change beat`);
    this.beatBtn.title = long;
    this.beatBtn.dataset.on = String(beatOn);

    this.scheduleMinute(s);
  }

  /** Re-render at the next minute boundary of the timer, and no more often. */
  private scheduleMinute(s: Snapshot): void {
    if (this.minuteTimer) clearTimeout(this.minuteTimer);
    this.minuteTimer = null;
    if (s.phase !== 'playing') return;
    const delay = s.remaining !== null ? ((s.remaining % 60) || 60) * 1000 + 60 : 60000;
    this.minuteTimer = setTimeout(() => this.render(this.session.snapshot()), delay);
  }
}
