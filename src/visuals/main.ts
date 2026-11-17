// The Visuals window: optional, opened on demand, and the only place that
// renders anything continuously. Closing it stops all rendering; the sound
// lives in the mini player and is never affected.
//
// Photosensitivity rules, enforced here:
// - every input that changes brightness is smoothed (time constants ≥ 1 s)
//   and slew-limited, so overall brightness can't swing faster than 3 Hz;
// - a global brightness cap, lower again in Calm visuals;
// - no beat-synced pulsing: the beat frequency is never fed to the picture;
// - Esc fades to dark at once (over about a second, never a cut).

import { SCENES, FRAG, VERT } from './shader';
import { emit, emitTo, listen, currentWindow, isTauri } from '../platform/bridge';
import { loadSettings, saveSettings, type AppSettings } from '../settings/model';
import { h } from '../ui/controls';

interface Frame {
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

const gl2 = canvas.getContext('webgl2', { antialias: false, powerPreference: 'low-power' });
const gl = (gl2 ?? canvas.getContext('webgl', { antialias: false, powerPreference: 'low-power' })) as WebGLRenderingContext | null;
const U: Record<string, WebGLUniformLocation | null> = {};

function compile(type: number, src: string): WebGLShader {
  const s = gl!.createShader(type)!;
  gl!.shaderSource(s, src);
  gl!.compileShader(s);
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) console.error(gl!.getShaderInfoLog(s));
  return s;
}

if (gl) {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  for (const n of ['R', 'T', 'mixv', 'sa', 'sb', 'bass', 'hi', 'fade', 'bright', 'sat']) U[n] = gl.getUniformLocation(prog, n);
}

let quality = 0.7;
function resize(): void {
  const d = Math.min(devicePixelRatio || 1, 2) * quality;
  canvas.width = Math.max(2, Math.round(innerWidth * d));
  canvas.height = Math.max(2, Math.round(innerHeight * d));
  gl?.viewport(0, 0, canvas.width, canvas.height);
}
addEventListener('resize', resize);
resize();

let settings: AppSettings;
const state = {
  T: Math.random() * 200,
  flow: 1,
  glow: 0.85,
  scene: 0,
  next: 0,
  mixv: 0,
  mixing: false,
  drift: true,
  since: 0,
  dark: false,
};
// Smoothed values actually sent to the shader.
const live = { fade: 0, bright: 0, sat: 1.6, bass: 0, hi: 0, flow: 1 };
let frame: Frame = { rms: 0, low: 0, high: 0, phase: 'ready', mode: 'meditate', landing: true };
let lastFrameAt = 0;

/** Move `v` toward `target` with time constant `tau`, never faster than `maxRate` per second. */
function approach(v: number, target: number, dt: number, tau: number, maxRate: number): number {
  const step = (target - v) * Math.min(1, dt / tau);
  const cap = maxRate * dt;
  return v + Math.max(-cap, Math.min(cap, step));
}

const nameEl = h('span', { class: 'name', 'aria-live': 'polite' });
function setName(): void {
  nameEl.textContent = SCENES[state.mixing ? state.next : state.scene];
}
function goTo(k: number): void {
  const n = SCENES.length;
  k = ((k % n) + n) % n;
  if (state.mixing) {
    state.scene = state.next;
    state.mixv = 0;
  }
  if (k === state.scene) {
    state.mixing = false;
    setName();
    return;
  }
  state.next = k;
  state.mixing = true;
  state.mixv = 0;
  state.since = 0;
  setName();
}

let last = performance.now();
let acc = 0;
let frames = 0;
function draw(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const calm = settings?.calmVisuals ?? true;
  const cap = Math.min(settings?.brightnessCap ?? 0.8, calm ? 0.7 : 1);
  const react = (settings?.audioReactivity ?? 0.4) * (calm ? 0.5 : 1);
  const stale = performance.now() - lastFrameAt > 2000;
  const landing = stale ? false : frame.landing && frame.phase !== 'ready';

  // Targets: soft landing and Calm visuals dim, slow and desaturate.
  const fadeTarget = state.dark ? 0 : landing ? 0.28 : frame.phase === 'ready' && !stale ? 0.45 : 1;
  const flowTarget = state.flow * (landing ? 0.35 : 1) * (calm ? 0.6 : 1);
  const satTarget = landing ? 0.5 : calm ? 1.15 : 1.6;
  // Fades are slow, except Esc which goes dark in about a second.
  live.fade = approach(live.fade, fadeTarget, dt, state.dark ? 0.25 : 2, state.dark ? 1.2 : 0.35);
  live.bright = approach(live.bright, state.glow * cap, dt, 1, 0.3);
  live.sat = approach(live.sat, satTarget, dt, 2, 0.4);
  live.flow = approach(live.flow, flowTarget, dt, 2, 0.6);
  // Audio reactivity: heavily smoothed (τ ≈ 1.5 s), scaled by the user's amount.
  live.bass = approach(live.bass, frame.low * react, dt, 1.5, 0.25);
  live.hi = approach(live.hi, frame.high * react, dt, 1.5, 0.25);

  state.T += dt * live.flow;
  if (state.mixing) {
    state.mixv += dt / 9;
    if (state.mixv >= 1) {
      state.scene = state.next;
      state.mixv = 0;
      state.mixing = false;
    }
  }
  // Drift moves through the four main scenes; Ember stays put once chosen.
  if (state.drift && !state.mixing && state.scene !== 4 && (state.since += dt) > 80) goTo((state.scene + 1) % 4);

  // Adapt resolution to keep frame time comfortable.
  acc += dt;
  frames++;
  if (acc > 2) {
    const avg = acc / frames;
    if (avg > 0.026 && quality > 0.4) {
      quality -= 0.1;
      resize();
    } else if (avg < 0.012 && quality < 1) {
      quality += 0.05;
      resize();
    }
    acc = 0;
    frames = 0;
  }

  if (gl) {
    gl.uniform2f(U.R, canvas.width, canvas.height);
    gl.uniform1f(U.T, state.T);
    gl.uniform1f(U.mixv, state.mixv);
    gl.uniform1f(U.sa, state.scene);
    gl.uniform1f(U.sb, state.next);
    gl.uniform1f(U.bass, live.bass);
    gl.uniform1f(U.hi, live.hi);
    gl.uniform1f(U.fade, live.fade);
    gl.uniform1f(U.bright, live.bright);
    gl.uniform1f(U.sat, live.sat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(draw);
}

// ---------- controls ----------

let idleTimer: ReturnType<typeof setTimeout> | null = null;
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
  prev.addEventListener('click', () => goTo((state.mixing ? state.next : state.scene) - 1));
  next.addEventListener('click', () => goTo((state.mixing ? state.next : state.scene) + 1));
  const drift = h('button', { class: 'btn', 'aria-pressed': 'true' }, 'Drift');
  drift.addEventListener('click', () => {
    state.drift = !state.drift;
    state.since = 0;
    drift.setAttribute('aria-pressed', String(state.drift));
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
    await saveSettings(settings);
    void emit('settings-changed');
  });
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
    h('div', { class: 'grp' }, calm, fs, close),
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
  if (e.key === 'f' || e.key === 'F') void toggleFullscreen();
  else if (e.key === 'ArrowRight') goTo((state.mixing ? state.next : state.scene) + 1);
  else if (e.key === 'ArrowLeft') goTo((state.mixing ? state.next : state.scene) - 1);
  else if (e.key === 'e' || e.key === 'E') goTo(4);
  else if (e.key === ' ') void emitTo('main', 'remote-action', 'go');
});
['mousemove', 'pointerdown'].forEach((ev) => addEventListener(ev, poke, { passive: true }));
canvas.addEventListener('dblclick', () => void toggleFullscreen());

async function boot(): Promise<void> {
  settings = await loadSettings();
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
    await saveSettings(settings);
    void emit('settings-changed');
  }
  if (!gl) {
    document.body.append(h('p', { style: 'color:#aaa;padding:24px' }, 'This Mac could not start WebGL, so the visuals can’t run here. The sound is unaffected.'));
    return;
  }
  document.body.append(buildBar());
  poke();
  requestAnimationFrame(draw);
  void isTauri;
}

void boot();
