// Rough DSP cost per layer: renders 60 s offline per configuration and
// reports the time taken as a percentage of real time.
import workletUrl from '../../src/audio/worklets/processors.js?url';
import { renderOffline } from '../../src/audio/render';
import { defaultParams, mergeParams, type SoundParams } from '../../src/audio/params';
import { BUILTIN_PRESETS, presetParams } from '../../src/presets/builtin';

const SILENT: Partial<SoundParams> = {
  droneOn: 0, breathOn: 0, bellsOn: 0, beatOn: 0, noiseOn: 0, rainOn: 0, oceanOn: 0, windOn: 0,
  shimmerOn: 0, shepardOn: 0, reverbMix: 0, driftAmount: 0,
};
const solo = (p: Partial<SoundParams>) => mergeParams(mergeParams(defaultParams(), SILENT), p);
const preset = (id: string) => presetParams(BUILTIN_PRESETS.find((p) => p.id === id)!);

async function run(): Promise<Record<string, string>> {
  const configs: Array<[string, SoundParams]> = [
    ['nothing on (output chain only)', solo({})],
    ['brown noise', solo({ noiseOn: 1 })],
    ['reverb only (cathedral, fed by breath)', solo({ breathOn: 1, reverbMix: 0.7 })],
    ['breath only', solo({ breathOn: 1 })],
    ['drone only', solo({ droneOn: 1 })],
    ['beat only', solo({ beatOn: 1 })],
    ['rain', solo({ rainOn: 1 })],
    ['preset Brown Noise Desk', preset('brown-noise-desk')],
    ['preset Deep Theta', preset('deep-theta')],
  ];
  const out: Record<string, string> = {};
  for (const [name, p] of configs) {
    const t0 = performance.now();
    await renderOffline(p, { seconds: 60, sampleRate: 44100, workletUrl, fadeIn: 1, step: 1 });
    const ms = performance.now() - t0;
    out[name] = `${((ms / 60000) * 100).toFixed(2)}% of real time`;
  }
  return out;
}
(window as unknown as { tonewellPerf: () => Promise<Record<string, string>> }).tonewellPerf = run;

async function micro(): Promise<Record<string, string>> {
  const sr = 44100;
  const secs = 60;
  const time = async (name: string, build: (ctx: OfflineAudioContext, src: AudioNode) => AudioNode) => {
    const ctx = new OfflineAudioContext(2, sr * secs, sr);
    const osc = ctx.createOscillator();
    osc.start();
    const end = build(ctx, osc);
    end.connect(ctx.destination);
    const t0 = performance.now();
    await ctx.startRendering();
    return [name, `${(((performance.now() - t0) / (secs * 1000)) * 100).toFixed(2)}%`] as const;
  };
  const rows = await Promise.all([]);
  void rows;
  const out: Record<string, string> = {};
  for (const [name, b] of [
    ['oscillator only', (_c: OfflineAudioContext, s: AudioNode) => s],
    ['+ 1 compressor', (c: OfflineAudioContext, s: AudioNode) => s.connect(c.createDynamicsCompressor())],
    ['+ 2 compressors', (c: OfflineAudioContext, s: AudioNode) => s.connect(c.createDynamicsCompressor()).connect(c.createDynamicsCompressor())],
    ['+ waveshaper', (c: OfflineAudioContext, s: AudioNode) => { const w = c.createWaveShaper(); w.curve = new Float32Array(2048).map((_, i) => i / 1024 - 1); return s.connect(w); }],
    ['+ analyser', (c: OfflineAudioContext, s: AudioNode) => s.connect(c.createAnalyser())],
    ['+ biquad', (c: OfflineAudioContext, s: AudioNode) => s.connect(c.createBiquadFilter())],
  ] as Array<[string, (c: OfflineAudioContext, s: AudioNode) => AudioNode]>) {
    const [k, v] = await time(name, b);
    out[k] = v;
  }
  return out;
}
(window as unknown as { tonewellMicro: () => Promise<Record<string, string>> }).tonewellMicro = micro;

async function variants(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const p = solo({});
  for (const [name, opts] of [
    ['engine, worklet, 1 s ticks', { workletUrl, step: 1 }],
    ['engine, worklet, no ticks', { workletUrl, step: 120 }],
    ['engine, no worklet, 1 s ticks', { step: 1 }],
    ['engine, no worklet, no ticks', { step: 120 }],
  ] as Array<[string, { workletUrl?: string; step: number }]>) {
    const t0 = performance.now();
    await renderOffline(p, { seconds: 60, sampleRate: 44100, fadeIn: 1, ...opts });
    out[name] = `${(((performance.now() - t0) / 60000) * 100).toFixed(2)}%`;
  }
  return out;
}
(window as unknown as { tonewellVariants: () => Promise<Record<string, string>> }).tonewellVariants = variants;
