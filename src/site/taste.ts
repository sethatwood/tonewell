// "Hear a taste" on tonewell.space: thirty seconds of Deep Theta from the
// app's own engine, at a modest fixed level, faded in over 4 s and out over
// 6 s. Stopping early fades too: nothing on the page cuts off.

import { WebAudioEngine, type Levels } from '../audio/engine';
import { chordRatio } from '../visuals/chords';
import { BUILTIN_PRESETS, presetParams } from '../presets/builtin';
import workletUrl from '../audio/worklets/processors.js?url';

const SECONDS = 30;
const FADE_IN = 4;
const FADE_OUT = 6;
const STOP_FADE = 1.5;
const VOLUME = 0.55;

export interface Taste {
  stop(): void;
  /** The bed without the beat, for the visuals to follow (WebAudioEngine.bedLevels). */
  bedLevels(): Levels;
  /** The drone's root now, in hertz. */
  rootHz(): number;
  /** The drone's chord, for the Harmonograph. */
  readonly ratio: [number, number];
}

/** Plays on `ctx`, which the caller makes inside the click so the browser lets it sound. Closes it when done. */
export async function play(ctx: AudioContext, onEnd: () => void): Promise<Taste> {
  const preset = BUILTIN_PRESETS.find((p) => p.id === 'deep-theta');
  if (!preset) throw new Error('Deep Theta preset is missing');
  if (ctx.state !== 'running') await ctx.resume();
  const params = presetParams(preset);
  const engine = await WebAudioEngine.create(ctx, params, { workletUrl, volume: VOLUME });
  engine.fade(1, FADE_IN);
  engine.scheduleEnd(ctx.currentTime + SECONDS - FADE_OUT, FADE_OUT);

  let done = false;
  let timer = setTimeout(finish, (SECONDS + 0.5) * 1000);
  function finish(): void {
    if (done) return;
    done = true;
    clearTimeout(timer);
    engine.dispose();
    void ctx.close();
    onEnd();
  }

  return {
    ratio: chordRatio(params.voicing),
    bedLevels: () => (done ? { rms: 0, low: 0, high: 0 } : engine.bedLevels()),
    rootHz: () => engine.rootNow(),
    stop() {
      if (done) return;
      engine.fade(0, STOP_FADE);
      clearTimeout(timer);
      timer = setTimeout(finish, (STOP_FADE + 0.3) * 1000);
    },
  };
}
