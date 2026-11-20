// The menu-bar menu mirrors the player in the player's words, so a whole
// session can run with no window open. Its lists are the sheets' lists, in
// the same order: the Sound, Length and Beat submenus, then Volume.

import type { Session, Snapshot } from '../session/session';
import { invoke } from '../platform/bridge';
import { check, item, sep, submenu, type MenuNode } from './menu';
import { LENGTHS } from './player';
import { beatMenuNodes, beatName, fmtHz } from './beats';
import { isPhone, keys } from '../platform/os';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export interface TrayOptions {
  shortcuts: boolean;
  showTime: boolean;
  /** A downloaded update's version, waiting to install. */
  update: string | null;
  /** While a glide runs, the beat it's at now (the Beat item says so). */
  beatNow?: number | null;
  /** The player is shrunk to its light. */
  mini?: boolean;
}

const lengthWords = (m: number | null) => (m === null ? 'Open-ended' : `${m} min`);
const wholeMinutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60 - 1e-6));

/** Where a running session stands, in a few words: "ends 14:17", "winding down". */
export function statusWords(s: Snapshot): string {
  if (s.paused) return 'paused';
  const cycling = s.prefs.breakMinutes > 0 && s.prefs.minutes !== null;
  switch (s.phase) {
    case 'playing':
      if (cycling && s.remaining !== null) return `block ${s.block}, ${wholeMinutes(s.remaining)} min to break`;
      return s.endsAt ? `ends ${timeFmt.format(s.endsAt)}` : 'open-ended';
    case 'winding':
      return 'winding down';
    case 'resting':
      if (s.inBreak) return s.restLeft !== null ? `break, ${wholeMinutes(s.restLeft)} min` : 'break';
      return 'resting';
    default:
      return 'ending';
  }
}

/** The disabled first line while a session runs: what is playing, and where it stands. */
export function trayStatus(s: Snapshot): string {
  return `${s.preset.name} · ${statusWords(s)}`;
}

/**
 * The stop ladder's next steps from here, as the menu bar and the lock screen
 * offer them: Wind down then End while playing; Resume (or Start now, on a
 * break) and End after; only End once the timer is done. Nothing at rest.
 */
export function ladder(s: Snapshot): Array<{ id: 'go' | 'wind' | 'resume' | 'end'; label: string }> {
  const end = { id: 'end', label: 'End' } as const;
  if (s.phase === 'ready' || s.phase === 'ending') return [];
  if (s.phase === 'playing') return [{ id: 'wind', label: 'Wind down' }, end];
  if (s.phase === 'resting' && s.inBreak) return [{ id: 'resume', label: 'Start now' }, end];
  if (s.phase === 'resting' && s.timerDone && !s.paused) return [end];
  return [{ id: 'resume', label: 'Resume' }, end];
}

/** Sound: the mode's sounds, yours, then keeping one and the Sound sheet. */
export function soundMenu(session: Session, s: Snapshot): MenuNode[] {
  const list = session.presetsFor(s.mode);
  const mine = list.filter((p) => !p.builtin);
  const nodes: MenuNode[] = [
    item(`header:${s.mode}`, s.mode === 'meditate' ? 'Meditate' : 'Focus', false),
    ...list.filter((p) => p.builtin).map((p) => check(`preset:${p.id}`, p.name, p.id === s.preset.id)),
  ];
  if (mine.length) nodes.push(sep, item('header:yours', 'Yours', false), ...mine.map((p) => check(`preset:${p.id}`, p.name, p.id === s.preset.id)));
  if (s.edited) nodes.push(sep, item('preset-revert', `Revert to ${s.preset.name}`));
  nodes.push(sep, item('preset-save-as', 'Keep the current sound…'), item('sound-sheet', 'Choose in the player…'));
  return nodes;
}

export function lengthMenu(s: Snapshot): MenuNode[] {
  return [
    ...LENGTHS.map((m) => check(`length:${m ?? 'open'}`, m === null ? 'Open-ended' : `${m} minutes`, s.prefs.minutes === m)),
    sep,
    check('keep-playing', 'Keep playing after the timer', s.prefs.keepPlaying),
  ];
}

export function volumeMenu(s: Snapshot, shortcuts: boolean): MenuNode[] {
  const hint = (label: string, mac: string) => (shortcuts ? `${label}    ${keys(mac)}` : label);
  return [
    item('volume:up', hint('Louder', '⌃⌥⌘↑')),
    item('volume:down', hint('Quieter', '⌃⌥⌘↓')),
    sep,
    ...[20, 40, 60, 80].map((v) => check(`volume:${v}`, `${v}%`, Math.abs(s.volume * 100 - v) < 2.5)),
  ];
}

export function trayMenu(session: Session, s: Snapshot, shortcuts: boolean, update: string | null = null, beatNow: number | null = null, mini = false): MenuNode[] {
  const nodes: MenuNode[] = [];
  const hint = (label: string, mac: string) => (shortcuts ? `${label}    ${keys(mac)}` : label);
  if (s.phase === 'ready') {
    nodes.push(item('go', hint(`Start ${s.preset.name}, ${lengthWords(s.prefs.minutes).toLowerCase()}`, '⌃⌥⌘Space')));
  } else {
    nodes.push(item('status', trayStatus(s), false));
    for (const c of ladder(s)) nodes.push(item(c.id, hint(c.label, c.id === 'end' ? '⌃⌥⌘.' : '⌃⌥⌘Space')));
  }
  // While a glide runs, the Beat item says where it is now.
  const gliding = beatNow !== null && s.phase === 'playing' && !!s.params.beatOn && Math.abs(beatNow - s.params.beatHz) > 0.05;
  nodes.push(
    sep,
    check('mode:meditate', 'Meditate', s.mode === 'meditate'),
    check('mode:focus', 'Focus', s.mode === 'focus'),
    sep,
    submenu(`Sound: ${s.preset.name}`, soundMenu(session, s)),
    submenu(`Length: ${lengthWords(s.prefs.minutes)}`, lengthMenu(s)),
    submenu(gliding ? `Beat: ${beatName(s.params)}, now ${fmtHz(beatNow!)} Hz` : `Beat: ${beatName(s.params)}`, beatMenuNodes(s.params, s.mode)),
    submenu(`Volume: ${Math.round(s.volume * 100)}%`, volumeMenu(s, shortcuts)),
    sep,
    item('show', 'Show player'),
    // Also a way back to the full player from anywhere.
    check('mini', 'Mini player', mini),
    item('visuals', 'Open visuals'),
    item('learn', 'Learn'),
    item('settings', 'Settings…'),
    // Restarting is offered only while nothing plays; otherwise it installs at quit.
    update ? item('update-restart', `Restart to update to ${update}`, s.phase === 'ready') : item('check-updates', 'Check for updates…'),
    sep,
    item('quit', 'Quit Tonewell'),
  );
  return nodes;
}

let lastJson = '';

/** Forget what was last sent, e.g. after a click toggled a check mark by itself. */
export function invalidateTray(): void {
  lastJson = '';
}
/** The last menu-bar update error, for diagnostics. */
export let trayError: string | null = null;

export async function updateTray(session: Session, s: Snapshot, opts: TrayOptions): Promise<void> {
  // A phone shows the session on its lock screen instead (see platform/phone.ts).
  if (isPhone) return;
  const menu = trayMenu(session, s, opts.shortcuts, opts.update, opts.beatNow ?? null, opts.mini ?? false);
  const icon = s.phase === 'playing' ? 'playing' : s.phase === 'ready' ? 'ready' : 'resting';
  const title = opts.showTime && s.phase === 'playing' && s.remaining !== null ? `${wholeMinutes(s.remaining)}m` : null;
  const tooltip = s.phase === 'ready' ? 'Tonewell' : `Tonewell: ${s.preset.name}`;
  const json = JSON.stringify({ menu, icon, title, tooltip });
  if (json === lastJson) return;
  lastJson = json;
  try {
    await invoke('tray_update', { menu, icon, title, tooltip });
  } catch (err) {
    lastJson = '';
    trayError = String(err);
    console.warn('Tonewell: tray update failed', err);
  }
}
