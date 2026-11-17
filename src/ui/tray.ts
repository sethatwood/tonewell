// The menu-bar menu mirrors the mini player, so a whole session can run
// with no window open.

import type { Session, Snapshot } from '../session/session';
import { invoke } from '../platform/bridge';
import { check, item, sep, submenu, type MenuNode } from './menu';
import { BEAT_CHOICES, LENGTHS, lengthLabel } from './player';

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function trayMenu(session: Session, s: Snapshot, shortcuts: boolean): MenuNode[] {
  const nodes: MenuNode[] = [];
  const hint = (label: string, keys: string) => (shortcuts ? `${label}    ${keys}` : label);
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
    submenu(
      'Beat',
      BEAT_CHOICES.map((b) =>
        check(`beat:${b.hz ?? 'off'}`, b.label, b.hz === null ? !s.params.beatOn : !!s.params.beatOn && Math.abs(s.params.beatHz - b.hz) < 0.05),
      ),
    ),
    sep,
    item('show', 'Show mini player'),
    item('visuals', 'Open visuals'),
    item('learn', 'Learn'),
    item('settings', 'Settings…'),
    sep,
    item('quit', 'Quit Tonewell'),
  );
  return nodes;
}

let lastJson = '';

export async function updateTray(session: Session, s: Snapshot, opts: { shortcuts: boolean; showTime: boolean }): Promise<void> {
  const menu = trayMenu(session, s, opts.shortcuts);
  const icon = s.phase === 'playing' ? 'playing' : s.phase === 'ready' ? 'ready' : 'resting';
  const title = opts.showTime && s.phase === 'playing' && s.remaining !== null ? `${Math.ceil(s.remaining / 60)}m` : null;
  const tooltip = s.phase === 'ready' ? 'Tonewell' : `Tonewell: ${s.preset.name}`;
  const json = JSON.stringify({ menu, icon, title, tooltip });
  if (json === lastJson) return;
  lastJson = json;
  try {
    await invoke('tray_update', { menu, icon, title, tooltip });
  } catch (err) {
    console.warn('Tonewell: tray update failed', err);
  }
}
