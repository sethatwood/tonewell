// Audio checks, run headless in WebKit (the engine behind macOS's WKWebView)
// by scripts/audio-check.mjs. Each check renders the real engine offline and
// measures the result: levels, onsets, beat frequencies, ramps, fades.

import workletUrl from '../../src/audio/worklets/processors.js?url';
import { renderOffline } from '../../src/audio/render';
import { defaultParams, mergeParams, type SoundParams } from '../../src/audio/params';
import { BUILTIN_PRESETS, presetParams } from '../../src/presets/builtin';

interface Result {
  name: string;
  pass: boolean;
  detail: Record<string, number | string>;
}

const dB = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

function mix(buf: AudioBuffer): Float32Array {
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = (l[i] + r[i]) / 2;
  return out;
}

function slice(x: Float32Array, sr: number, t0: number, t1: number): Float32Array {
  return x.subarray(Math.floor(t0 * sr), Math.min(x.length, Math.floor(t1 * sr)));
}

function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

function peak(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

function nans(buf: AudioBuffer): number {
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) n++;
  }
  return n;
}

/** RMS envelope in dB, one value per window. */
function envelope(x: Float32Array, sr: number, win = 0.05): number[] {
  const n = Math.floor(win * sr);
  const out: number[] = [];
  for (let i = 0; i + n <= x.length; i += n) out.push(dB(rms(x.subarray(i, i + n))));
  return out;
}

function maxStep(env: number[], from = 0, floor = -60): { rise: number; fall: number } {
  let rise = 0;
  let fall = 0;
  for (let i = Math.max(1, from); i < env.length; i++) {
    if (env[i] < floor && env[i - 1] < floor) continue;
    const d = env[i] - env[i - 1];
    rise = Math.max(rise, d);
    fall = Math.min(fall, d);
  }
  return { rise, fall };
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Strongest frequency between fmin and fmax, zero-padded and interpolated. */
function peakFreq(x: Float32Array, sr: number, fmin: number, fmax: number): number {
  const n = 1 << 19;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < Math.min(x.length, n); i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1));
    re[i] = x[i] * w;
  }
  fft(re, im);
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  let best = Math.floor((fmin * n) / sr);
  for (let k = best; k <= Math.ceil((fmax * n) / sr); k++) if (mag(k) > mag(best)) best = k;
  const a = mag(best - 1);
  const b = mag(best);
  const c = mag(best + 1);
  const off = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return ((best + off) * sr) / n;
}

/** Share of power above `split` Hz, in dB: lower means darker. */
function brightness(x: Float32Array, sr: number, split = 600): number {
  const n = 1 << 14;
  let hi = 0;
  let all = 0;
  for (let start = 0; start + n <= x.length; start += n) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    fft(re, im);
    for (let k = 1; k < n / 2; k++) {
      const pw = re[k] * re[k] + im[k] * im[k];
      all += pw;
      if ((k * sr) / n >= split) hi += pw;
    }
  }
  return 10 * Math.log10(hi / (all || 1));
}

const SILENT: Partial<SoundParams> = {
  droneOn: 0, breathOn: 0, bellsOn: 0, beatOn: 0, noiseOn: 0, rainOn: 0, oceanOn: 0, windOn: 0,
  shimmerOn: 0, shepardOn: 0, reverbMix: 0, driftAmount: 0,
};

const solo = (p: Partial<SoundParams>) => mergeParams(mergeParams(defaultParams(), SILENT), p);

async function presetChecks(out: Result[]): Promise<void> {
  for (const preset of BUILTIN_PRESETS) {
    const sr = 48000;
    const buf = await renderOffline(presetParams(preset), { seconds: 24, sampleRate: sr, workletUrl, fadeIn: 2 });
    const m = mix(buf);
    const body = slice(m, sr, 6, 24);
    const level = dB(rms(body));
    const pk = peak(m);
    const onset = peak(slice(m, sr, 0, 0.02));
    const env = envelope(body, sr);
    const steps = maxStep(env);
    out.push({
      name: `preset: ${preset.name}`,
      pass: nans(buf) === 0 && pk < 0.9 && level > -34 && level < -12 && onset < 0.005 && steps.rise < 15,
      detail: { rmsDb: level.toFixed(1), peak: pk.toFixed(3), onsetPeak: onset.toFixed(4), maxRiseDb50ms: steps.rise.toFixed(1) },
    });
  }
}

async function binauralCheck(out: Result[]): Promise<void> {
  const sr = 48000;
  const buf = await renderOffline(solo({ beatOn: 1, beatMode: 0, beatHz: 6, carrier: 111, beatLevel: 1 }), {
    seconds: 10, sampleRate: sr, workletUrl, fadeIn: 0.5,
  });
  const l = slice(buf.getChannelData(0), sr, 2, 10);
  const r = slice(buf.getChannelData(1), sr, 2, 10);
  const fl = peakFreq(l, sr, 80, 160);
  const fr = peakFreq(r, sr, 80, 160);
  out.push({
    name: 'binaural: 6 Hz on a 111 Hz carrier',
    pass: Math.abs(fl - 108) < 0.2 && Math.abs(fr - 114) < 0.2,
    detail: { leftHz: fl.toFixed(2), rightHz: fr.toFixed(2), beatHz: (fr - fl).toFixed(2) },
  });
}

async function rampCheck(out: Result[]): Promise<void> {
  const sr = 48000;
  const buf = await renderOffline(solo({ beatOn: 1, beatMode: 0, beatHz: 6, carrier: 200, beatLevel: 1 }), {
    seconds: 26, sampleRate: sr, workletUrl, fadeIn: 0.5,
    script: (engine, t) => {
      if (t === 0) engine.setBeatPlan([[0, 10], [20, 6]], 0);
    },
  });
  const beatAt = (t0: number, t1: number) => {
    const l = peakFreq(slice(buf.getChannelData(0), sr, t0, t1), sr, 150, 250);
    const r = peakFreq(slice(buf.getChannelData(1), sr, t0, t1), sr, 150, 250);
    return r - l;
  };
  const early = beatAt(0.5, 2.5); // expect about 9.7 Hz at t = 1.5
  const late = beatAt(22, 26); // expect 6 Hz
  out.push({
    name: 'beat glide: 10 Hz to 6 Hz over 20 s',
    pass: Math.abs(early - 9.7) < 0.35 && Math.abs(late - 6) < 0.2,
    detail: { earlyHz: early.toFixed(2), lateHz: late.toFixed(2) },
  });
}

async function monauralCheck(out: Result[]): Promise<void> {
  const sr = 48000;
  const buf = await renderOffline(solo({ beatOn: 1, beatMode: 1, beatHz: 6, carrier: 111, beatLevel: 1 }), {
    seconds: 6, sampleRate: sr, workletUrl, fadeIn: 0.5,
  });
  const l = slice(buf.getChannelData(0), sr, 2, 6);
  const r = slice(buf.getChannelData(1), sr, 2, 6);
  let diff = 0;
  for (let i = 0; i < l.length; i++) diff = Math.max(diff, Math.abs(l[i] - r[i]));
  const env = envelope(l, sr, 0.01);
  const swing = Math.max(...env) - Math.min(...env);
  out.push({
    name: 'monaural: same in both ears, audibly beating',
    pass: diff < 1e-4 && swing > 12,
    detail: { maxLrDiff: diff.toExponential(2), envelopeSwingDb: swing.toFixed(1) },
  });
}

async function landingCheck(out: Result[]): Promise<void> {
  const sr = 48000;
  const deep = BUILTIN_PRESETS.find((p) => p.id === 'deep-theta')!;
  const buf = await renderOffline(presetParams(deep), {
    seconds: 36, sampleRate: sr, workletUrl, fadeIn: 2,
    script: (engine, t) => {
      if (t === 12) engine.setLanding(true, 6);
    },
  });
  const m = mix(buf);
  const before = dB(rms(slice(m, sr, 4, 12)));
  const after = dB(rms(slice(m, sr, 26, 36)));
  const env = envelope(slice(m, sr, 11, 24), sr);
  const steps = maxStep(env, 0, before - 30);
  const bBefore = brightness(slice(m, sr, 5, 12), sr);
  const bAfter = brightness(slice(m, sr, 28, 36), sr);
  out.push({
    name: 'soft landing: smooth, quieter, darker',
    pass: after < before - 3 && steps.fall > -6 && steps.rise < 6 && bAfter < bBefore - 6 && after > -50,
    detail: {
      beforeDb: before.toFixed(1), afterDb: after.toFixed(1), worstStep50ms: steps.fall.toFixed(2),
      above600HzBeforeDb: bBefore.toFixed(1), above600HzAfterDb: bAfter.toFixed(1),
    },
  });
}

async function volumeCheck(out: Result[]): Promise<void> {
  const sr = 48000;
  const buf = await renderOffline(solo({ noiseOn: 1, noiseColor: 1, noiseLevel: 0.6, noiseTone: 8000 }), {
    seconds: 12, sampleRate: sr, workletUrl, fadeIn: 0.5, volume: 0.2,
    script: (engine, t) => {
      if (t === 4) engine.setVolume(1);
    },
  });
  const env = envelope(slice(mix(buf), sr, 3, 12), sr, 0.5);
  const steps = maxStep(env, 0, -100);
  out.push({
    name: 'volume: a sudden jump to full rises at most 12 dB/s',
    pass: steps.rise < 7,
    detail: { worstRisePerHalfSecondDb: steps.rise.toFixed(2) },
  });
}

async function endCheck(out: Result[]): Promise<void> {
  const sr = 48000;
  const warm = BUILTIN_PRESETS.find((p) => p.id === 'warm-drone')!;
  const buf = await renderOffline(presetParams(warm), {
    seconds: 18, sampleRate: sr, workletUrl, fadeIn: 1,
    script: (engine, t) => {
      if (t === 0) engine.scheduleEnd(8, 5);
    },
  });
  const m = mix(buf);
  const start = dB(rms(slice(m, sr, 6, 8)));
  const during = maxStep(envelope(slice(m, sr, 7, 13), sr), 0, start - 40);
  const tail = dB(rms(slice(m, sr, 14, 18)));
  out.push({
    name: 'timer end: fades to silence without steps',
    pass: tail < -70 && during.fall > -6,
    detail: { tailDb: tail.toFixed(1), worstStep50msInTop40dB: during.fall.toFixed(2) },
  });
}

async function texturesCheck(out: Result[]): Promise<void> {
  const sr = 48000;
  const tex: Array<[string, Partial<SoundParams>]> = [
    ['brown noise', { noiseOn: 1, noiseColor: 0 }],
    ['pink noise', { noiseOn: 1, noiseColor: 1 }],
    ['white noise', { noiseOn: 1, noiseColor: 2, noiseTone: 12000 }],
    ['rain', { rainOn: 1 }],
    ['ocean', { oceanOn: 1 }],
    ['wind', { windOn: 1 }],
    ['endless rise', { shepardOn: 1, shepardLevel: 1 }],
    ['shimmer', { shimmerOn: 1, shimmerLevel: 1 }],
  ];
  for (const [name, p] of tex) {
    const buf = await renderOffline(solo(p), { seconds: 16, sampleRate: sr, workletUrl, fadeIn: 0.5 });
    const m = mix(buf);
    const level = dB(rms(slice(m, sr, 4, 16)));
    out.push({
      name: `texture: ${name}`,
      pass: nans(buf) === 0 && level > -40 && level < -16 && peak(m) < 0.9,
      detail: { rmsDb: level.toFixed(1), peak: peak(m).toFixed(3) },
    });
  }
}

async function longRunCheck(out: Result[]): Promise<void> {
  const sr = 22050;
  const deep = BUILTIN_PRESETS.find((p) => p.id === 'deep-theta')!;
  const minutes = 10;
  const buf = await renderOffline(presetParams(deep), { seconds: minutes * 60, sampleRate: sr, workletUrl, fadeIn: 10, step: 1 });
  const m = mix(buf);
  const perMinute: number[] = [];
  for (let i = 1; i < minutes; i++) perMinute.push(dB(rms(slice(m, sr, i * 60, (i + 1) * 60))));
  const spread = Math.max(...perMinute) - Math.min(...perMinute);
  out.push({
    name: `long run: ${minutes} minutes of Deep Theta stay steady`,
    pass: nans(buf) === 0 && spread < 6 && peak(m) < 0.9,
    detail: { minuteRmsSpreadDb: spread.toFixed(2), peak: peak(m).toFixed(3), minuteRms: perMinute.map((v) => v.toFixed(1)).join(' ') },
  });
}

async function run(): Promise<Result[]> {
  const out: Result[] = [];
  const status = document.getElementById('status')!;
  const steps = [presetChecks, binauralCheck, rampCheck, monauralCheck, landingCheck, volumeCheck, endCheck, texturesCheck, longRunCheck];
  for (const step of steps) {
    status.textContent = `Running ${step.name}…`;
    try {
      await step(out);
    } catch (err) {
      out.push({ name: step.name, pass: false, detail: { error: String(err instanceof Error ? err.stack ?? err.message : err) } });
    }
  }
  status.textContent = 'Done';
  return out;
}

(window as unknown as { tonewellChecks: () => Promise<Result[]> }).tonewellChecks = run;

