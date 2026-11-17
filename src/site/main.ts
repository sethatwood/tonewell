// tonewell.space's only script: "Hear a taste" and the live visuals. Each
// loads its engine only when asked for, and nothing plays or lights up on
// its own.

import type { Taste } from './taste';

/** The taste of sound, shared by the hero button and the visuals panel. */
export interface Player {
  readonly playing: boolean;
  toggle(): void;
  /** The taste while it plays, for the visuals to follow. */
  current(): Taste | null;
  onChange(fn: (playing: boolean) => void): void;
}

function makePlayer(): Player {
  let taste: Taste | null = null;
  let loading = false;
  let cancelled = false;
  let playing = false;
  const listeners: Array<(playing: boolean) => void> = [];
  const set = (p: boolean): void => {
    playing = p;
    for (const fn of listeners) fn(p);
  };
  return {
    get playing() {
      return playing;
    },
    current: () => taste,
    onChange: (fn) => {
      listeners.push(fn);
    },
    toggle() {
      if (taste) {
        taste.stop();
        return;
      }
      if (loading) {
        cancelled = true;
        return;
      }
      loading = true;
      cancelled = false;
      // Made inside the click, so the browser lets it sound.
      const ctx = new AudioContext({ latencyHint: 'playback' });
      void ctx.resume();
      set(true);
      import('./taste')
        .then(({ play }) =>
          play(ctx, () => {
            taste = null;
            set(false);
          }),
        )
        .then((t) => {
          if (cancelled) t.stop();
          else taste = t;
        })
        .catch((err: unknown) => {
          console.warn('Tonewell: the taste could not play', err);
          void ctx.close();
          set(false);
        })
        .finally(() => {
          loading = false;
        });
    },
  };
}

const player = makePlayer();

const button = document.querySelector<HTMLButtonElement>('[data-taste]');
const label = button?.querySelector<HTMLElement>('[data-taste-label]');
const hero = document.querySelector<HTMLElement>('.hero .player');
if (button && label) {
  button.addEventListener('click', () => player.toggle());
  player.onChange((playing) => {
    button.dataset.playing = String(playing);
    label.textContent = playing ? 'Stop' : 'Hear a taste';
    if (hero) hero.dataset.tasting = String(playing);
  });
}

// The visuals start only from the Watch button or a scene, next to the note about light.
const screen = document.querySelector<HTMLElement>('[data-visuals]');
if (screen) {
  let mounted: Promise<((scene: number) => void) | null> | null = null;
  const start = (scene: number): void => {
    mounted ??= import('./visuals').then(({ mountVisuals }) => mountVisuals(screen, player));
    void mounted.then((go) => go?.(scene));
  };
  screen.querySelector('[data-watch]')?.addEventListener('click', () => start(Number(screen.dataset.posterScene ?? 0)));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scene]')) {
    b.addEventListener('click', () => start(Number(b.dataset.scene)));
  }
}
