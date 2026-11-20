// The mini player window. It owns the sound (the session), mirrors itself
// into the menu bar, and feeds the optional Visuals window. On a phone it is
// the whole screen, and the lock screen takes the menu bar's place.

import { Session, type Notice, type Phase, type Snapshot } from './session/session';
import { Player, handleMenuId, type PlayerActions } from './ui/player';
import { SheetHost, sheetBuilders, type SheetName } from './ui/sheets';
import { invalidateTray, ladder, statusWords, trayError, updateTray, type TrayOptions } from './ui/tray';
import { check, item, popup, sep, submenu } from './ui/menu';
import { currentWindow, emitTo, invoke, isTauri, isWindowOpen, listen, openWindow } from './platform/bridge';
import { flushNow } from './platform/store';
import {
  checkDue, checkForUpdate, loadUpdateMemory, onUpdateStatus, restartToUpdate, saveUpdateMemory, updateStatus, type UpdateStatus,
} from './platform/updates';
import { chordRatio } from './visuals/chords';
import { GLOBAL_SHORTCUTS, loadSettings, patchSettings, type AppSettings } from './settings/model';
import { isPhone, keys } from './platform/os';
import { routes } from './platform/routes';
import { onPhone, onPlayback, phoneOutput, showSession, takeBack, type NowPlaying } from './platform/phone';

const session = new Session();
const app = document.getElementById('app')!;
const root = document.documentElement;
let settings: AppSettings;
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
/**
 * Mini mode's window: the player's top-left corner down to the bottom-right
 * of its light (15 + 112 by 22 + 112). The light keeps its place inside it,
 * so the window shrinks and grows with its top-left corner fixed and the
 * light never moves, even while macOS animates the frame (the page isn't
 * redrawn until the animation ends). Outside the light it's transparent.
 */
const MINI = { width: 127, height: 134 };

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
      // Never taller than the screen: a sheet scrolls inside instead.
      height = Math.min(height, Math.max(PLAYER.height, area.h - 16));
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

/** Where the window was before a sheet first grew it, and where growing left it. */
let sheetOrigin: { x: number; y: number } | null = null;
let sheetPlaced: { x: number; y: number } | null = null;
/** Sheet resizes, one after another, so a quick open-and-close can't cross over. */
let frameChain: Promise<void> = Promise.resolve();

async function logicalPosition(): Promise<{ x: number; y: number } | null> {
  const w = await currentWindow();
  if (!w) return null;
  try {
    const p = await w.outerPosition();
    const k = await w.scaleFactor();
    return { x: p.x / k, y: p.y / k };
  } catch {
    return null;
  }
}

/**
 * Make room for a sheet under the player (0: just the player). The top edge
 * stays put unless the sheet would run off the bottom of the screen; then the
 * window moves up, and moves back down when the sheet closes, if it hasn't
 * been dragged meanwhile.
 */
function resizeForSheet(sheetHeight: number): Promise<void> {
  // A phone's sheet rises over the player: no window to resize. Let the page draw the sheet
  // where it starts first, so it rises from there (a timer too: a hidden page draws no frames).
  if (isPhone) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, 50);
      requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(t), resolve())));
    });
  }
  const step = async () => {
    if (mini) return;
    const before = await logicalPosition();
    const stayed = (p: { x: number; y: number } | null) => !!(before && p && Math.abs(before.y - p.y) < 2 && Math.abs(before.x - p.x) < 2);
    if (sheetHeight > 0) {
      // Dragged since the last resize: where it was put is where it goes back to.
      if (!sheetOrigin || (sheetPlaced && !stayed(sheetPlaced))) sheetOrigin = before;
      await setFrame(PLAYER.width, PLAYER.height + sheetHeight);
      sheetPlaced = await logicalPosition();
    } else {
      const dy = stayed(sheetPlaced) && sheetOrigin && before ? sheetOrigin.y - before.y : 0;
      await setFrame(PLAYER.width, PLAYER.height, 0, dy);
      sheetOrigin = null;
      sheetPlaced = null;
    }
  };
  // One failed resize must not stop the ones after it.
  frameChain = frameChain.then(step).catch((err) => console.warn('Tonewell: resize failed', err));
  return frameChain;
}

/**
 * Shrink to the light alone, or grow back. Everything but the light fades
 * first (240 ms); then the window shrinks to the light with the system's
 * animation, its top-left corner fixed, so the light holds still. Growing
 * runs the same steps backwards. No step changes brightness quickly.
 */
/** Where mini mode is, or is heading if a shrink or grow is under way. */
const miniGoal = () => (miniRun ? miniTarget : mini);
const toggleMini = () => setMini(!miniGoal());

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
    if (sheets.isOpen) {
      sheets.closeNow();
      await resizeForSheet(0);
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

/** Bring the player forward (it may be hidden, asked from the menu bar), then open a sheet. */
async function showSheet(name: SheetName, arg?: unknown): Promise<void> {
  const w = await currentWindow();
  if (w && !(await w.isVisible().catch(() => true))) await w.show();
  await w?.setFocus();
  await sheets.open(name, null, arg);
}

const actions: PlayerActions = {
  toggleSheet: (name, opener) => sheets.toggle(name, opener),
  openSheet: (name, arg) => void showSheet(name, arg),
  toggleMini: () => void toggleMini(),
  startDrag: () => void currentWindow().then((w) => w?.startDragging()),
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
    isPhone
      ? [item('ctx:guide', 'Field guide'), item('ctx:learn', 'Learn'), item('ctx:settings', 'Settings')]
      : [
      check('ctx:top', 'Always on top', settings.alwaysOnTop),
      submenu('Snap to corner', [item('ctx:snap-tl', 'Top left'), item('ctx:snap-tr', 'Top right'), item('ctx:snap-bl', 'Bottom left'), item('ctx:snap-br', 'Bottom right')]),
      check('ctx:mini', `Mini player    ${keys('⌘M')}`, mini),
      sep,
      item('ctx:guide', 'Field guide    ?'),
      item('ctx:learn', `Learn    ${keys('⌘L')}`),
      item('ctx:settings', `Settings…    ${keys('⌘,')}`),
      sep,
      item('ctx:hide', `Hide window    ${keys('⌘W')}`),
        ],
    anchor,
    at,
  );
  if (!id) return;
  if (id === 'ctx:top') await applySettings({ ...settings, alwaysOnTop: !settings.alwaysOnTop }, true);
  else if (id === 'ctx:mini') await toggleMini();
  else if (id.startsWith('ctx:snap-')) await snapTo(id.slice(9) as 'tl');
  else if (id === 'ctx:guide') await sheets.open('guide', null);
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
  // Turning "Soften during calls" off mid-call brings the sound back up.
  if (isPhone && !settings.softenForCalls) session.setDucked(false);
  if (!isPhone) {
    if (isTauri && registeredShortcuts !== settings.shortcutsEnabled) await setShortcuts(settings.shortcutsEnabled);
    session.setDucked(micBusy && settings.softenForCalls);
    if (isTauri && prev?.showInDock !== settings.showInDock) void invoke('set_dock_visible', { visible: settings.showInDock }).catch(() => undefined);
    if (isTauri && prev?.checkUpdates && !settings.checkUpdates) void stopUpdates();
  }
  void updateTray(session, session.snapshot(), trayOptions());
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
    case 'mini':
      await currentWindow().then((w) => w?.show());
      return toggleMini();
    case 'check-updates':
      return checkUpdatesNow();
    case 'update-restart':
      return restartForUpdate();
    case 'update-later':
      // Not again until the next daily check.
      updateLaterUntil = Infinity;
      return;
    default:
      await handleMenuId(action, session, actions);
  }
}

// ---------- rendering ----------

const player = new Player(session, actions);
const sheets = new SheetHost(player.sheet, session, sheetBuilders((on) => player.setBadges(on)), {
  resize: resizeForSheet,
  leaveMini: async () => {
    if (mini || miniRun) await setMini(false);
  },
  openLearn: (card) => void openLearn(card),
  changed: (name) => {
    player.setSheet(name);
    app.dataset.sheet = name ?? '';
    syncBack();
  },
  fallbackFocus: () => player.lightButton(),
});
app.append(player.el);

// On a phone a sheet rises over the player; a tap beside it closes it.
if (isPhone) {
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  scrim.addEventListener('click', () => void sheets.close());
  app.append(scrim);
}

/** The lock screen's view of a session: the sound, where it stands, and the menu bar's controls. */
function nowPlaying(s: Snapshot): NowPlaying {
  if (s.phase === 'ready') return { state: 'stopped', title: s.preset.name, controls: [] };
  const words = statusWords(s);
  return {
    state: s.phase === 'playing' && !s.paused ? 'playing' : 'paused',
    title: s.preset.name,
    text: s.paused && s.notice ? s.notice.text : words.charAt(0).toUpperCase() + words.slice(1),
    subtext: s.mode === 'meditate' ? 'Meditate' : 'Focus',
    controls: ladder(s),
  };
}

let mediaKey = '';
function updateMedia(s: Snapshot): void {
  if (onPhone) {
    // A session's end gives up the sound, and with it any softening for a call: no "gain"
    // will come to undo it, and the next session starts at full volume.
    if (s.phase === 'ready') session.setDucked(false);
    void showSession(nowPlaying(s));
    return;
  }
  const phase = s.phase;
  const title = s.preset.name;
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
  updateMedia(s);
  root.dataset.mode = s.mode;
  // Paused by a notice keeps the mode's colours; resting cools to dusk or sand.
  root.dataset.phase = s.paused ? 'paused' : s.phase;
  setSounding(s.phase);
  player.render(s);
  sheets.render(s);
  if (settings) void updateTray(session, s, trayOptions());
  if (s.phase === 'ready' && lastPhase !== 'ready' && s.timerDone && !s.notice) {
    session.setNotice({ kind: 'done', text: `Done, ${s.prefs.minutes ?? ''} min.`.replace(' , min', ''), ttl: 10 });
  }
  // A session just ended: an update that came in meanwhile waits behind anything else showing.
  if (s.phase === 'ready' && lastPhase !== 'ready') offerUpdate();
  // One started: a check asked for before it reports nothing more.
  if (s.phase !== 'ready') checkAsked = false;
  if (s.phase === 'playing' && !settings?.firstRunDone && settings) {
    void applySettings({ ...settings, firstRunDone: true }, true);
    player.firstRun = false;
  }
  lastPhase = s.phase;
}

session.addEventListener('change', render);
session.addEventListener('notice-action', (e) => void runAction((e as CustomEvent<string>).detail));

// ---------- updates ----------

let update: UpdateStatus | null = null;
/** The person said Later: don't offer the update again before this. */
let updateLaterUntil = 0;
/** The person asked to check, so say how it went. */
let checkAsked = false;

function trayOptions(): TrayOptions {
  return {
    shortcuts: settings.shortcutsEnabled,
    showTime: settings.showTimeInMenuBar,
    update: update?.state === 'ready' ? update.version : null,
    beatNow: session.phase === 'playing' ? session.beatHzNow() : null,
    mini: miniGoal(),
  };
}

/**
 * Say something about updates. Only while nothing plays or is starting, so
 * nothing about updates ever appears mid-session; it waits behind any other
 * notice, and a newer one replaces it.
 */
function updateNote(n: Omit<Notice, 'kind'>): void {
  if (!session.idle) return;
  session.clearNotices(['update']);
  session.setNotice({ kind: 'update', ...n });
}

/** Offer the downloaded update, only while nothing plays, and not after Later. */
function offerUpdate(): void {
  if (update?.state !== 'ready' || !update.version) return;
  if (session.holdStarts || Date.now() < updateLaterUntil) return;
  updateNote({
    text: `Version ${update.version} is ready.`,
    sub: update.installsAtQuit ? 'Or it installs when you quit.' : undefined,
    actions: [{ id: 'update-restart', label: 'Restart' }, { id: 'update-later', label: 'Later' }],
  });
}

function onUpdate(next: UpdateStatus): void {
  const prev = update;
  update = next;
  // Remember when a check got an answer; a failed one is retried within the hour.
  if (next.checkedAt && next.checkedAt !== prev?.checkedAt && (next.state === 'latest' || next.state === 'ready')) {
    void saveUpdateMemory({ lastCheck: next.checkedAt });
  }
  if (checkAsked) {
    if (next.state === 'downloading') updateNote({ text: `Downloading version ${next.version}…` });
    else if (next.state === 'latest') updateNote({ text: 'Tonewell is up to date.', ttl: 5 });
    else if (next.state === 'failed') updateNote({ text: 'Couldn’t check for updates.', sub: 'Tonewell will try again later.', ttl: 8 });
    if (next.state !== 'checking' && next.state !== 'downloading') checkAsked = false;
  }
  if (next.state === 'ready' && prev?.state !== 'ready') offerUpdate();
  if (settings) void updateTray(session, session.snapshot(), trayOptions());
}

async function checkUpdatesNow(): Promise<void> {
  if (update?.state === 'checking' || update?.state === 'downloading') return;
  updateLaterUntil = 0;
  if (update?.state === 'ready') return offerUpdate();
  // Asked during a session, it still looks; the menu bar shows what it found.
  checkAsked = session.idle;
  updateNote({ text: 'Checking for updates…' });
  const result = await checkForUpdate();
  // No status event arrived (the call itself failed): settle it from the answer.
  if (checkAsked && result) onUpdate({ ...result, current: result.current || update?.current || '' });
}

/** The daily look, when the person allows it. Development builds never look on their own. */
async function scheduledCheck(): Promise<void> {
  if (!settings?.checkUpdates || import.meta.env.DEV) return;
  if (update?.state === 'checking' || update?.state === 'downloading') return;
  const { lastCheck } = await loadUpdateMemory();
  if (!checkDue(lastCheck, Date.now())) return;
  // A new day: an update set aside with Later, or one that failed to install, is offered again.
  updateLaterUntil = 0;
  await checkForUpdate();
}

async function restartForUpdate(): Promise<void> {
  if (update?.state !== 'ready' || !session.idle) return;
  // From here until the app restarts, nothing may start a session.
  session.holdStarts = true;
  updateNote({ text: 'Installing the update…' });
  await session.quit();
  await flushNow();
  try {
    await restartToUpdate();
  } catch {
    session.holdStarts = false;
    updateNote({ text: 'The update didn’t install.', sub: 'Tonewell will offer it again tomorrow.', ttl: 10 });
  }
}

/** Turning updates off also drops one already downloaded, so nothing installs at quit. */
async function stopUpdates(): Promise<void> {
  session.clearNotices(['update']);
  const status = await invoke<UpdateStatus>('update_discard').catch(() => undefined);
  if (status) onUpdate(status);
}

async function startUpdates(): Promise<void> {
  const status = await updateStatus();
  if (!status) return;
  update = status;
  const memory = await loadUpdateMemory();
  if (memory.lastVersion && memory.lastVersion !== status.current) {
    updateNote({ text: `Updated to version ${status.current}.`, ttl: 8 });
  }
  if (memory.lastVersion !== status.current) await saveUpdateMemory({ lastVersion: status.current });
  // Not at launch, which may be login, before the network is up.
  setTimeout(() => {
    void scheduledCheck();
    setInterval(() => void scheduledCheck(), 3600 * 1000);
  }, 60 * 1000);
}

// For the browser checks in development only; never in a built app.
if (import.meta.env.DEV) Object.assign(window, { __tonewell: { session, player, sheets, setMini } });

// ---------- keyboard ----------

addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;
  const inText = (e.target as HTMLElement).matches?.('input[type="text"]');
  if (key === 'Escape') {
    if (document.querySelector('.pop')) return;
    e.preventDefault();
    // The volume row, then a sheet, take Esc before the stop ladder does.
    if (player.handleEscape()) return;
    if (!e.repeat && sheets.escape()) return;
    if (sheets.isOpen) return;
    session.escape(e.repeat);
    return;
  }
  if (inText) return;
  // The naming sheet keeps the keyboard to itself (Esc, Tab and Return are its own).
  if (sheets.name === 'name') return;
  if (!mod && key === '?') {
    e.preventDefault();
    sheets.toggle('guide', null);
    return;
  }
  if (!mod && key === ' ' && (document.activeElement === document.body || document.activeElement === null)) {
    e.preventDefault();
    void session.go();
    return;
  }
  if (mod && (key === 'ArrowUp' || key === 'ArrowDown')) {
    session.nudgeVolume(key === 'ArrowUp' ? 0.05 : -0.05);
    player.openVolume(false);
  } else if (mod && key.toLowerCase() === 'm') void toggleMini();
  else if (!mod && (key === '+' || key === '=')) session.wind(5);
  else if (!mod && (key === '-' || key === '_')) session.wind(-5);
  else if (!mod && key === '[') session.stepPreset(-1);
  else if (!mod && key === ']') session.stepPreset(1);
  else if (mod && key === '1') session.setMode('meditate');
  else if (mod && key === '2') session.setMode('focus');
  else if (mod && key.toLowerCase() === 'b') session.setParam('beatOn', session.params.beatOn ? 0 : 1);
  else if (mod && key.toLowerCase() === 'e') sheets.toggle('shape', null);
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

// The menu bar's minutes-left title counts down, and the Beat item follows a glide
// (both send only when the text changes).
setInterval(() => {
  if (settings && session.phase === 'playing') void updateTray(session, session.snapshot(), trayOptions());
}, 15000);

// ---------- boot ----------

async function boot(): Promise<void> {
  settings = await loadSettings();
  await session.restore();
  player.firstRun = !settings.firstRunDone;
  await applySettings(settings);
  render();
  if (settings.mini && !isPhone) {
    // The window opens hidden, where the light was left; shrink to it before it shows.
    // Mini is now where it's meant to be, too, so the next toggle grows it back.
    mini = true;
    miniTarget = true;
    player.setMini(true);
    app.dataset.mini = 'on';
    await setFrame(MINI.width, MINI.height, 0, 0, false);
  }

  if (isTauri) {
    if (onPhone) await phoneBoot();
    else await desktopBoot();
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
    if (!isPhone) await startUpdates();
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

/** The menu bar, the output and microphone watchers, and quitting with a fade. */
async function desktopBoot(): Promise<void> {
  const out = await invoke<{ name: string; kind: string } | null>('audio_output');
  if (out) {
    session.output = out;
    render();
  }
  // Before anything can ask for a check, so no answer is missed.
  await onUpdateStatus(onUpdate);
  await listen<string>('tray-action', (id) => {
    // The system flips a clicked check mark by itself; resend the true state.
    invalidateTray();
    void runAction(id).finally(() => void updateTray(session, session.snapshot(), trayOptions()));
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
}

/** The lock screen and headphone buttons, headphones coming and going, calls, and Back. */
async function phoneBoot(): Promise<void> {
  const out = await phoneOutput();
  if (out) {
    session.output = out;
    render();
  }
  await onPlayback('action', ({ id }) => void runAction(id));
  await onPlayback('output', (c) => session.onOutputChange(c));
  await onPlayback('focus', ({ state }) => {
    if (state === 'transient') session.setDucked(settings.softenForCalls, 'A call or another app is speaking');
    else if (state === 'gain') session.setDucked(false);
    else if (state === 'loss') {
      // No "gain" follows a loss: the softening ends here, and Resume asks for the sound back.
      session.setDucked(false);
      session.interrupt('Another app is playing, so this paused.');
    }
  });
  await onPlayback('back', () => void goBack());
  routes().onChange(syncBack);
}

/** Back closes the page in front, else steps back out of a sheet. */
async function goBack(): Promise<void> {
  const r = routes();
  if (r.top()) await r.back();
  else if (sheets.isOpen) sheets.escape();
}

/** Back belongs to Tonewell only while something is open over the player. */
function syncBack(): void {
  if (onPhone) void takeBack(sheets.isOpen || routes().top() !== null);
}

async function diagnostics(): Promise<void> {
  const flags = await invoke<{ autostart: boolean; hide: boolean; log: boolean; preset: string | null; open: string | null; minutes: number | null }>('debug_flags');
  if (!flags) return;
  if (flags.preset) session.setPreset(flags.preset);
  if (flags.minutes !== null && flags.minutes !== undefined) session.setLength(flags.minutes > 0 ? flags.minutes : null);
  const log = (line: string) => void invoke('debug_log', { line });
  for (const name of (flags.open ?? '').split(',').filter(Boolean)) {
    try {
      if (name === 'sheet-close') await sheets.close();
      else if (name.startsWith('sheet-')) await sheets.open(name.slice(6) as SheetName);
      else if (name === 'mini') await setMini(true, false);
      else if (name === 'full') await setMini(false, false);
      else if (name === 'pause') await new Promise((r) => setTimeout(r, 2000));
      else if (name === 'visuals') await openVisuals();
      else if (name === 'learn') await openLearn();
      else if (name === 'settings') actions.openSettings();
      else if (name === 'update-check') await checkUpdatesNow();
      else if (name === 'update-restart') await restartForUpdate();
      else if (name === 'quit') {
        await session.quit();
        await flushNow();
        await invoke('quit_now');
      }
      if (name.startsWith('update')) log(`${name}: ${JSON.stringify(update)}`);
    } catch (err) {
      void invoke('debug_log', { line: `open ${name} failed: ${String(err)}` });
    }
  }
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
