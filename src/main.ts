// The mini player window. It owns the sound (the session), mirrors itself
// into the menu bar, and feeds the optional Visuals window.

import { Session, type Phase } from './session/session';
import { Player, handleMenuId, type PlayerActions } from './ui/player';
import { Panel } from './ui/panel';
import { trayError, updateTray } from './ui/tray';
import { check, item, popup, sep, submenu } from './ui/menu';
import { h } from './ui/controls';
import { currentWindow, emitTo, invoke, isTauri, isWindowOpen, listen, openWindow } from './platform/bridge';
import { flushNow } from './platform/store';
import { GLOBAL_SHORTCUTS, loadSettings, saveSettings, type AppSettings } from './settings/model';

const session = new Session();
const app = document.getElementById('app')!;
const root = document.documentElement;
let settings: AppSettings;
let expanded = false;
let visualsOpen = false;
let lastPhase: Phase = 'ready';

const HEIGHT = { mini: 184, folded: 128, expanded: 744 };

// ---------- small dialog for naming presets ----------

function ask(question: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value: initial, id: 'ask-input', autocomplete: 'off', spellcheck: 'false' });
    const cancel = h('button', { type: 'button', class: 'btn quiet' }, 'Cancel');
    const ok = h('button', { type: 'submit', class: 'btn primary' }, 'Save');
    const form = h('form', {}, h('label', { for: 'ask-input' }, question), input, h('div', { class: 'ask-actions' }, cancel, ok));
    const wrap = h('div', { class: 'ask', role: 'dialog', 'aria-modal': 'true', 'aria-label': question }, form);
    const close = (v: string | null) => {
      wrap.remove();
      resolve(v);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      close(input.value.trim() || null);
    });
    cancel.addEventListener('click', () => close(null));
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    });
    if (!expanded) void setExpanded(true);
    document.body.append(wrap);
    input.select();
    input.focus();
  });
}

// ---------- windows ----------

async function resize(): Promise<void> {
  const height = expanded ? HEIGHT.expanded : settings.folded ? HEIGHT.folded : HEIGHT.mini;
  const w = await currentWindow();
  if (!w) return;
  const { LogicalSize, LogicalPosition } = await import('@tauri-apps/api/dpi');
  const { currentMonitor } = await import('@tauri-apps/api/window');
  await w.setSize(new LogicalSize(400, height));
  // Grow downward, unless that would run off the bottom of the screen.
  try {
    const mon = await currentMonitor();
    const pos = await w.outerPosition();
    if (mon) {
      const scale = mon.scaleFactor;
      const bottom = (mon.workArea.position.y + mon.workArea.size.height) / scale;
      const top = mon.workArea.position.y / scale;
      const y = pos.y / scale;
      if (y + height > bottom) await w.setPosition(new LogicalPosition(pos.x / scale, Math.max(top, bottom - height - 8)));
    }
  } catch {
    // Position is a nicety; size is what matters.
  }
}

async function setExpanded(on: boolean): Promise<void> {
  expanded = on;
  app.classList.toggle('expanded', on);
  player.setExpanded(on);
  if (on) panel.render(session.snapshot());
  await resize();
}

async function snapTo(corner: 'tl' | 'tr' | 'bl' | 'br'): Promise<void> {
  const w = await currentWindow();
  if (!w) return;
  const { currentMonitor } = await import('@tauri-apps/api/window');
  const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
  const mon = await currentMonitor();
  if (!mon) return;
  const size = await w.outerSize();
  const m = Math.round(12 * mon.scaleFactor);
  const { position: p, size: s } = mon.workArea;
  const x = corner.endsWith('l') ? p.x + m : p.x + s.width - size.width - m;
  const y = corner.startsWith('t') ? p.y + m : p.y + s.height - size.height - m;
  await w.setPosition(new PhysicalPosition(x, y));
}

const actions: PlayerActions = {
  toggleExpanded: () => void setExpanded(!expanded),
  openVisuals: () => void openVisuals(),
  openLearn: (card) => void openLearn(card),
  openSettings: () =>
    void openWindow({ label: 'settings', url: 'settings.html', title: 'Tonewell Settings', width: 560, height: 640, minWidth: 480, minHeight: 480 }),
  hideWindow: () => void currentWindow().then((w) => w?.hide()),
  contextMenu: (anchor) => void contextMenu(anchor),
};

async function openVisuals(): Promise<void> {
  await openWindow({ label: 'visuals', url: 'visuals.html', title: 'Tonewell Visuals', width: 1100, height: 700, minWidth: 480, minHeight: 320, background: '#000000' });
  visualsOpen = true;
}

async function openLearn(card?: string): Promise<void> {
  const open = await isWindowOpen('learn');
  await openWindow({ label: 'learn', url: `learn.html${card ? `#${card}` : ''}`, title: 'Learn', width: 760, height: 780, minWidth: 560, minHeight: 480 });
  if (open && card) void emitTo('learn', 'learn-open', card);
}

async function contextMenu(anchor: HTMLElement): Promise<void> {
  const id = await popup(
    [
      check('ctx:top', 'Always on top', settings.alwaysOnTop),
      submenu('Snap to corner', [item('ctx:snap-tl', 'Top left'), item('ctx:snap-tr', 'Top right'), item('ctx:snap-bl', 'Bottom left'), item('ctx:snap-br', 'Bottom right')]),
      check('ctx:fold', 'Fold controls', settings.folded),
      sep,
      item('ctx:learn', 'Learn'),
      item('ctx:settings', 'Settings…'),
      item('ctx:hide', 'Hide window'),
    ],
    anchor,
  );
  if (!id) return;
  if (id === 'ctx:top') await applySettings({ ...settings, alwaysOnTop: !settings.alwaysOnTop }, true);
  else if (id === 'ctx:fold') await applySettings({ ...settings, folded: !settings.folded }, true);
  else if (id.startsWith('ctx:snap-')) await snapTo(id.slice(9) as 'tl');
  else if (id === 'ctx:learn') actions.openLearn();
  else if (id === 'ctx:settings') actions.openSettings();
  else if (id === 'ctx:hide') actions.hideWindow();
}

// ---------- settings ----------

let registeredShortcuts = false;

async function applySettings(next: AppSettings, save = false): Promise<void> {
  const prev = settings;
  settings = next;
  if (save) await saveSettings(settings);
  app.classList.toggle('folded', settings.folded);
  const w = await currentWindow();
  if (w && prev?.alwaysOnTop !== settings.alwaysOnTop) await w.setAlwaysOnTop(settings.alwaysOnTop);
  if (prev?.folded !== settings.folded) await resize();
  if (isTauri && registeredShortcuts !== settings.shortcutsEnabled) await setShortcuts(settings.shortcutsEnabled);
  void updateTray(session, session.snapshot(), { shortcuts: settings.shortcutsEnabled, showTime: settings.showTimeInMenuBar });
}

async function setShortcuts(on: boolean): Promise<void> {
  const gs = await import('@tauri-apps/plugin-global-shortcut');
  try {
    await gs.unregisterAll();
    if (on) {
      for (const sc of GLOBAL_SHORTCUTS) {
        await gs.register(sc.accel, (e) => {
          if (e.state === 'Pressed') void runAction(sc.action);
        });
      }
    }
    registeredShortcuts = on;
  } catch (err) {
    console.warn('Tonewell: shortcuts unavailable', err);
  }
}

async function runAction(action: string): Promise<void> {
  switch (action) {
    case 'go':
      return session.go();
    case 'wind':
      return session.windDown();
    case 'resume':
      return session.resume();
    case 'end':
      session.escape();
      if (session.phase !== 'ready' && session.phase !== 'ending') session.end();
      return;
    case 'next-preset':
      return session.stepPreset(1);
    // Media keys and headphone buttons walk the same ladder as Esc.
    case 'media-toggle':
      if (session.phase === 'ready') return session.start();
      session.escape();
      return;
    case 'media-play':
      if (session.phase === 'ready') return session.start();
      if (session.phase === 'resting' || session.phase === 'winding') return session.resume();
      return;
    case 'media-pause':
      if (session.phase === 'playing') return session.windDown();
      return;
    case 'visuals':
      return openVisuals();
    case 'learn':
      return openLearn();
    case 'settings':
      return actions.openSettings();
    default:
      await handleMenuId(action, session, actions, ask);
  }
}

// ---------- rendering ----------

const player = new Player(session, actions, ask);
const panel = new Panel(session, (card) => void openLearn(card), ask);
app.append(player.el, panel.el);

let mediaKey = '';
function updateMedia(phase: Phase, title: string): void {
  const state = phase === 'playing' ? 'playing' : phase === 'ready' ? 'stopped' : 'paused';
  const key = `${state}:${title}`;
  if (key === mediaKey) return;
  mediaKey = key;
  void invoke('media_state', { state, title }).catch(() => undefined);
}

function render(): void {
  const s = session.snapshot();
  updateMedia(s.phase, s.preset.name);
  root.dataset.mode = s.mode;
  root.dataset.phase = s.phase;
  root.dataset.sounding = String(s.phase !== 'ready');
  player.render(s);
  if (expanded) panel.render(s);
  if (settings) void updateTray(session, s, { shortcuts: settings.shortcutsEnabled, showTime: settings.showTimeInMenuBar });
  if (s.phase === 'ready' && lastPhase !== 'ready' && s.timerDone && !s.notice) {
    session.setNotice({ text: `Done, ${s.prefs.minutes ?? ''} min.`.replace(' , min', ''), ttl: 10 });
  }
  if (s.phase === 'playing' && !settings?.firstRunDone && settings) {
    void applySettings({ ...settings, firstRunDone: true }, true);
    player.firstRun = false;
  }
  lastPhase = s.phase;
}

session.addEventListener('change', render);

// ---------- keyboard ----------

addEventListener('keydown', (e) => {
  if (document.querySelector('.ask')) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;
  const inText = (e.target as HTMLElement).matches?.('input[type="text"]');
  if (key === 'Escape') {
    if (document.querySelector('.pop')) return;
    e.preventDefault();
    session.escape(e.repeat);
    return;
  }
  if (inText) return;
  if (mod && key === 'ArrowUp') session.nudgeVolume(0.05);
  else if (mod && key === 'ArrowDown') session.nudgeVolume(-0.05);
  else if (!mod && (key === '+' || key === '=')) session.wind(5);
  else if (!mod && (key === '-' || key === '_')) session.wind(-5);
  else if (!mod && key === '[') session.stepPreset(-1);
  else if (!mod && key === ']') session.stepPreset(1);
  else if (mod && key === '1') session.setMode('meditate');
  else if (mod && key === '2') session.setMode('focus');
  else if (mod && key.toLowerCase() === 'b') session.setParam('beatOn', session.params.beatOn ? 0 : 1);
  else if (mod && key.toLowerCase() === 'e') void setExpanded(!expanded);
  else if (mod && e.shiftKey && key.toLowerCase() === 'v') void openVisuals();
  else if (mod && key.toLowerCase() === 'l') void openLearn();
  else if (mod && key === ',') actions.openSettings();
  else if (mod && key.toLowerCase() === 'w') actions.hideWindow();
  else return;
  e.preventDefault();
});

document.addEventListener('visibilitychange', () => root.classList.toggle('window-hidden', document.hidden));

// ---------- the visuals feed ----------

setInterval(() => {
  if (!visualsOpen) return;
  const lv = session.levels();
  const s = session.phase;
  void emitTo('visuals', 'audio-frame', {
    rms: lv.rms, low: lv.low, high: lv.high,
    phase: s, mode: session.mode,
    landing: s === 'winding' || s === 'resting' || s === 'ending' || s === 'ready',
    beatHz: session.beatHzNow(), rootHz: session.rootNow(),
  });
}, 50);

setInterval(async () => {
  if (visualsOpen && isTauri) visualsOpen = await isWindowOpen('visuals');
}, 3000);

// ---------- boot ----------

async function boot(): Promise<void> {
  settings = await loadSettings();
  await session.restore();
  player.firstRun = !settings.firstRunDone;
  await applySettings(settings);
  render();

  if (isTauri) {
    const out = await invoke<{ name: string; kind: string } | null>('audio_output');
    if (out) {
      session.output = out;
      render();
    }
    await listen<string>('tray-action', (id) => void runAction(id));
    await listen('audio-output', (c) => session.onOutputChange(c as Parameters<Session['onOutputChange']>[0]));
    await listen('quit-requested', async () => {
      await session.quit();
      await flushNow();
      await invoke('quit_now');
    });
    await listen('settings-changed', async () => {
      const { reloadDoc } = await import('./platform/store');
      await reloadDoc();
      await applySettings(await loadSettings());
    });
    await listen('visuals-hello', () => {
      visualsOpen = true;
    });
    await listen('visuals-bye', () => {
      visualsOpen = false;
    });
    await listen<string>('remote-action', (a) => void runAction(a));
    const w = await currentWindow();
    await w?.show();
    await w?.setFocus();
    await diagnostics();
  } else {
    await listen('visuals-hello', () => {
      visualsOpen = true;
    });
    await listen<string>('remote-action', (a) => void runAction(a));
  }
}

async function diagnostics(): Promise<void> {
  const flags = await invoke<{ autostart: boolean; hide: boolean; log: boolean; preset: string | null; open: string | null }>('debug_flags');
  if (!flags) return;
  if (flags.preset) session.setPreset(flags.preset);
  for (const name of (flags.open ?? '').split(',').filter(Boolean)) {
    try {
      if (name === 'expand') await setExpanded(true);
      else if (name === 'visuals') await openVisuals();
      else if (name === 'learn') await openLearn();
      else if (name === 'settings') actions.openSettings();
    } catch (err) {
      void invoke('debug_log', { line: `open ${name} failed: ${String(err)}` });
    }
  }
  const log = (line: string) => void invoke('debug_log', { line });
  if (flags.log) {
    let lastWall = Date.now();
    setInterval(() => {
      const now = Date.now();
      const lv = session.levels();
      log(JSON.stringify({ wallGap: now - lastWall, rms: Number(lv.rms.toFixed(4)), trayError, visualsOpen, ...session.debugInfo() }));
      lastWall = now;
    }, 10000);
  }
  if (flags.autostart) {
    await session.start();
    log(`autostart: ${JSON.stringify(session.debugInfo())}`);
    if (flags.hide) setTimeout(() => void currentWindow().then((w) => w?.hide()), 2000);
  }
}

void boot();
