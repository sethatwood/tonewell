import { describe, expect, it } from 'vitest';
import { Session, type Snapshot } from '../../src/session/session';
import { trayMenu } from '../../src/ui/tray';
import { beatMenu, lengthMenu, presetMenu } from '../../src/ui/player';
import type { MenuNode } from '../../src/ui/menu';
import { BEAT_CHOICES, beatShort, choiceParams } from '../../src/ui/beats';

function ids(nodes: MenuNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.kind === 'item' || n.kind === 'check') out.push(n.id);
    else if (n.kind === 'submenu') out.push(...ids(n.children));
  }
  return out;
}

const KNOWN = /^(go|wind|resume|end|status|show|visuals|learn|settings|quit|check-updates|update-restart|keep-playing|preset-save-as|preset-save|preset-rename|preset-duplicate|preset-delete|preset-revert|mode:(meditate|focus)|preset:.+|length:(\d+|open)|volume:(up|down|\d+)|beat:(off|more|learn|custom|settle|header-(meditate|focus)|[\d.]+))$/;

describe('menus', () => {
  const session = new Session();
  const snap = (patch: Partial<Snapshot>): Snapshot => ({ ...session.snapshot(), ...patch });

  it('offers to start when ready, and the stop ladder when playing or resting', () => {
    expect(ids(trayMenu(session, snap({ phase: 'ready' }), false))[0]).toBe('go');
    const playing = ids(trayMenu(session, snap({ phase: 'playing' }), false));
    expect(playing).toContain('wind');
    expect(playing).toContain('end');
    expect(playing).not.toContain('go');
    const resting = ids(trayMenu(session, snap({ phase: 'resting' }), false));
    expect(resting).toContain('resume');
    expect(resting).toContain('end');
  });

  it('only uses actions the app knows how to handle', () => {
    const s = snap({ phase: 'playing' });
    for (const id of [...ids(trayMenu(session, s, true)), ...ids(trayMenu(session, s, true, '9.9.9')), ...ids(lengthMenu(s)), ...ids(beatMenu(s)), ...ids(presetMenu(session, s))]) {
      expect(id).toMatch(KNOWN);
    }
  });

  it('checks the current preset, length and beat', () => {
    const s = session.snapshot();
    const tray = trayMenu(session, s, false);
    const checked = (nodes: MenuNode[]): string[] =>
      nodes.flatMap((n) => (n.kind === 'check' && n.checked ? [n.id] : n.kind === 'submenu' ? checked(n.children) : []));
    const on = checked(tray);
    expect(on).toContain(`preset:${s.preset.id}`);
    expect(on).toContain(`length:${s.prefs.minutes ?? 'open'}`);
    expect(on).toContain(`mode:${s.mode}`);
  });

  it('lists only the current mode’s presets', () => {
    const s = session.snapshot();
    const presets = ids(presetMenu(session, s)).filter((id) => id.startsWith('preset:'));
    for (const id of presets) expect(session.findPreset(id.slice(7))?.mode).toBe(s.mode);
  });
});

describe('beat chip and beat menu agree', () => {
  const session = new Session();
  const checked = (nodes: MenuNode[]): string[] =>
    nodes.flatMap((n) => (n.kind === 'check' && n.checked ? [n.id] : n.kind === 'submenu' ? checked(n.children) : []));

  it('for every choice, the chip shows it and the menu ticks it (and only it)', () => {
    for (const c of BEAT_CHOICES) {
      session.setParams(choiceParams(c));
      const s = session.snapshot();
      expect(checked(beatMenu(s))).toEqual([`beat:${c.id}`]);
      expect(beatShort(s.params)).toBe(c.from !== undefined ? `${c.from}→${c.hz} Hz` : `${c.hz} Hz`);
      // The menu bar's Beat submenu says the same.
      expect(checked(trayMenu(session, s, false)).filter((id) => id.startsWith('beat:'))).toEqual([`beat:${c.id}`]);
    }
  });

  it('Deep Theta reads as its glide, 10→6 Hz', () => {
    session.setPreset('deep-theta');
    const s = session.snapshot();
    expect(beatShort(s.params)).toBe('10→6 Hz');
    expect(checked(beatMenu(s))).toEqual(['beat:settle']);
  });

  it('a beat set by hand is shown, and the menu says so', () => {
    session.setParams({ beatOn: 1, rampOn: 0, beatHz: 7.5 });
    const s = session.snapshot();
    expect(beatShort(s.params)).toBe('7.5 Hz');
    expect(checked(beatMenu(s))).toEqual(['beat:custom']);
  });

  it('off is off everywhere', () => {
    session.setParam('beatOn', 0);
    const s = session.snapshot();
    expect(beatShort(s.params)).toBe('Off');
    expect(checked(beatMenu(s))).toEqual(['beat:off']);
  });
});
