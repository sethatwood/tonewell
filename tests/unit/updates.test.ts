import { describe, expect, it } from 'vitest';
import { CHECK_EVERY_MS, checkDue } from '../../src/platform/updates';
import { Session } from '../../src/session/session';
import { trayMenu } from '../../src/ui/tray';
import type { MenuNode } from '../../src/ui/menu';

const ids = (nodes: MenuNode[]) => nodes.flatMap((n) => (n.kind === 'item' ? [{ id: n.id, enabled: n.enabled ?? true, label: n.label }] : []));

describe('the daily check', () => {
  const now = Date.UTC(2026, 10, 17, 21, 0);

  it('looks when it never has, or a day has nearly passed', () => {
    expect(checkDue(undefined, now)).toBe(true);
    expect(checkDue(now - 60_000, now)).toBe(false);
    expect(checkDue(now - CHECK_EVERY_MS + 60_000, now)).toBe(false);
    expect(checkDue(now - CHECK_EVERY_MS, now)).toBe(true);
  });

  it('looks again if the clock was set back', () => {
    expect(checkDue(now + 3600_000, now)).toBe(true);
  });
});

describe('the menu bar', () => {
  const session = new Session();

  it('offers a check when no update is waiting', () => {
    const items = ids(trayMenu(session, session.snapshot(), false));
    expect(items.find((i) => i.id === 'check-updates')).toBeTruthy();
    expect(items.find((i) => i.id === 'update-restart')).toBeUndefined();
  });

  it('offers a restart for a waiting update, but not during a session', () => {
    const ready = ids(trayMenu(session, session.snapshot(), false, '0.1.1'));
    expect(ready.find((i) => i.id === 'update-restart')).toEqual({ id: 'update-restart', enabled: true, label: 'Restart to update to 0.1.1' });
    expect(ready.find((i) => i.id === 'check-updates')).toBeUndefined();
    const playing = ids(trayMenu(session, { ...session.snapshot(), phase: 'playing' }, false, '0.1.1'));
    expect(playing.find((i) => i.id === 'update-restart')?.enabled).toBe(false);
  });
});

describe('update notices', () => {
  const ready = { kind: 'update' as const, text: 'Version 0.1.1 is ready.', actions: [{ id: 'update-restart', label: 'Restart' }] };

  it('wait behind every other notice, even Done', () => {
    const s = new Session();
    s.setNotice({ kind: 'done', text: 'Done, 20 min.', ttl: 10 });
    s.setNotice(ready);
    expect(s.notice?.kind).toBe('done');
    s.setNotice(null);
    expect(s.notice).toEqual(ready);
  });

  it('clear without bringing back an earlier update notice', () => {
    const s = new Session();
    s.setNotice({ kind: 'update', text: 'Checking for updates…' });
    s.clearNotices(['update']);
    s.setNotice({ kind: 'update', text: 'Tonewell is up to date.', ttl: 5 });
    s.setNotice(null);
    expect(s.notice).toBeNull();
  });

  it('pass a button they don’t handle on to the app', async () => {
    const s = new Session();
    const seen: string[] = [];
    s.addEventListener('notice-action', (e) => seen.push((e as CustomEvent<string>).detail));
    s.setNotice(ready);
    await s.noticeAction('update-restart');
    expect(seen).toEqual(['update-restart']);
    expect(s.notice).toBeNull();
  });

  it('don’t flash up when a notice’s button starts the sound', async () => {
    const s = new Session();
    s.setNotice({ kind: 'slept', text: 'Stopped while your Mac slept.', actions: [{ id: 'start', label: 'Start again' }] });
    s.setNotice(ready);
    expect(s.notice?.kind).toBe('slept');
    s.holdStarts = true; // keeps start() from needing audio here
    await s.noticeAction('start');
    expect(s.notice).toBeNull();
  });
});

describe('restarting to update', () => {
  it('holds off any session while it installs', async () => {
    const s = new Session();
    expect(s.idle).toBe(true);
    s.holdStarts = true;
    await s.start();
    expect(s.phase).toBe('ready');
  });
});

