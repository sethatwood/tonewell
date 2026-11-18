// The mini player window. It owns the sound (the session), mirrors itself
// into the menu bar, and feeds the optional Visuals window.

import { Session, type Phase } from './session/session';
import { Player, handleMenuId, type PlayerActions } from './ui/player';
import { Panel } from './ui/panel';
import { invalidateTray, trayError, updateTray } from './ui/tray';
import { check, item, popup, sep, submenu } from './ui/menu';
import { h } from './ui/controls';
import { currentWindow, emitTo, invoke, isTauri, isWindowOpen, listen, openWindow } from './platform/bridge';
import { flushNow } from './platform/store';
import { chordRatio } from './visuals/chords';
import { GLOBAL_SHORTCUTS, loadSettings, patchSettings, type AppSettings } from './settings/model';

const session = new Session();
const app = document.getElementById('app')!;
const root = document.documentElement;
let settings: AppSettings;
let expanded = false;
/** Mini mode: the light alone, 112 px, floating where it was. */
let mini = false;
/** The state mini mode is heading to, and the transition running towards it, if any. */
let miniTarget = false;
let miniSave = true;
let miniRun: Promise<void> | null = null;
let visualsOpen = false;
let lastPhase: Phase = 'ready';
let micBusy = false;

const PLAYER = { width: 380, height: 156 };
const EXPANDED_HEIGHT = 744;
/**
 * Mini mode's window: the player's top-left corner down to the bottom-right
 * of its light (15 + 112 by 22 + 112). The light keeps its place inside it,
 * so the window shrinks and grows with its top-left corner fixed and the
 * light never moves, even while macOS animates the frame (the page isn't
 * redrawn until the animation ends). Outside the light it's transparent.
 */
const MINI = { width: 127, height: 134 };

// ---------- small dialog for naming presets ----------

function ask(question: string, initial: string): Promise<string | null> {
  // Asked from the menu bar, the window may be hidden: bring it forward first.
  void currentWindow().then(async (w) => {
    await w?.show();
    await w?.setFocus();
  });
  const returnFocus = document.activeElement as HTMLElement | null;
  const wasExpanded = expanded;
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value: initial, id: 'ask-input', autocomplete: 'off', spellcheck: 'false' });
    const cancel = h('button', { type: 'button', class: 'btn quiet' }, 'Cancel');
    const ok = h('button', { type: 'submit', class: 'btn primary' }, 'Save');
    const form = h('form', {}, h('label', { for: 'ask-input' }, question), input, h('div', { class: 'ask-actions' }, cancel, ok));
    const wrap = h('div', { class: 'ask', role: 'dialog', 'aria-modal': 'true', 'aria-label': question }, form);
    const close = (v: string | null) => {
      wrap.remove();
      if (!wasExpanded) void setExpanded(false);
      returnFocus?.focus();
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
      } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const items = [input, cancel, ok];
        const i = items.indexOf(document.activeElement as HTMLInputElement & HTMLButtonElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
      }
    });
    if (!expanded) void setExpanded(true);
    document.body.append(wrap);
    input.select();
    input.focus();
  });
}

// ---------- windows ----------

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

/**
 * Give the window a new size, with its top-left corner moved by (dx, dy),
 * in one native step (animated unless Reduce motion is on). The window stays
 * on screen: if the new frame would run off an edge, it moves back in.
 */
async function setFrame(width: number, height: number, dx = 0, dy = 0, animate = !reducedMotion()): Promise<void> {
  const w = await currentWindow();
  if (!w) return;
  try {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const mon = await currentMonitor();
    const pos = await w.outerPosition();
    if (mon) {
      const k = mon.scaleFactor;
      const area = { x: mon.workArea.position.x / k, y: mon.workArea.position.y / k, w: mon.workArea.size.width / k, h: mon.workArea.size.height / k };
      const x = pos.x / k + dx;
      const y = pos.y / k + dy;
      const nx = Math.min(Math.max(x, area.x), area.x + area.w - width);
      const ny = Math.min(Math.max(y, area.y), area.y + area.h - height - 8);
      dx += nx - x;
      dy += ny - y;
    }
  } catch {
    // Keeping on screen is a nicety; the size is what matters.
  }
  await invoke('resize_player', { width, height, dx, dy, animate }).catch(async () => {
    const { LogicalSize } = await import('@tauri-apps/api/dpi');
    await w.setSize(new LogicalSize(width, height));
  });
}

async function resize(): Promise<void> {
  if (mini) return;
  await setFrame(PLAYER.width, expanded ? EXPANDED_HEIGHT : PLAYER.height);
}

async function setExpanded(on: boolean): Promise<void> {
  // Out of mini mode first, waiting for any shrink or grow under way to finish.
  if (on && (mini || miniRun)) await setMini(false);
  expanded = on;
  app.classList.toggle('expanded', on);
  player.setExpanded(on);
  if (on) panel.render(session.snapshot());
  await resize();
}

/**
 * Shrink to the light alone, or grow back. Everything but the light fades
 * first (240 ms); then the window shrinks to the light with the system's
 * animation, its top-left corner fixed, so the light holds still. Growing
 * runs the same steps backwards. No step changes brightness quickly.
 */
/** Ask for mini mode on or off. Requests made during a transition are kept: the last one wins. */
function setMini(on: boolean, save = true): Promise<void> {
  miniTarget = on;
  miniSave = save;
  miniRun ??= (async () => {
    try {
      while (mini !== miniTarget) await stepMini(miniTarget);
    } finally {
      miniRun = null;
    }
  })();
  return miniRun;
}

async function stepMini(on: boolean): Promise<void> {
  if (on) {
    if (expanded) {
      expanded = false;
      app.classList.remove('expanded');
      player.setExpanded(false);
      await resize();
    }
    mini = true;
    player.setMini(true);
    app.dataset.mini = 'fading';
    await wait(260);
    app.dataset.mini = 'on';
    await setFrame(MINI.width, MINI.height);
  } else {
    await setFrame(PLAYER.width, PLAYER.height);
    mini = false;
    player.setMini(false);
    app.dataset.mini = 'fading';
    // Let the page lay out at the new size before the fade back in starts. A timer, not
    // requestAnimationFrame: a hidden or covered window never gets a frame, and would hang here.
    await new Promise((r) => setTimeout(r, 30));
    delete app.dataset.mini;
    await wait(260);
  }
  void invoke('refresh_shadow').catch(() => undefined);
  if (miniSave) await applySettings({ ...settings, mini: on }, true);
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
  toggleMini: () => void setMini(!miniTarget),
  startDrag: () => void currentWindow().then((w) => w?.startDragging()),
  expand: () => void setExpanded(true),
  openVisuals: () => void openVisuals(),
  openLearn: (card) => void openLearn(card),
  openSettings: () =>
    void openWindow({ label: 'settings', url: 'settings.html', title: 'Tonewell Settings', width: 560, height: 640, minWidth: 480, minHeight: 480 }),
  hideWindow: () => void currentWindow().then((w) => w?.hide()),
  contextMenu: (anchor, at) => void contextMenu(anchor, at),
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

async function contextMenu(anchor: HTMLElement, at?: { x: number; y: number }): Promise<void> {
  const id = await popup(
    [
      check('ctx:top', 'Always on top', settings.alwaysOnTop),
      submenu('Snap to corner', [item('ctx:snap-tl', 'Top left'), item('ctx:snap-tr', 'Top right'), item('ctx:snap-bl', 'Bottom left'), item('ctx:snap-br', 'Bottom right')]),
      check('ctx:mini', 'Mini player    ⌘M', mini),
      sep,
      item('ctx:learn', 'Learn'),
      item('ctx:settings', 'Settings…'),
      item('ctx:hide', 'Hide window'),
    ],
    anchor,
    at,
  );
  if (!id) return;
  if (id === 'ctx:top') await applySettings({ ...settings, alwaysOnTop: !settings.alwaysOnTop }, true);
  else if (id === 'ctx:mini') await setMini(!miniTarget);
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
  if (save) {
    const changed: Partial<AppSettings> = {};
    for (const k of Object.keys(next) as Array<keyof AppSettings>) {
      if (prev?.[k] !== next[k]) (changed as Record<string, unknown>)[k] = next[k];
    }
    settings = await patchSettings(changed);
  }
  const w = await currentWindow();
  if (w && prev?.alwaysOnTop !== settings.alwaysOnTop) await w.setAlwaysOnTop(settings.alwaysOnTop);
  if (isTauri && registeredShortcuts !== settings.shortcutsEnabled) await setShortcuts(settings.shortcutsEnabled);
  session.setDucked(micBusy && settings.softenForCalls);
  if (isTauri && prev?.showInDock !== settings.showInDock) void invoke('set_dock_visible', { visible: settings.showInDock }).catch(() => undefined);
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
player.sheet.append(panel.el);
app.append(player.el);

let mediaKey = '';
function updateMedia(phase: Phase, title: string): void {
  const state = phase === 'playing' ? 'playing' : phase === 'ready' ? 'stopped' : 'paused';
  const key = `${state}:${title}`;
  if (key === mediaKey) return;
  mediaKey = key;
  void invoke('media_state', { state, title }).catch(() => undefined);
}

/**
 * While sound plays, colours change at its pace (8 s). They keep that pace for
 * a while after a session ends, so the light warms back to Ready as slowly as
 * the sound faded, instead of brightening the moment silence arrives.
 */
let quietTimer: ReturnType<typeof setTimeout> | null = null;
function setSounding(phase: Phase): void {
  if (phase !== 'ready') {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
    root.dataset.sounding = 'true';
  } else if (root.dataset.sounding === 'true') {
    quietTimer ??= setTimeout(() => {
      quietTimer = null;
      root.dataset.sounding = 'false';
    }, 8500);
  } else {
    root.dataset.sounding = 'false';
  }
}

function render(): void {
  const s = session.snapshot();
  updateMedia(s.phase, s.preset.name);
  root.dataset.mode = s.mode;
  // Paused by a notice keeps the mode's colours; resting cools to dusk or sand.
  root.dataset.phase = s.paused ? 'paused' : s.phase;
  setSounding(s.phase);
  player.render(s);
  if (expanded) panel.render(s);
  if (settings) void updateTray(session, s, { shortcuts: settings.shortcutsEnabled, showTime: settings.showTimeInMenuBar });
  if (s.phase === 'ready' && lastPhase !== 'ready' && s.timerDone && !s.notice) {
    session.setNotice({ kind: 'done', text: `Done, ${s.prefs.minutes ?? ''} min.`.replace(' , min', ''), ttl: 10 });
  }
  if (s.phase === 'playing' && !settings?.firstRunDone && settings) {
    void applySettings({ ...settings, firstRunDone: true }, true);
    player.firstRun = false;
  }
  lastPhase = s.phase;
}

session.addEventListener('change', render);

// For the browser checks in development only; never in a built app.
if (import.meta.env.DEV) Object.assign(window, { __tonewell: { session, player, setMini, setExpanded } });

// ---------- keyboard ----------

addEventListener('keydown', (e) => {
  if (document.querySelector('.ask')) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;
  const inText = (e.target as HTMLElement).matches?.('input[type="text"]');
  if (key === 'Escape') {
    if (document.querySelector('.pop')) return;
    e.preventDefault();
    if (player.handleEscape()) return;
    session.escape(e.repeat);
    return;
  }
  if (inText) return;
  if (!mod && key === ' ' && (document.activeElement === document.body || document.activeElement === null)) {
    e.preventDefault();
    void session.go();
    return;
  }
  if (mod && (key === 'ArrowUp' || key === 'ArrowDown')) {
    session.nudgeVolume(key === 'ArrowUp' ? 0.05 : -0.05);
    player.openVolume(false);
  } else if (mod && key.toLowerCase() === 'm') void setMini(!miniTarget);
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

// Nothing animates while the window is hidden.
document.addEventListener('visibilitychange', () => (root.dataset.windowHidden = String(document.hidden)));

// ---------- the visuals feed ----------

setInterval(() => {
  if (!visualsOpen) return;
  // The bed without the beat: the beat never reaches the picture.
  const lv = session.bedLevels();
  const s = session.phase;
  void emitTo('visuals', 'audio-frame', {
    rms: lv.rms, low: lv.low, high: lv.high,
    phase: s, mode: session.mode,
    landing: s === 'winding' || s === 'resting' || s === 'ending' || s === 'ready',
    rootHz: session.rootNow(),
    ratio: chordRatio(session.params.voicing),
  });
}, 50);

setInterval(async () => {
  if (visualsOpen && isTauri) visualsOpen = await isWindowOpen('visuals');
}, 3000);

// The menu bar's minutes-left title counts down (updates only when the text changes).
setInterval(() => {
  if (settings?.showTimeInMenuBar && session.phase === 'playing') {
    void updateTray(session, session.snapshot(), { shortcuts: settings.shortcutsEnabled, showTime: true });
  }
}, 15000);

// ---------- boot ----------

async function boot(): Promise<void> {
  settings = await loadSettings();
  await session.restore();
  player.firstRun = !settings.firstRunDone;
  await applySettings(settings);
  render();
  if (settings.mini) {
    // The window opens hidden, where the light was left; shrink to it before it shows.
    mini = true;
    player.setMini(true);
    app.dataset.mini = 'on';
    await setFrame(MINI.width, MINI.height, 0, 0, false);
  }

  if (isTauri) {
    const out = await invoke<{ name: string; kind: string } | null>('audio_output');
    if (out) {
      session.output = out;
      render();
    }
    await listen<string>('tray-action', (id) => {
      // The system flips a clicked check mark by itself; resend the true state.
      invalidateTray();
      void runAction(id).finally(() => void updateTray(session, session.snapshot(), { shortcuts: settings.shortcutsEnabled, showTime: settings.showTimeInMenuBar }));
    });
    await listen('audio-output', (c) => session.onOutputChange(c as Parameters<Session['onOutputChange']>[0]));
    await listen<boolean>('mic-in-use', (busy) => {
      micBusy = busy;
      session.setDucked(busy && settings.softenForCalls);
    });
    // The watcher's first report can arrive before this listener existed: ask once now.
    micBusy = (await invoke<boolean>('mic_in_use')) ?? false;
    session.setDucked(micBusy && settings.softenForCalls);
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
  const flags = await invoke<{ autostart: boolean; hide: boolean; log: boolean; preset: string | null; open: string | null; minutes: number | null }>('debug_flags');
  if (!flags) return;
  if (flags.preset) session.setPreset(flags.preset);
  if (flags.minutes !== null && flags.minutes !== undefined) session.setLength(flags.minutes > 0 ? flags.minutes : null);
  for (const name of (flags.open ?? '').split(',').filter(Boolean)) {
    try {
      if (name === 'expand') await setExpanded(true);
      else if (name === 'mini') await setMini(true, false);
      else if (name === 'full') await setMini(false, false);
      else if (name === 'pause') await new Promise((r) => setTimeout(r, 2000));
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

void boot().catch(async (err) => {
  // Whatever went wrong, never leave the person with an invisible app.
  console.error('Tonewell: start-up failed', err);
  void invoke('debug_log', { line: `start-up failed: ${String(err)}` }).catch(() => undefined);
  const w = await currentWindow();
  await w?.show();
});
