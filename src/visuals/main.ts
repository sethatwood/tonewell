// The Visuals window: optional, opened on demand, and the only place that
// renders anything continuously. Closing it stops all rendering; the sound
// lives in the mini player and is never affected.
//
// Photosensitivity rules:
// - every input that changes brightness is smoothed (time constants ≥ 1 s)
//   and slew-limited in renderer.ts, so overall brightness can't swing
//   faster than 3 Hz;
// - a global brightness cap, lower again in Calm visuals;
// - no beat-synced pulsing: the beat frequency is never fed to the picture;
// - Esc fades to dark at once (over about a second, never a cut).

import '../styles/visuals.css';
import { EMBER, PALETTES, SCENES } from './shader';
import { Visuals } from './renderer';
import { SoundFollower } from './follow';
import { emitTo, listen, currentWindow, isTauri } from '../platform/bridge';
import { loadSettings, patchSettings, type AppSettings } from '../settings/model';
import { h } from '../ui/controls';
import { uiIcon, type UiIcon } from '../ui/icons';
import { computer } from '../platform/os';

interface Frame {
  /** The drone's chord as a small whole-number ratio, for the Harmonograph. */
  ratio?: [number, number];
  /** The bed's levels without the beat, on a decibel scale (WebAudioEngine.bedLevels). */
  rms: number;
  low: number;
  high: number;
  rootHz?: number;
  phase: string;
  mode: string;
  landing: boolean;
}

const doc = document.documentElement;
doc.dataset.mode = 'meditate';
document.title = 'Tonewell Visuals';

const canvas = h('canvas', { 'aria-hidden': 'true' });
document.body.append(canvas);
const darkHint = h('p', { class: 'dark-hint vis-ui' }, 'Dark. Esc again closes the window; any other key brings the light back.');
document.body.append(darkHint);

const vis = Visuals.create(canvas);
addEventListener('resize', () => vis?.resize());

let settings: AppSettings;
const state = {
  flow: 1,
  glow: 0.85,
  dark: false,
  pacer: false,
};
let frame: Frame = { rms: 0, low: 0, high: 0, phase: 'ready', mode: 'meditate', landing: true };
let lastFrameAt = 0;
const follower = new SoundFollower();

const nameEl = h('span', { class: 'vis-bar__scene', 'aria-live': 'polite' });
function setName(): void {
  if (vis) nameEl.textContent = SCENES[vis.target()];
}
if (vis) vis.onScene = setName;
function goTo(k: number): void {
  vis?.goTo(k);
}
function target(): number {
  return vis?.target() ?? 0;
}

let last = performance.now();
function draw(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const calm = settings?.calmVisuals ?? true;
  const cap = Math.min(settings?.brightnessCap ?? 0.8, calm ? 0.7 : 1);
  const react = (settings?.audioReactivity ?? 0.4) * (calm ? 0.5 : 1);
  const stale = performance.now() - lastFrameAt > 2000;
  const landing = stale ? false : frame.landing && frame.phase !== 'ready';
  // Follow how the sound changes while a session is on, never the beat (the frames carry the bed only).
  const heard = !stale && frame.phase !== 'ready' ? frame : null;
  const f = follower.update(dt, heard);
  // Soft landing and Calm visuals dim, slow and desaturate.
  vis?.step(dt, {
    fade: state.dark ? 0 : landing ? 0.28 : frame.phase === 'ready' && !stale ? 0.45 : 1,
    dark: state.dark,
    bright: state.glow * cap,
    sat: landing ? 0.5 : calm ? 1.15 : 1.6,
    flow: state.flow * (landing ? 0.35 : 1) * (calm ? 0.6 : 1) * (1 + 0.5 * f.drive * react),
    swell: f.swell * react,
    bloom: f.bloom * react,
    hue: f.hue * react,
    pacer: state.pacer,
    ratio: frame.ratio,
  });
  requestAnimationFrame(draw);
}

/** Choose a palette (or the next one); the change cross-fades over about four seconds. */
function choosePalette(index?: number): void {
  if (!vis) return;
  const next = index === undefined ? vis.cyclePalette() : vis.choosePalette(index);
  if (next == null) return;
  paintSwatches(next);
  settings.visualsPalette = next;
  void patchSettings({ visualsPalette: next });
}

// ---------- controls ----------

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let pacerBtn: HTMLButtonElement | null = null;
let lightBtn: HTMLButtonElement | null = null;
let lightPanel: HTMLElement | null = null;
const swatches: HTMLButtonElement[] = [];
/** Repaints the Light panel's safety settings after another window changed them. */
let paintSafety: () => void = () => undefined;

function poke(): void {
  document.body.classList.remove('idle');
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // Never while the pointer is over the toolbar or the panel, or focus is in them.
    if (document.querySelector('.vis-bar:hover, .light-panel:hover, .vis-bar:focus-within, .light-panel:focus-within')) return poke();
    document.body.classList.add('idle');
  }, 3500);
}

async function toggleFullscreen(): Promise<void> {
  const w = await currentWindow();
  if (w) await w.setFullscreen(!(await w.isFullscreen()));
  else if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen().catch(() => undefined);
}

async function closeWindow(): Promise<void> {
  void emitTo('main', 'visuals-bye');
  const w = await currentWindow();
  if (w) await w.close();
  else window.close();
}

function iconButton(icon: UiIcon, label: string, onClick: () => void, extra: Record<string, string> = {}): HTMLButtonElement {
  const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, ...extra }, uiIcon(icon));
  b.addEventListener('click', onClick);
  return b;
}

/** Each palette's swatch: two of its colors, split on the diagonal. */
const SWATCHES: Record<string, [string, string]> = {
  Twilight: ['#8A6FD8', '#F0A57A'],
  Hearth: ['#C8553D', '#F2C27A'],
  'Sea glass': ['#2A9D8F', '#A8E6CF'],
  Moss: ['#5F7F35', '#C6E3A0'],
  Dusk: ['#74437F', '#F0A3B5'],
  Moonlight: ['#5E66A6', '#E6EBFF'],
};

function paintSwatches(current: number): void {
  swatches.forEach((b, i) => {
    b.setAttribute('aria-checked', String(i === current));
    b.tabIndex = i === current ? 0 : -1;
  });
}

function slider(label: string, min: number, max: number, value: number, words: (v: number) => string, on: (v: number) => void): { el: HTMLElement; set(v: number): void } {
  const input = h('input', { class: 'range', type: 'range', min, max, step: 0.01, value, 'aria-label': label });
  const out = h('span', { class: 'field__value', 'aria-hidden': 'true' });
  const paint = () => {
    input.style.setProperty('--v', String((Number(input.value) - min) / (max - min)));
    out.textContent = words(Number(input.value));
    input.setAttribute('aria-valuetext', out.textContent);
  };
  input.addEventListener('input', () => {
    paint();
    on(Number(input.value));
  });
  paint();
  return {
    el: h('label', { class: 'field' }, h('span', {}, label), input, out),
    set: (v) => {
      if (document.activeElement === input) return;
      input.value = String(v);
      paint();
    },
  };
}

function buildLightPanel(): HTMLElement {
  const flow = slider('Flow', 0.2, 2, state.flow, (v) => (v < 0.7 ? 'slow' : v < 1.3 ? 'gentle' : 'lively'), (v) => (state.flow = v));
  const glow = slider('Glow', 0.15, 1.2, state.glow, (v) => (v < 0.7 ? 'soft' : v < 1 ? 'warm' : 'bright'), (v) => (state.glow = v));
  const palettes = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Palette' });
  PALETTES.forEach((pal, i) => {
    const [a, b] = SWATCHES[pal.name] ?? ['#888', '#ccc'];
    const sw = h('button', { class: 'swatch', type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': pal.name, title: pal.name, style: `--a:${a};--b:${b}` });
    sw.addEventListener('click', () => choosePalette(i));
    swatches.push(sw);
    palettes.append(sw);
  });
  palettes.addEventListener('keydown', (e) => {
    const i = swatches.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
    e.preventDefault();
    e.stopPropagation();
    const j = (i + (e.key === 'ArrowRight' ? 1 : swatches.length - 1)) % swatches.length;
    swatches[j].focus();
    choosePalette(j);
  });
  paintSwatches(vis?.targetPalette() ?? 0);

  const calm = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-label': 'Calm visuals', 'aria-checked': String(settings.calmVisuals) });
  calm.addEventListener('click', async () => {
    settings = await patchSettings({ calmVisuals: !settings.calmVisuals });
    paintSafety();
  });
  const cap = slider('Brightness limit', 0.3, 1, settings.brightnessCap, (v) => `${Math.round(v * 100)}%`, (v) => {
    settings.brightnessCap = Math.round(v * 100) / 100;
    void patchSettings({ brightnessCap: settings.brightnessCap });
  });
  const follow = slider('Follow the sound', 0, 1, settings.audioReactivity, (v) => `${Math.round(v * 100)}%`, (v) => {
    settings.audioReactivity = Math.round(v * 100) / 100;
    void patchSettings({ audioReactivity: settings.audioReactivity });
  });
  paintSafety = () => {
    calm.setAttribute('aria-checked', String(settings.calmVisuals));
    cap.set(settings.brightnessCap);
    follow.set(settings.audioReactivity);
  };

  return h(
    'div',
    { class: 'light-panel vis-ui', id: 'light-panel', role: 'dialog', 'aria-label': 'Light', 'data-closed': '' },
    h('div', { class: 'light-panel__head' }, h('h2', { class: 'light-panel__title' }, 'Light'), h('span', { class: 'light-panel__note' }, 'P cycles palettes')),
    flow.el,
    glow.el,
    h('div', { class: 'field field--palette' }, h('span', {}, 'Palette'), palettes),
    h('hr'),
    h('div', { class: 'row' }, h('div', { class: 'row__text' }, h('span', { class: 'row__label' }, 'Calm visuals'), h('span', { class: 'row__help' }, 'Slower, dimmer, softer contrast.')), calm),
    cap.el,
    follow.el,
    h('p', { class: 'light-panel__foot' }, 'Brightness never changes faster than three times a second, and the beat never drives the picture.'),
  );
}

function toggleLight(open?: boolean): void {
  if (!lightPanel || !lightBtn) return;
  const on = open ?? lightPanel.hasAttribute('data-closed');
  lightPanel.toggleAttribute('data-closed', !on);
  lightPanel.inert = !on;
  lightBtn.setAttribute('aria-expanded', String(on));
}

function buildBar(): HTMLElement {
  const prev = iconButton('chevron-left', 'Previous scene', () => goTo(target() - 1));
  const next = iconButton('chevron-right', 'Next scene', () => goTo(target() + 1));
  const drift = iconButton('drift', 'Drift to the next scene every 80 seconds', () => {
    if (!vis) return;
    vis.drift = !vis.drift;
    vis.since = 0;
    drift.setAttribute('aria-pressed', String(vis.drift));
  }, { 'aria-pressed': 'true' });
  pacerBtn = iconButton('breath-pacer', 'Breath pacer', () => {
    state.pacer = !state.pacer;
    pacerBtn!.setAttribute('aria-pressed', String(state.pacer));
  }, { 'aria-pressed': 'false' });
  lightBtn = iconButton('brightness', 'Light', () => toggleLight(), { 'aria-expanded': 'false', 'aria-controls': 'light-panel' });
  const fs = iconButton('fullscreen', 'Full screen', () => void toggleFullscreen());
  const close = iconButton('close', 'Close visuals', () => void closeWindow());
  setName();
  return h(
    'div',
    { class: 'vis-bar vis-ui', role: 'toolbar', 'aria-label': 'Visuals' },
    prev,
    nameEl,
    next,
    h('span', { class: 'vis-bar__sep', 'aria-hidden': 'true' }),
    drift,
    pacerBtn,
    lightBtn,
    fs,
    h('span', { class: 'vis-bar__sep', 'aria-hidden': 'true' }),
    close,
  );
}

function firstOpenNote(): Promise<boolean> {
  return new Promise((resolve) => {
    const calm = h('input', { type: 'checkbox', id: 'calm', checked: true });
    const show = h('button', { class: 'btn btn--primary', type: 'button' }, 'Show visuals');
    const notNow = h('button', { class: 'btn', type: 'button' }, 'Not now');
    const note = h(
      'div',
      { class: 'note vis-ui' },
      h(
        'section',
        { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'note-title' },
        h('h1', { id: 'note-title' }, 'Before the lights come up'),
        h('p', {}, 'The visuals fill the screen with slow, shifting color. Brightness never changes faster than three times a second, and Calm visuals keeps it dimmer still.'),
        h('p', {}, 'If you have photosensitive epilepsy, or patterns of light have ever made you unwell, talk to your doctor before using them. If anything feels wrong, press Esc and the screen fades to dark at once.'),
        h('label', { class: 'check', for: 'calm' }, calm, h('span', {}, 'Calm visuals (you can change this in the Light panel)')),
        h('div', { class: 'dialog__actions' }, notNow, show),
      ),
    );
    document.body.append(note);
    show.focus();
    show.addEventListener('click', () => {
      settings.calmVisuals = calm.checked;
      settings.visualsWarned = true;
      note.remove();
      resolve(true);
    });
    notNow.addEventListener('click', () => resolve(false));
  });
}

addEventListener('keydown', (e) => {
  if (document.querySelector('.note')) return;
  poke();
  if (e.key === 'Escape') {
    e.preventDefault();
    if (e.repeat) return;
    if (lightPanel && !lightPanel.hasAttribute('data-closed') && lightPanel.contains(document.activeElement)) {
      toggleLight(false);
      lightBtn?.focus();
      return;
    }
    if (state.dark) void closeWindow();
    else {
      state.dark = true;
      document.body.classList.add('dark');
    }
    return;
  }
  if (state.dark) {
    state.dark = false;
    document.body.classList.remove('dark');
    return;
  }
  if (e.repeat) return;
  if (e.key === 'f' || e.key === 'F') void toggleFullscreen();
  else if (e.key === 'ArrowRight' && !(e.target as HTMLElement).matches?.('input')) goTo(target() + 1);
  else if (e.key === 'ArrowLeft' && !(e.target as HTMLElement).matches?.('input')) goTo(target() - 1);
  else if (e.key === 'e' || e.key === 'E') goTo(EMBER);
  else if (e.key === 'b' || e.key === 'B') pacerBtn?.click();
  else if (e.key === 'p' || e.key === 'P') choosePalette();
  else if (e.key === ' ' && document.activeElement === document.body) {
    e.preventDefault();
    void emitTo('main', 'remote-action', 'go');
  }
});
['mousemove', 'pointerdown'].forEach((ev) => addEventListener(ev, poke, { passive: true }));
canvas.addEventListener('dblclick', () => void toggleFullscreen());

async function boot(): Promise<void> {
  settings = await loadSettings();
  if (vis) vis.palette = vis.nextPalette = Math.min(PALETTES.length - 1, Math.max(0, settings.visualsPalette ?? 0));
  await listen<Frame>('audio-frame', (f) => {
    frame = f;
    lastFrameAt = performance.now();
  });
  await listen('settings-changed', async () => {
    const { reloadDoc } = await import('../platform/store');
    await reloadDoc();
    settings = await loadSettings();
    paintSafety();
  });
  void emitTo('main', 'visuals-hello');
  if (!settings.visualsWarned) {
    const ok = await firstOpenNote();
    if (!ok) {
      await closeWindow();
      return;
    }
    settings = await patchSettings({ calmVisuals: settings.calmVisuals, visualsWarned: true });
  }
  if (!vis) {
    document.body.append(h('p', { style: 'color:#aaa;padding:24px' }, `This ${computer} could not start WebGL, so the visuals can’t run here. The sound is unaffected.`));
    return;
  }
  lightPanel = buildLightPanel();
  lightPanel.inert = true;
  document.body.append(lightPanel, buildBar());
  poke();
  requestAnimationFrame(draw);
  void isTauri;
}

void boot();
