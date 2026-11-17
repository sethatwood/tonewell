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

import { EMBER, PALETTES, SCENES } from './shader';
import { Visuals } from './renderer';
import { emitTo, listen, currentWindow, isTauri } from '../platform/bridge';
import { loadSettings, patchSettings, type AppSettings } from '../settings/model';
import { h } from '../ui/controls';

interface Frame {
  /** The drone's chord as a small whole-number ratio, for the Harmonograph. */
  ratio?: [number, number];
  rms: number;
  low: number;
  high: number;
  phase: string;
  mode: string;
  landing: boolean;
}

const doc = document.documentElement;
doc.dataset.mode = 'meditate';
document.title = 'Tonewell Visuals';
const style = document.createElement('style');
style.textContent = `
html,body{background:#000;overflow:hidden;cursor:default}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block}
.bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;justify-content:center;
  width:min(880px,calc(100% - 24px));padding:10px 14px;background:rgba(18,10,22,.78);border-radius:var(--r-pop);box-shadow:0 0 0 1px var(--line);
  transition:opacity .9s var(--ease-ui),transform .9s var(--ease-ui)}
body.idle .bar{opacity:0;transform:translate(-50%,10px);pointer-events:none}
body.idle{cursor:none}
.bar .grp{display:flex;align-items:center;gap:6px}
.bar .name{min-width:9.5em;text-align:center;font:600 20px var(--voice)}
.bar label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-2)}
.bar .scale{width:96px}
.bar .btn{min-height:30px}
.bar .btn[aria-pressed='true']{border-color:var(--accent)}
.note{position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.6)}
.note section{width:min(460px,100%);padding:28px 30px 24px;border-radius:18px;background:var(--ground);box-shadow:0 0 0 1px var(--line);display:flex;flex-direction:column;gap:14px}
.note h1{margin:0;font:600 30px/1.1 var(--voice)}
.note p{margin:0;font-size:15px;line-height:1.6;color:var(--ink-2)}
.note p strong{color:var(--ink)}
.note .check{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5}
.note .check input{margin:3px 0 0;width:16px;height:16px;accent-color:var(--accent)}
.note .row{display:flex;gap:8px;margin-top:6px}
.note .row .primary{flex:1;min-height:44px}
.note .row .btn{min-height:44px}
.dark-hint{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);color:#6d6270;font-size:13px;opacity:0;transition:opacity 1s}
body.dark .dark-hint{opacity:1}
`;
document.head.append(style);

const canvas = h('canvas', { 'aria-hidden': 'true' });
document.body.append(canvas);
const darkHint = h('p', { class: 'dark-hint' }, 'Dark. Press any key for light, or Esc again to close.');
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

const nameEl = h('span', { class: 'name', 'aria-live': 'polite' });
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
  // Soft landing and Calm visuals dim, slow and desaturate.
  vis?.step(dt, {
    fade: state.dark ? 0 : landing ? 0.28 : frame.phase === 'ready' && !stale ? 0.45 : 1,
    dark: state.dark,
    bright: state.glow * cap,
    sat: landing ? 0.5 : calm ? 1.15 : 1.6,
    flow: state.flow * (landing ? 0.35 : 1) * (calm ? 0.6 : 1),
    bass: frame.low * react,
    hi: frame.high * react,
    pacer: state.pacer,
    ratio: frame.ratio,
  });
  requestAnimationFrame(draw);
}

/** Choose the next palette; the change cross-fades over about four seconds. */
function cyclePalette(): void {
  const next = vis?.cyclePalette();
  if (next == null) return;
  paletteBtn?.replaceChildren(PALETTES[next].name);
  settings.visualsPalette = next;
  void patchSettings({ visualsPalette: next });
}

// ---------- controls ----------

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let pacerBtn: HTMLButtonElement | null = null;
let paletteBtn: HTMLButtonElement | null = null;
function poke(): void {
  document.body.classList.remove('idle');
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 3500);
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

function buildBar(): HTMLElement {
  const prev = h('button', { class: 'icon-btn', 'aria-label': 'Previous scene' }, '‹');
  const next = h('button', { class: 'icon-btn', 'aria-label': 'Next scene' }, '›');
  prev.addEventListener('click', () => goTo(target() - 1));
  next.addEventListener('click', () => goTo(target() + 1));
  const drift = h('button', { class: 'btn', 'aria-pressed': 'true' }, 'Drift');
  drift.addEventListener('click', () => {
    if (!vis) return;
    vis.drift = !vis.drift;
    vis.since = 0;
    drift.setAttribute('aria-pressed', String(vis.drift));
  });
  const slider = (label: string, min: number, max: number, value: number, on: (v: number) => void) => {
    const input = h('input', { type: 'range', class: 'scale', min, max, step: 0.01, value });
    const paint = () => input.style.setProperty('--lit-w', `${((Number(input.value) - min) / (max - min)) * 100}%`);
    input.addEventListener('input', () => {
      paint();
      on(Number(input.value));
    });
    paint();
    return h('label', {}, label, input);
  };
  const calm = h('button', { class: 'btn', 'aria-pressed': String(settings.calmVisuals) }, 'Calm');
  calm.addEventListener('click', async () => {
    settings.calmVisuals = !settings.calmVisuals;
    calm.setAttribute('aria-pressed', String(settings.calmVisuals));
    settings = await patchSettings({ calmVisuals: settings.calmVisuals });
  });
  pacerBtn = h('button', { class: 'btn', 'aria-pressed': 'false', title: 'A ring that grows as you breathe in and shrinks as you breathe out, 5.5 breaths a minute' }, 'Breath pacer');
  pacerBtn.addEventListener('click', () => {
    state.pacer = !state.pacer;
    pacerBtn!.setAttribute('aria-pressed', String(state.pacer));
  });
  paletteBtn = h('button', { class: 'btn', title: 'Palette (P)' }, PALETTES[vis?.palette ?? 0].name);
  paletteBtn.addEventListener('click', () => cyclePalette());
  const fs = h('button', { class: 'btn' }, 'Full screen');
  fs.addEventListener('click', () => void toggleFullscreen());
  const close = h('button', { class: 'btn quiet' }, 'Close');
  close.addEventListener('click', () => void closeWindow());
  setName();
  return h(
    'div',
    { class: 'bar', role: 'toolbar', 'aria-label': 'Visuals' },
    h('div', { class: 'grp' }, prev, nameEl, next, drift),
    slider('Flow', 0.2, 2, state.flow, (v) => (state.flow = v)),
    slider('Glow', 0.15, 1.2, state.glow, (v) => (state.glow = v)),
    h('div', { class: 'grp' }, paletteBtn, pacerBtn, calm, fs, close),
  );
}

function firstOpenNote(): Promise<boolean> {
  return new Promise((resolve) => {
    const calm = h('input', { type: 'checkbox', id: 'calm', checked: true });
    const show = h('button', { class: 'btn primary' }, 'Show visuals');
    const notNow = h('button', { class: 'btn' }, 'Not now');
    const note = h(
      'div',
      { class: 'note' },
      h(
        'section',
        { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'note-title' },
        h('h1', { id: 'note-title' }, 'Before the lights come up'),
        h('p', {}, 'The visuals fill the screen with slow, shifting color. Brightness never changes faster than three times a second, and Calm visuals keeps it dimmer still.'),
        h('p', {}, 'If you have photosensitive epilepsy, or patterns of light have ever made you unwell, talk to your doctor before using them. If anything feels wrong, press Esc and the screen fades to dark at once.'),
        h('label', { class: 'check', for: 'calm' }, calm, h('span', {}, h('strong', {}, 'Calm visuals'), ': dimmer, slower, softer color. Change it any time in Settings.')),
        h('div', { class: 'row' }, show, notNow),
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
  else if (e.key === 'ArrowRight') goTo(target() + 1);
  else if (e.key === 'ArrowLeft') goTo(target() - 1);
  else if (e.key === 'e' || e.key === 'E') goTo(EMBER);
  else if (e.key === 'b' || e.key === 'B') pacerBtn?.click();
  else if (e.key === 'p' || e.key === 'P') cyclePalette();
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
    document.body.append(h('p', { style: 'color:#aaa;padding:24px' }, 'This Mac could not start WebGL, so the visuals can’t run here. The sound is unaffected.'));
    return;
  }
  document.body.append(buildBar());
  poke();
  requestAnimationFrame(draw);
  void isTauri;
}

void boot();
