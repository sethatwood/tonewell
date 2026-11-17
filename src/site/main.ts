// tonewell.space's only script: the "Hear a taste" button. The sound engine
// loads only when the button is pressed, and nothing ever plays on its own.

import type { Taste } from './taste';

const button = document.querySelector<HTMLButtonElement>('[data-taste]');
const label = button?.querySelector<HTMLElement>('[data-taste-label]');
const hero = document.querySelector<HTMLElement>('.hero .player');

if (button && label) {
  let taste: Taste | null = null;
  let loading = false;
  let cancelled = false;

  const show = (playing: boolean): void => {
    button.dataset.playing = String(playing);
    label.textContent = playing ? 'Stop' : 'Hear a taste';
    if (hero) hero.dataset.tasting = String(playing);
  };

  button.addEventListener('click', async () => {
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
    show(true);
    try {
      const { play } = await import('./taste');
      const t = await play(ctx, () => {
        taste = null;
        show(false);
      });
      if (cancelled) t.stop();
      else taste = t;
    } catch (err) {
      console.warn('Tonewell: the taste could not play', err);
      void ctx.close();
      show(false);
    } finally {
      loading = false;
    }
  });
}
