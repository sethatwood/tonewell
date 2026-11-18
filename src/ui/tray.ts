// The menu-bar menu mirrors the mini player, so a whole session can run
// with no window open.

import type { Session, Snapshot } from '../session/session';
import { invoke } from '../platform/bridge';
import { check, item, sep, submenu, type MenuNode } from './menu';
import { LENGTHS, lengthLabel } from './player';
import { beatMenuNodes, beatShort } from './beats';
import { keys } from '../platform/os';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export interface TrayOptions {
  shortcuts: boolean;
  showTime: boolean;
  /** A downloaded update's version, waiting to install. */
  update: string | null;
}

export function trayMenu(session: Session, s: Snapshot, shortcuts: boolean, update: string | null = null): MenuNode[] {
  const nodes: MenuNode[] = [];
  const hint = (label: string, mac: string) => (shortcuts ? `${label}    ${keys(mac)}` : label);
  if (s.phase === 'ready') {
    nodes.push(item('go', hint(`Start ${s.preset.name} (${lengthLabel(s.prefs.minutes).toLowerCase()})`, '⌃⌥⌘Space')));
  } else {
    let status = s.preset.name;
    if (s.phase === 'playing') status += s.endsAt ? `, ends ${timeFmt.format(s.endsAt)}` : ', playing';
    else if (s.phase === 'winding') status += ', winding down';
    else if (s.phase === 'resting') status += s.inBreak ? ', on a break' : ', resting';
    else status += ', ending';
    nodes.push(item('status', status, false), sep);
    if (s.phase === 'playing') nodes.push(item('wind', hint('Wind down', '⌃⌥⌘Space')), item('end', hint('End', '⌃⌥⌘.')));
    else if (s.phase === 'winding' || s.phase === 'resting') nodes.push(item('resume', hint('Resume', '⌃⌥⌘Space')), item('end', hint('End', '⌃⌥⌘.')));
  }
  nodes.push(
    sep,
    check('mode:meditate', 'Meditate', s.mode === 'meditate'),
    check('mode:focus', 'Focus', s.mode === 'focus'),
    submenu('Preset', [
      ...session.presetsFor(s.mode).map((p) => check(`preset:${p.id}`, p.name, p.id === s.preset.id)),
      sep,
      item('preset-save-as', 'Save as preset…'),
    ]),
    submenu('Length', [
      ...LENGTHS.map((m) => check(`length:${m ?? 'open'}`, m === null ? 'Open-ended' : `${m} minutes`, s.prefs.minutes === m)),
      sep,
      check('keep-playing', 'Keep playing after', s.prefs.keepPlaying),
    ]),
    submenu('Volume', [
      item('volume:up', 'Louder'),
      item('volume:down', 'Quieter'),
      sep,
      ...[20, 40, 60, 80].map((v) => check(`volume:${v}`, `${v}%`, Math.abs(s.volume * 100 - v) < 2.5)),
    ]),
    // The same grouped choices as the mini player's Beat menu.
    submenu(`Beat: ${beatShort(s.params)}`, beatMenuNodes(s.params, s.mode)),
    sep,
    item('show', 'Show player'),
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
  const menu = trayMenu(session, s, opts.shortcuts, opts.update);
  const icon = s.phase === 'playing' ? 'playing' : s.phase === 'ready' ? 'ready' : 'resting';
  const title = opts.showTime && s.phase === 'playing' && s.remaining !== null ? `${Math.ceil(s.remaining / 60)}m` : null;
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
