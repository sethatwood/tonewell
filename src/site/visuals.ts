// The live visuals on tonewell.space: the app's own renderer and shader in a
// panel, under the same photosensitivity limits (renderer.ts). It starts only
// when asked, next to the note about light; it pauses when scrolled out of
// view; Stop or Esc fades it to dark in about a second. While the taste
// plays, the picture follows the sound as it does in the app (follow.ts),
// by as much as the "Follow the sound" slider says.

import { Visuals } from '../visuals/renderer';
import { SoundFollower, type Heard } from '../visuals/follow';
import { PALETTES, SCENES } from '../visuals/shader';
import type { Player } from './main';

// The app's defaults, with Calm visuals off unless the visitor turns it on or prefers reduced motion.
const GLOW = 0.85;
const CAP = 0.8;
/** Shorter than the app's 80 s, so a visit sees more than one scene. */
const DRIFT_SECONDS = 30;

type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Mounts the live view in `root`; returns a function that starts it on a scene, or null without WebGL. */
export function mountVisuals(root: HTMLElement, player: Player): ((scene: number) => void) | null {
  const canvas = root.querySelector('canvas');
  const vis = canvas ? Visuals.create(canvas) : null;
  if (!canvas || !vis) {
    root.dataset.state = 'no-webgl';
    return null;
  }
  vis.driftSeconds = DRIFT_SECONDS;

  const q = <T extends Element>(sel: string): T | null => root.querySelector<T>(sel);
  const nameEl = q<HTMLElement>('[data-vis-name]');
  const paletteBtn = q<HTMLButtonElement>('[data-vis-palette]');
  const soundBtn = q<HTMLButtonElement>('[data-vis-sound]');
  const fullBtn = q<HTMLButtonElement>('[data-vis-full]');
  const calmBtn = q<HTMLButtonElement>('[data-vis-calm]');
  const followInput = q<HTMLInputElement>('[data-vis-follow]');
  const thumbs = [...document.querySelectorAll<HTMLButtonElement>('[data-scene]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const doc = document as FullscreenDoc;

  let running = false;
  let stopping = false;
  let onScreen = true;
  let raf = 0;
  let last = 0;
  let heard: Heard | null = null;
  let sampledAt = 0;
  let calm = reduced.matches;
  // "Follow the sound", 0..1. The demo starts higher than the app's 40% so the effect shows; the slider says so.
  let follow = Number(followInput?.value ?? 70) / 100;
  const follower = new SoundFollower();

  const showScene = (): void => {
    const k = vis.target();
    if (nameEl) nameEl.textContent = SCENES[k];
    for (const t of thumbs) t.setAttribute('aria-pressed', String(running && Number(t.dataset.scene) === k));
  };
  vis.onScene = showScene;

  const frame = (now: number): void => {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const taste = player.current();
    // Sample the sound as the app does, twenty times a second.
    if (!taste) heard = null;
    else if (now - sampledAt > 50) {
      heard = { ...taste.bedLevels(), rootHz: taste.rootHz() };
      sampledAt = now;
    }
    const f = follower.update(dt, heard);
    const react = follow * (calm ? 0.5 : 1);
    vis.step(dt, {
      fade: stopping ? 0 : 1,
      dark: stopping,
      bright: GLOW * (calm ? Math.min(CAP, 0.7) : CAP),
      sat: calm ? 1.15 : 1.6,
      flow: (calm ? 0.6 : 1) * (1 + 0.5 * f.drive * react),
      swell: f.swell * react,
      bloom: f.bloom * react,
      hue: f.hue * react,
      pacer: false,
      ratio: taste?.ratio,
    });
    if (stopping && vis.level() < 0.01) {
      finish();
      return;
    }
    schedule();
  };
  const schedule = (): void => {
    if (running && onScreen && !raf) raf = requestAnimationFrame(frame);
  };

  const start = (scene: number): void => {
    if (!running) {
      // The picture is dark here (it fades up from 0), so placing the scene directly is never a cut.
      vis.scene = vis.next = scene;
      vis.mixing = false;
      vis.queued = null;
      vis.since = 0;
      running = true;
      stopping = false;
      root.dataset.state = 'running';
      vis.resize();
      last = performance.now();
      showScene();
      schedule();
      q<HTMLButtonElement>('[data-vis-stop]')?.focus({ preventScroll: true });
    } else {
      stopping = false;
      vis.goTo(scene);
    }
  };
  const stop = (): void => {
    if (!running) return;
    // Out of view, nobody sees the fade.
    if (onScreen) stopping = true;
    else finish();
  };
  const finish = (): void => {
    running = false;
    stopping = false;
    root.dataset.state = 'idle';
    if (doc.fullscreenElement === root || doc.webkitFullscreenElement === root) (doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc))?.();
    showScene();
    q<HTMLButtonElement>('[data-watch]')?.focus({ preventScroll: true });
  };

  q('[data-vis-prev]')?.addEventListener('click', () => vis.goTo(vis.target() - 1));
  q('[data-vis-next]')?.addEventListener('click', () => vis.goTo(vis.target() + 1));
  q('[data-vis-stop]')?.addEventListener('click', stop);
  paletteBtn?.addEventListener('click', () => {
    const next = vis.cyclePalette();
    if (next == null) return;
    paletteBtn.textContent = PALETTES[next].name;
    paletteBtn.setAttribute('aria-label', `Palette: ${PALETTES[next].name}`);
  });
  if (followInput) {
    const paint = (): void => {
      followInput.style.setProperty('--v', String(Number(followInput.value) / 100));
      followInput.setAttribute('aria-valuetext', Number(followInput.value) < 2 ? 'Not at all' : `${followInput.value}%`);
    };
    followInput.addEventListener('input', () => {
      follow = Number(followInput.value) / 100;
      paint();
    });
    paint();
  }
  if (calmBtn) {
    calmBtn.setAttribute('aria-pressed', String(calm));
    calmBtn.addEventListener('click', () => {
      calm = !calm;
      calmBtn.setAttribute('aria-pressed', String(calm));
    });
  }
  if (soundBtn) {
    soundBtn.addEventListener('click', () => player.toggle());
    const paint = (playing: boolean): void => soundBtn.setAttribute('aria-pressed', String(playing));
    player.onChange(paint);
    paint(player.playing);
  }
  if (fullBtn) {
    if (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) {
      fullBtn.addEventListener('click', () => {
        if (doc.fullscreenElement || doc.webkitFullscreenElement) (doc.exitFullscreen?.bind(doc) ?? doc.webkitExitFullscreen?.bind(doc))?.();
        else {
          const el = root as FullscreenEl;
          if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
          else el.webkitRequestFullscreen?.();
        }
      });
    } else {
      fullBtn.hidden = true;
    }
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && running && !stopping) stop();
  });
  new ResizeObserver(() => {
    if (running) vis.resize();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) {
      last = performance.now();
      schedule();
    }
  }).observe(root);

  return start;
}
