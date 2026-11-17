// Offline rendering: builds the same engine on an OfflineAudioContext and
// renders it faster than real time. Used by the audio checks and handy for
// auditioning presets without speakers.

import { WebAudioEngine, type AudioEngine } from './engine';
import type { SoundParams } from './params';

export interface RenderOptions {
  seconds: number;
  sampleRate?: number;
  seed?: number;
  workletUrl?: string;
  fadeIn?: number;
  volume?: number;
  /** Called at each scheduler step with the engine and the render time, to script changes. */
  script?: (engine: AudioEngine, t: number) => void;
  step?: number;
}

export async function renderOffline(params: SoundParams, o: RenderOptions): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(o.seconds * sr), sr);
  const engine = await WebAudioEngine.create(ctx, params, { seed: o.seed ?? 7, workletUrl: o.workletUrl, volume: o.volume ?? 0.7 });
  engine.fade(1, o.fadeIn ?? 0.5);
  const step = o.step ?? 0.5;
  let t = 0;
  const tick = () => {
    o.script?.(engine, t);
    engine.pump();
  };
  tick();
  if (typeof ctx.suspend === 'function') {
    for (let s = step; s < o.seconds; s += step) {
      const at = Math.round(s * sr / 128) * 128 / sr;
      ctx.suspend(at).then(() => {
        t = at;
        tick();
        void ctx.resume();
      }).catch(() => {
        // Suspend points past the end are rejected; nothing to do.
      });
    }
  }
  const buf = await ctx.startRendering();
  engine.dispose();
  return buf;
}
