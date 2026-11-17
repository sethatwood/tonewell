// AudioWorklet processors for Tonewell. Plain JavaScript: this file is loaded
// as-is into the audio rendering thread.
//
// tw-textures: endlessly generated noise beds, rain, ocean swell, wind and a
//   very slow Shepard tone. Nothing here is a recording or a loop.
// tw-clock: posts the audio clock to the page a few times a second, a
//   steady heartbeat for the scheduler that doesn't depend on page timers.

/* global sampleRate, currentTime, registerProcessor, AudioWorkletProcessor */

function xorshift(seed) {
  let x = seed | 0 || 0x9e3779b9;
  return function () {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
}

class NoiseVoice {
  constructor(seed) {
    this.rand = xorshift(seed);
    this.p0 = 0; this.p1 = 0; this.p2 = 0;
    this.brown = 0;
    this.white = 0;
    this.pink = 0;
  }
  // Advances all three colours by one sample.
  step() {
    const w = this.rand();
    this.p0 = 0.99765 * this.p0 + w * 0.099046;
    this.p1 = 0.963 * this.p1 + w * 0.2965164;
    this.p2 = 0.57 * this.p2 + w * 1.0526913;
    this.pink = (this.p0 + this.p1 + this.p2 + w * 0.1848) * 0.105;
    this.brown = (this.brown + 0.02 * w) / 1.02;
    this.white = w;
  }
}

const MAX_DROPS = 24;

class RainVoice {
  constructor(seed) {
    this.rand = xorshift(seed);
    this.noise = new NoiseVoice(seed * 7 + 3);
    this.hp = 0; this.hpPrev = 0;
    this.drops = [];
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push({ on: false, y1: 0, y2: 0, a1: 0, a2: 0, life: 0 });
  }
  step(density) {
    this.noise.step();
    // Hiss: high-passed pink noise.
    const x = this.noise.pink;
    this.hp = 0.82 * (this.hp + x - this.hpPrev);
    this.hpPrev = x;
    let out = this.hp * (0.35 + density * 0.6) + this.noise.brown * 0.5 * density;
    // Drops: tiny resonant pings, many small and a few large.
    const rate = 12 + 240 * density * density;
    if ((this.rand() + 1) * 0.5 < rate / sampleRate) {
      const d = this.drops.find((v) => !v.on);
      if (d) {
        const f = 1100 * Math.pow(5, (this.rand() + 1) * 0.5);
        const tau = (0.002 + (this.rand() + 1) * 0.004) * sampleRate;
        const r = Math.exp(-1 / tau);
        d.a1 = 2 * r * Math.cos((2 * Math.PI * f) / sampleRate);
        d.a2 = -r * r;
        const u = (this.rand() + 1) * 0.5;
        d.y1 = 0;
        d.y2 = 0;
        d.y1 = (0.04 + 0.4 * u * u * u) * (this.rand() < 0 ? -1 : 1);
        d.life = Math.ceil(tau * 7);
        d.on = true;
      }
    }
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = this.drops[i];
      if (!d.on) continue;
      const y = d.a1 * d.y1 + d.a2 * d.y2;
      d.y2 = d.y1;
      d.y1 = y;
      out += y;
      if (--d.life <= 0) d.on = false;
    }
    return out;
  }
}

class Textures extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
    return [
      k('noise', 0, 0, 1),
      k('color', 0, 0, 2),
      k('rain', 0, 0, 1),
      k('rainDensity', 0.45, 0, 1),
      k('ocean', 0, 0, 1),
      k('wind', 0, 0, 1),
      k('shepard', 0, 0, 1),
      k('shepardBase', 27.5, 10, 200),
      k('shepardRate', 1 / 240, 0, 1),
    ];
  }

  constructor(options) {
    super();
    const seed = (options && options.processorOptions && options.processorOptions.seed) || 12345;
    this.noise = [new NoiseVoice(seed), new NoiseVoice(seed + 1)];
    this.color = 0;
    this.rain = [new RainVoice(seed + 11), new RainVoice(seed + 12)];
    this.oceanNoise = [new NoiseVoice(seed + 21), new NoiseVoice(seed + 22)];
    this.oceanLp = [0, 0];
    this.oceanPhase = [0.1, 0.37];
    this.oceanPeriod = [11, 13.7];
    this.oceanRand = xorshift(seed + 23);
    this.windNoise = [new NoiseVoice(seed + 31), new NoiseVoice(seed + 32)];
    this.windRand = xorshift(seed + 33);
    this.wind = [0, 1].map(() => ({ low: 0, band: 0, fc: 400, target: 400, gust: 0.5, gustTarget: 0.6, timer: 0 }));
    this.shepPhase = 0;
    this.shepTheta = new Float64Array(9);
  }

  process(_inputs, outputs, p) {
    const n = outputs[0][0].length;
    const sr = sampleRate;

    // Noise bed (output 0)
    if (p.noise[0] > 0) {
      const out = outputs[0];
      const target = p.color[0];
      for (let i = 0; i < n; i++) {
        this.color += (target - this.color) * 0.0004;
        const c = this.color;
        const wb = Math.max(0, 1 - c), wp = Math.max(0, 1 - Math.abs(c - 1)), ww = Math.max(0, c - 1);
        for (let ch = 0; ch < out.length; ch++) {
          const v = this.noise[ch & 1];
          v.step();
          out[ch][i] = (v.brown * 3.2 * wb + v.pink * 1.0 * wp + v.white * 0.32 * ww) * 0.6;
        }
      }
    }

    // Rain (output 1)
    if (p.rain[0] > 0) {
      const out = outputs[1];
      const dens = p.rainDensity[0];
      for (let i = 0; i < n; i++) {
        for (let ch = 0; ch < out.length; ch++) out[ch][i] = this.rain[ch & 1].step(dens) * 0.5;
      }
    }

    // Ocean swell (output 2)
    if (p.ocean[0] > 0) {
      const out = outputs[2];
      for (let ch = 0; ch < out.length; ch++) {
        const v = this.oceanNoise[ch & 1];
        let phase = this.oceanPhase[ch & 1];
        let lp = this.oceanLp[ch & 1];
        const data = out[ch];
        for (let i = 0; i < n; i++) {
          phase += 1 / (this.oceanPeriod[ch & 1] * sr);
          if (phase >= 1) {
            phase -= 1;
            this.oceanPeriod[ch & 1] = 8 + (this.oceanRand() + 1) * 3.5;
          }
          const env = 0.1 + 0.9 * Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * phase), 1.6);
          const fc = 220 + 2000 * env;
          const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
          v.step();
          lp += a * ((v.brown * 2.2 + v.pink * 0.6) - lp);
          data[i] = lp * env * 0.75;
        }
        this.oceanPhase[ch & 1] = phase;
        this.oceanLp[ch & 1] = lp;
      }
    }

    // Wind (output 3)
    if (p.wind[0] > 0) {
      const out = outputs[3];
      for (let ch = 0; ch < out.length; ch++) {
        const w = this.wind[ch & 1];
        const v = this.windNoise[ch & 1];
        const data = out[ch];
        w.timer -= n / sr;
        if (w.timer <= 0) {
          w.timer = 1.5 + (this.windRand() + 1) * 1.5;
          w.target = 260 * Math.pow(3.2, (this.windRand() + 1) * 0.5);
          w.gustTarget = 0.3 + (this.windRand() + 1) * 0.35;
        }
        const k = 1 - Math.exp(-n / (1.6 * sr));
        w.fc += (w.target - w.fc) * k;
        w.gust += (w.gustTarget - w.gust) * k;
        const f = 2 * Math.sin((Math.PI * w.fc) / sr);
        const q = 1 / 2.8;
        for (let i = 0; i < n; i++) {
          v.step();
          const x = v.pink;
          w.low += f * w.band;
          const high = x - w.low - q * w.band;
          w.band += f * high;
          data[i] = w.band * w.gust * 1.4;
        }
      }
    }

    // Shepard tone (output 4)
    if (p.shepard[0] > 0) {
      const out = outputs[4];
      const base = p.shepardBase[0];
      const rate = p.shepardRate[0];
      const th = this.shepTheta;
      // Pitch moves imperceptibly within one block, so compute it once per block.
      this.shepPhase += (rate * n) / sr;
      if (this.shepPhase >= 1) {
        this.shepPhase -= 1;
        for (let k = th.length - 1; k > 0; k--) th[k] = th[k - 1];
        th[0] = 0;
      }
      const inc = this.shepInc || (this.shepInc = new Float64Array(th.length));
      const amp = this.shepAmp || (this.shepAmp = new Float64Array(th.length));
      for (let k = 0; k < th.length; k++) {
        const x = k + this.shepPhase;
        inc[k] = (base * Math.pow(2, x)) / sr;
        const d = x - 4.5;
        amp[k] = Math.exp(-(d * d) / 5.1) * 0.16;
      }
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k < th.length; k++) {
          th[k] += inc[k];
          if (th[k] > 1) th[k] -= 1;
          s += Math.sin(2 * Math.PI * th[k]) * amp[k];
        }
        for (let ch = 0; ch < out.length; ch++) out[ch][i] = s;
      }
    }
    return true;
  }
}

class Clock extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = 0;
  }
  process() {
    if (++this.blocks >= 48) {
      this.blocks = 0;
      this.port.postMessage(currentTime);
    }
    return true;
  }
}

registerProcessor('tw-textures', Textures);
registerProcessor('tw-clock', Clock);
