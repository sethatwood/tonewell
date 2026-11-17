// Small Web Audio helpers shared by the layers.

/** Seeded PRNG (mulberry32), so offline renders and tests are repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sets AudioParams smoothly and only when the value really changes, so
 * frequent re-application (drift, macros) never piles up automation events.
 */
export class Smoother {
  private last = new WeakMap<AudioParam, number>();

  set(p: AudioParam, v: number, now: number, tau: number): void {
    if (!Number.isFinite(v)) return;
    const prev = this.last.get(p);
    if (prev !== undefined && Math.abs(prev - v) <= 1e-4 * Math.max(1, Math.abs(v))) return;
    this.last.set(p, v);
    p.setTargetAtTime(v, now, Math.max(0.01, tau));
  }

  /** Forget the cached value, e.g. after cancelScheduledValues on this param. */
  reset(p: AudioParam): void {
    this.last.delete(p);
  }
}

/**
 * A layer's exit gain. When the layer fades to silence it disconnects
 * itself, so the browser stops processing everything upstream of it.
 * This keeps CPU low for long sessions with only one or two layers on.
 */
export class Gate {
  readonly node: GainNode;
  private connected = true;
  private sleepAt = Infinity;

  constructor(ctx: BaseAudioContext, private readonly dests: AudioNode[]) {
    this.node = ctx.createGain();
    this.node.gain.value = 0;
    for (const d of dests) this.node.connect(d);
  }

  set(level: number, now: number, tau: number, s: Smoother): void {
    if (level > 0 && !this.connected) {
      for (const d of this.dests) this.node.connect(d);
      this.connected = true;
    }
    s.set(this.node.gain, level, now, tau);
    this.sleepAt = level > 0 ? Infinity : now + Math.max(0.05, tau) * 9 + 0.5;
  }

  /** Call regularly with the audio clock; disconnects once the fade has finished. */
  tick(now: number): void {
    if (this.connected && now >= this.sleepAt) {
      this.node.disconnect();
      this.connected = false;
    }
  }

  get awake(): boolean {
    return this.connected;
  }
}

/** Equal-power stereo panner that degrades to a plain gain where StereoPanner is missing. */
export function panner(ctx: BaseAudioContext, pan: number): AudioNode & { pan?: AudioParam } {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }
  return ctx.createGain();
}

/** Generated exponential-decay noise impulse, as in the prototype. */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number, seed: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const r = rng(seed);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Gentle tanh soft clip curve for the final safety stage. */
export function softClipCurve(ceiling = 0.94): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const knee = 0.7 * ceiling;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    let y = ax;
    if (ax > knee) {
      const over = (ax - knee) / (ceiling - knee);
      y = knee + (ceiling - knee) * Math.tanh(over);
    }
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}
