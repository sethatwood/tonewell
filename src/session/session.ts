// The session: one object that owns the sound and everything about the
// current sit or work block. The mini player, the menu bar, keyboard and
// media keys all drive it through the same few verbs:
//
//   go()        Ready → Start; Playing → Wind down; Resting → Resume
//   windDown()  ~6 s to a low warm hum (or to silence), then rest
//   resume()    back up from resting
//   end()       fade out and stop
//
// Stopping is one ladder (Playing → Wind down → End) so there is never an
// abrupt cut, and no second "pause" verb to choose between.

import workletUrl from '../audio/worklets/processors.js?url';
import { WebAudioEngine, type Plan } from '../audio/engine';
import { PARAMS, clampParam, defaultParams, mergeParams, type ParamId, type SoundParams } from '../audio/params';
import { BUILTIN_PRESETS, presetParams, type Mode, type Preset } from '../presets/builtin';
import { loadDoc, patchDoc } from '../platform/store';
import { invoke } from '../platform/bridge';

export type { Mode } from '../presets/builtin';
export type Phase = 'ready' | 'playing' | 'winding' | 'resting' | 'ending';

export interface SessionPrefs {
  /** Session length in minutes; null for open-ended. */
  minutes: number | null;
  fadeIn: number;
  landTo: 'hum' | 'silence';
  /** Minutes to rest in the hum after the timer before ending (TM-style coming out). */
  restMinutes: number;
  endBell: boolean;
  startBell: boolean;
  keepPlaying: boolean;
  keepScreenAwake: boolean;
  /** Focus cycles: minutes of break between blocks, 0 for none. */
  breakMinutes: number;
}

export const PREFS_DEFAULT: Record<Mode, SessionPrefs> = {
  meditate: {
    minutes: 20, fadeIn: 10, landTo: 'hum', restMinutes: 2, endBell: true, startBell: false,
    keepPlaying: false, keepScreenAwake: true, breakMinutes: 0,
  },
  focus: {
    minutes: null, fadeIn: 6, landTo: 'silence', restMinutes: 0, endBell: true, startBell: false,
    keepPlaying: false, keepScreenAwake: false, breakMinutes: 0,
  },
};

export interface Notice {
  text: string;
  actions?: Array<{ id: string; label: string }>;
  /** Seconds before it clears itself; absent for notices that wait for the user. */
  ttl?: number;
}

export interface Snapshot {
  phase: Phase;
  mode: Mode;
  preset: Preset;
  edited: boolean;
  params: SoundParams;
  prefs: SessionPrefs;
  volume: number;
  /** Seconds left on the timer, or null when open-ended or not running. */
  remaining: number | null;
  /** Wall-clock time the timer ends, or null. */
  endsAt: Date | null;
  /** Wall-clock time the session started, or null. */
  startedAt: Date | null;
  /** True while resting because the timer ran out (as opposed to winding down by hand). */
  timerDone: boolean;
  inBreak: boolean;
  notice: Notice | null;
  output: { name: string; kind: string } | null;
  /** Seconds into the drone's filter sweep, so the glow can breathe in time with it. */
  sweepPhase: number;
}

interface ModeState {
  presetId: string;
  params: SoundParams;
  prefs: SessionPrefs;
}

const WIND_SECONDS = 6;
const RESUME_SECONDS = 4;
const END_SECONDS = 6;
const TIMER_END_SECONDS = 20;
const CROSSFADE_TAU = 8 / 3;

export class Session extends EventTarget {
  private ctx: AudioContext | null = null;
  private engine: WebAudioEngine | null = null;
  phase: Phase = 'ready';
  mode: Mode = 'meditate';
  private modes: Record<Mode, ModeState>;
  userPresets: Preset[] = [];
  volume = 0.6;
  notice: Notice | null = null;
  output: { name: string; kind: string } | null = null;

  private startAt = 0;
  private startedWall: Date | null = null;
  private endAt: number | null = null;
  private restEndsAt: number | null = null;
  private timerDone = false;
  private inBreak = false;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEsc = 0;
  private lastWall = Date.now();
  private deviceLost: { name: string; at: number } | null = null;
  private wasPlayingBeforeDeviceLoss = false;

  constructor() {
    super();
    this.modes = {
      meditate: { presetId: 'deep-theta', params: presetParams(BUILTIN_PRESETS[0]), prefs: { ...PREFS_DEFAULT.meditate } },
      focus: {
        presetId: 'brown-noise-desk',
        params: presetParams(BUILTIN_PRESETS.find((p) => p.id === 'brown-noise-desk')!),
        prefs: { ...PREFS_DEFAULT.focus },
      },
    };
    setInterval(() => this.tick(), 500);
  }

  // ---------- persistence ----------

  async restore(): Promise<void> {
    const doc = await loadDoc();
    if (typeof doc.volume === 'number') this.volume = Math.min(1, Math.max(0, doc.volume));
    if (doc.mode === 'meditate' || doc.mode === 'focus') this.mode = doc.mode;
    if (Array.isArray(doc.userPresets)) this.userPresets = (doc.userPresets as Preset[]).filter((p) => p && p.id && p.name);
    const saved = doc.modes as Partial<Record<Mode, Partial<ModeState>>> | undefined;
    for (const m of ['meditate', 'focus'] as Mode[]) {
      const s = saved?.[m];
      if (!s) continue;
      const preset = this.findPreset(s.presetId ?? '') ?? this.presetsFor(m)[0];
      this.modes[m] = {
        presetId: preset.id,
        params: mergeParams(presetParams(preset), s.params),
        prefs: { ...PREFS_DEFAULT[m], ...(s.prefs ?? {}) },
      };
    }
    this.emit();
  }

  private persist(): void {
    void patchDoc({ volume: this.volume, mode: this.mode, modes: this.modes, userPresets: this.userPresets });
  }

  // ---------- presets ----------

  presetsFor(mode: Mode): Preset[] {
    return [...BUILTIN_PRESETS.filter((p) => p.mode === mode), ...this.userPresets.filter((p) => p.mode === mode)];
  }

  findPreset(id: string): Preset | undefined {
    return BUILTIN_PRESETS.find((p) => p.id === id) ?? this.userPresets.find((p) => p.id === id);
  }

  get current(): ModeState {
    return this.modes[this.mode];
  }

  get preset(): Preset {
    return this.findPreset(this.current.presetId) ?? this.presetsFor(this.mode)[0];
  }

  get params(): SoundParams {
    return this.current.params;
  }

  get prefs(): SessionPrefs {
    return this.current.prefs;
  }

  isEdited(): boolean {
    const base = presetParams(this.preset);
    const p = this.params;
    return (Object.keys(PARAMS) as ParamId[]).some((id) => Math.abs(base[id] - p[id]) > 1e-6);
  }

  setPreset(id: string): void {
    const preset = this.findPreset(id);
    if (!preset) return;
    if (preset.mode !== this.mode) this.setMode(preset.mode);
    this.current.presetId = preset.id;
    this.current.params = presetParams(preset);
    this.engine?.setParams(this.engineParams(), CROSSFADE_TAU);
    this.afterParamChange();
  }

  stepPreset(dir: 1 | -1): void {
    const list = this.presetsFor(this.mode);
    const i = list.findIndex((p) => p.id === this.preset.id);
    this.setPreset(list[(i + dir + list.length) % list.length].id);
  }

  /** Save the current sound as a new preset in this mode. */
  saveAsPreset(name: string): Preset {
    const base = presetParams({ id: '', name: '', mode: this.mode, blurb: '', params: {} });
    const diff: Partial<SoundParams> = {};
    for (const id of Object.keys(PARAMS) as ParamId[]) if (Math.abs(base[id] - this.params[id]) > 1e-6) diff[id] = this.params[id];
    const preset: Preset = {
      id: `user-${Date.now().toString(36)}`,
      name: name.trim() || 'My sound',
      mode: this.mode,
      blurb: `Your sound, made from ${this.preset.name}.`,
      params: diff,
    };
    this.userPresets.push(preset);
    this.current.presetId = preset.id;
    this.afterParamChange();
    return preset;
  }

  /** Overwrite the current user preset with the current sound. */
  savePreset(): void {
    const preset = this.userPresets.find((p) => p.id === this.preset.id);
    if (!preset) return;
    const base = presetParams({ ...preset, params: {} });
    const diff: Partial<SoundParams> = {};
    for (const id of Object.keys(PARAMS) as ParamId[]) if (Math.abs(base[id] - this.params[id]) > 1e-6) diff[id] = this.params[id];
    preset.params = diff;
    this.afterParamChange();
  }

  renamePreset(id: string, name: string): void {
    const preset = this.userPresets.find((p) => p.id === id);
    if (!preset || !name.trim()) return;
    preset.name = name.trim();
    this.afterParamChange();
  }

  duplicatePreset(id: string): void {
    const src = this.findPreset(id);
    if (!src) return;
    const copy: Preset = { ...src, id: `user-${Date.now().toString(36)}`, name: `${src.name} copy`, params: { ...src.params }, builtin: false };
    this.userPresets.push(copy);
    this.setPreset(copy.id);
  }

  deletePreset(id: string): void {
    const i = this.userPresets.findIndex((p) => p.id === id);
    if (i < 0) return;
    const wasCurrent = this.preset.id === id;
    this.userPresets.splice(i, 1);
    if (wasCurrent) this.setPreset(this.presetsFor(this.mode)[0].id);
    else this.afterParamChange();
  }

  revert(): void {
    this.setPreset(this.preset.id);
  }

  // ---------- parameters ----------

  setParam(id: ParamId, value: number): void {
    const v = clampParam(id, value);
    if (this.current.params[id] === v) return;
    this.current.params = { ...this.current.params, [id]: v };
    const tau = PARAMS[id].group === 'macro' ? 0.7 : 0.15;
    this.engine?.setParams(this.engineParams(), tau);
    if (id.startsWith('ramp') || id === 'beatHz' || id === 'beatOn' || id === 'returnMin') this.applyBeatPlan(2);
    this.afterParamChange();
  }

  /** What the engine plays: binaural becomes monaural on speakers, where binaural can't work. */
  private engineParams(): SoundParams {
    const p = this.params;
    if (this.output?.kind === 'speakers' && p.beatMode === 0) return { ...p, beatMode: 1 };
    return p;
  }

  private afterParamChange(): void {
    this.persist();
    this.emit();
  }

  setPrefs(patch: Partial<SessionPrefs>): void {
    Object.assign(this.current.prefs, patch);
    if ('minutes' in patch && this.isRunning()) this.retime();
    if ('keepScreenAwake' in patch) this.updateKeepAwake();
    this.afterParamChange();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.engine?.setVolume(this.volume);
    this.persist();
    this.emit();
  }

  nudgeVolume(delta: number): void {
    this.setVolume(Math.round((this.volume + delta) * 100) / 100);
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    // Sound crossfades over about 8 s; a running timer is never touched.
    this.engine?.setParams(this.engineParams(), CROSSFADE_TAU);
    if (this.isRunning()) this.applyBeatPlan(4);
    this.updateKeepAwake();
    this.persist();
    this.emit();
  }

  // ---------- the ladder ----------

  isRunning(): boolean {
    return this.phase === 'playing' || this.phase === 'winding' || this.phase === 'resting';
  }

  async go(): Promise<void> {
    switch (this.phase) {
      case 'ready':
        return this.start();
      case 'playing':
        return this.windDown();
      case 'winding':
      case 'resting':
        return this.resume();
      case 'ending':
        return this.resume();
    }
  }

  /** Esc, the headphone button and the menu-bar stop item all walk the same ladder. */
  escape(repeat = false): void {
    const now = performance.now();
    if (repeat || now - this.lastEsc < 1000) return;
    this.lastEsc = now;
    if (this.phase === 'playing') void this.windDown();
    else if (this.phase === 'winding' || this.phase === 'resting') this.end();
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      this.ctx.addEventListener('statechange', () => this.onContextState());
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.ctx;
  }

  async start(): Promise<void> {
    if (this.phase !== 'ready') return;
    this.clearPhaseTimer();
    const ctx = await this.ensureContext();
    this.engine?.dispose();
    this.engine = await WebAudioEngine.create(ctx, this.engineParams(), { workletUrl, volume: this.volume });
    const prefs = this.prefs;
    this.startAt = ctx.currentTime;
    this.startedWall = new Date();
    this.timerDone = false;
    this.inBreak = false;
    this.restEndsAt = null;
    this.endAt = prefs.minutes ? this.startAt + prefs.minutes * 60 : null;
    this.engine.fade(1, prefs.fadeIn);
    if (prefs.startBell) this.engine.chime(this.startAt + 1.5, 0.8);
    this.applyBeatPlan(0);
    this.armSafetyNet();
    this.phase = 'playing';
    this.setNotice(null);
    this.updateKeepAwake();
    this.emit();
  }

  async windDown(auto = false): Promise<void> {
    if (this.phase !== 'playing' || !this.engine) return;
    this.phase = 'winding';
    if (this.prefs.landTo === 'silence' && !this.inBreak) this.engine.fade(0, WIND_SECONDS);
    else this.engine.setLanding(true, WIND_SECONDS);
    if (!auto) this.restEndsAt = null;
    this.emit();
    this.phaseTimer = setTimeout(() => {
      if (this.phase !== 'winding') return;
      this.phase = 'resting';
      if (this.prefs.landTo === 'silence' && !this.inBreak) void this.ctx?.suspend();
      this.emit();
    }, WIND_SECONDS * 1000);
  }

  async resume(): Promise<void> {
    if (!this.engine || !(this.phase === 'winding' || this.phase === 'resting' || this.phase === 'ending')) return;
    this.clearPhaseTimer();
    await this.ensureContext();
    this.engine.setLanding(false, RESUME_SECONDS);
    this.engine.fade(1, RESUME_SECONDS);
    this.restEndsAt = null;
    if (this.timerDone) {
      // Resuming after the timer: carry on, open-ended.
      this.timerDone = false;
      this.endAt = null;
      this.engine.clearEnd();
    }
    this.phase = 'playing';
    this.setNotice(null);
    this.updateKeepAwake();
    this.emit();
  }

  end(seconds = END_SECONDS): void {
    if (!this.engine || this.phase === 'ready') return;
    this.clearPhaseTimer();
    if (this.phase === 'ending') return;
    this.phase = 'ending';
    if (this.ctx?.state === 'suspended') {
      this.finish();
      return;
    }
    this.engine.fade(0, seconds);
    this.emit();
    this.phaseTimer = setTimeout(() => this.finish(), (seconds + 0.4) * 1000);
  }

  /** Fade out quickly and stop, for quitting the app. */
  async quit(): Promise<void> {
    if (this.engine && this.isRunning() && this.ctx?.state === 'running') {
      this.engine.fade(0, 1.5);
      await new Promise((r) => setTimeout(r, 1700));
    }
    this.finish();
  }

  private finish(): void {
    this.clearPhaseTimer();
    this.engine?.dispose();
    this.engine = null;
    void this.ctx?.suspend();
    this.phase = 'ready';
    this.endAt = null;
    this.restEndsAt = null;
    this.startedWall = null;
    this.inBreak = false;
    this.updateKeepAwake();
    this.emit();
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
  }

  // ---------- timer ----------

  /** Wind the timer by `delta` minutes (5-minute steps from the well, + and − keys). */
  wind(delta: number): void {
    const now = this.ctx?.currentTime ?? 0;
    if (this.isRunning() && this.endAt !== null) {
      const left = Math.max(0, this.endAt - now) / 60;
      const next = Math.max(5, Math.round((left + delta) / 5) * 5);
      this.endAt = now + next * 60;
      this.armSafetyNet();
      this.applyBeatPlan(2);
      this.emit();
      return;
    }
    const cur = this.prefs.minutes ?? 0;
    const next = Math.min(180, Math.max(0, cur + delta));
    this.setPrefs({ minutes: next === 0 ? null : next });
  }

  /** Set the length outright (menus). While running, counts from the session start. */
  setLength(minutes: number | null): void {
    this.setPrefs({ minutes });
  }

  private retime(): void {
    const minutes = this.prefs.minutes;
    const now = this.ctx?.currentTime ?? 0;
    if (minutes === null) {
      this.endAt = null;
    } else {
      this.endAt = Math.max(now + 60, this.startAt + minutes * 60);
    }
    this.timerDone = false;
    this.armSafetyNet();
    this.applyBeatPlan(2);
  }

  /**
   * If the page were ever frozen, the audio timeline still ends the session:
   * a fade is scheduled on the audio clock for after the timer, the rest and
   * the wind-down. The normal path ends the session well before it fires.
   */
  private armSafetyNet(): void {
    if (!this.engine) return;
    const p = this.prefs;
    if (this.endAt === null || p.keepPlaying || p.breakMinutes > 0) {
      this.engine.clearEnd();
      return;
    }
    this.engine.scheduleEnd(this.endAt + p.restMinutes * 60 + WIND_SECONDS + 30, TIMER_END_SECONDS);
  }

  private applyBeatPlan(blend: number): void {
    if (!this.engine) return;
    const p = this.params;
    if (!p.beatOn || !p.rampOn) {
      this.engine.setBeatPlan(null);
      return;
    }
    const t0 = this.startAt;
    const ramp = p.rampMin * 60;
    const plan: Plan = [[t0, p.rampFrom], [t0 + ramp, p.beatHz]];
    if (this.endAt !== null && p.rampReturn && !this.prefs.keepPlaying) {
      const back = p.returnMin * 60;
      const riseStart = Math.max(t0 + ramp, this.endAt - back);
      if (riseStart < this.endAt) plan.push([riseStart, p.beatHz], [this.endAt, p.rampFrom]);
    }
    this.engine.setBeatPlan(plan, blend);
  }

  private onTimerEnd(): void {
    if (!this.engine) return;
    const p = this.prefs;
    const now = this.ctx?.currentTime ?? 0;
    if (p.endBell) this.engine.chime(now + 0.05);
    if (p.breakMinutes > 0) {
      // Focus cycles: a break, then the next block.
      this.inBreak = true;
      this.endAt = null;
      this.restEndsAt = now + p.breakMinutes * 60;
      void this.windDown(true);
      return;
    }
    if (p.keepPlaying) {
      this.endAt = null;
      this.emit();
      return;
    }
    this.timerDone = true;
    this.endAt = null;
    if (p.restMinutes > 0) {
      this.restEndsAt = now + p.restMinutes * 60;
      void this.windDown(true);
    } else {
      this.end(TIMER_END_SECONDS);
    }
  }

  private onRestEnd(): void {
    this.restEndsAt = null;
    if (this.inBreak && this.engine) {
      const now = this.ctx?.currentTime ?? 0;
      if (this.prefs.endBell) this.engine.chime(now + 0.05, 0.8);
      this.inBreak = false;
      this.endAt = this.prefs.minutes ? now + this.prefs.minutes * 60 : null;
      void this.resume();
      return;
    }
    this.end(TIMER_END_SECONDS);
  }

  private tick(): void {
    const wall = Date.now();
    const gap = wall - this.lastWall;
    this.lastWall = wall;
    // A long gap means the Mac slept. Never resume on our own after that.
    if (gap > 15000 && this.isRunning()) {
      this.finish();
      this.setNotice({ text: 'Stopped while your Mac slept.', actions: [{ id: 'start', label: 'Start again' }] });
      return;
    }
    if (!this.ctx || !this.isRunning()) return;
    const now = this.ctx.currentTime;
    if (this.phase === 'playing' && this.endAt !== null && now >= this.endAt) this.onTimerEnd();
    if (this.restEndsAt !== null && now >= this.restEndsAt && this.ctx.state === 'running') this.onRestEnd();
    else if (this.restEndsAt !== null && this.ctx.state !== 'running') {
      // Resting in silence (context suspended): fall back to the wall clock.
      this.restEndsAt -= gap / 1000;
      if (this.restEndsAt <= now) this.onRestEnd();
    }
  }

  // ---------- outputs, interruptions ----------

  private onContextState(): void {
    const state = this.ctx?.state as string | undefined;
    if (state === 'interrupted' && this.phase === 'playing') {
      this.setNotice({ text: 'Sound was interrupted by the system.', actions: [{ id: 'resume', label: 'Resume' }] });
      void this.windDown();
    }
  }

  /** Called when the system's audio output changes. */
  onOutputChange(change: { change: string; previous: { name: string; kind: string } | null; current: { name: string; kind: string } | null }): void {
    this.output = change.current;
    this.engine?.setParams(this.engineParams(), 1);
    if (change.change === 'removed' && this.phase === 'playing' && this.engine) {
      // The only true pause: mute at once so nothing comes out of the speakers.
      this.engine.fade(0, 0.04);
      this.wasPlayingBeforeDeviceLoss = true;
      this.deviceLost = { name: change.previous?.name ?? 'Headphones', at: Date.now() };
      this.phase = 'resting';
      setTimeout(() => void this.ctx?.suspend(), 120);
      this.setNotice({
        text: `${change.previous?.kind === 'headphones' ? 'Headphones out' : `${change.previous?.name ?? 'Output'} gone`}, paused.`,
        actions: [
          { id: 'resume', label: 'Resume' },
          { id: 'end', label: 'End' },
        ],
      });
      this.emit();
      return;
    }
    if (this.deviceLost && change.current && change.current.name === this.deviceLost.name && Date.now() - this.deviceLost.at < 60000 && this.wasPlayingBeforeDeviceLoss) {
      // The same headphones came back within a minute: fade back in gently.
      this.deviceLost = null;
      this.wasPlayingBeforeDeviceLoss = false;
      void this.ensureContext().then(() => {
        this.engine?.setLanding(false, 1);
        this.engine?.fade(1, 8);
        this.phase = 'playing';
        this.setNotice({ text: `Back on ${change.current?.name}.`, ttl: 4 });
        this.emit();
      });
      return;
    }
    if (change.change === 'switched' && change.current && this.phase === 'playing' && this.engine) {
      // Dip and come back up over 3 s on the new output.
      this.engine.fade(0, 0.15);
      setTimeout(() => this.engine?.fade(1, 3), 400);
      this.setNotice({ text: `Now through ${change.current.name}.`, ttl: 4 });
    }
    this.emit();
  }

  async noticeAction(id: string): Promise<void> {
    this.setNotice(null);
    this.deviceLost = null;
    this.wasPlayingBeforeDeviceLoss = false;
    if (id === 'resume') {
      if (this.phase === 'resting' || this.phase === 'winding') await this.resume();
      else if (this.phase === 'ready') await this.start();
    } else if (id === 'start') {
      await this.start();
    } else if (id === 'end') {
      this.end();
    }
  }

  setNotice(n: Notice | null): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.notice = n;
    if (n?.ttl) {
      this.noticeTimer = setTimeout(() => {
        this.notice = null;
        this.emit();
      }, n.ttl * 1000);
    }
    this.emit();
  }

  // ---------- keep awake ----------

  private awakeKey = '';
  private updateKeepAwake(): void {
    const running = this.isRunning();
    const display = running && this.prefs.keepScreenAwake;
    const system = running;
    const key = `${display}:${system}`;
    if (key === this.awakeKey) return;
    this.awakeKey = key;
    void invoke('set_keep_awake', { display, system }).catch(() => undefined);
  }

  // ---------- reading state ----------

  remaining(): number | null {
    if (this.endAt === null || !this.ctx || !this.isRunning()) return null;
    return Math.max(0, this.endAt - this.ctx.currentTime);
  }

  /** Diagnostics for automated checks. */
  debugInfo(): Record<string, unknown> {
    return {
      phase: this.phase,
      ctxState: this.ctx?.state ?? 'none',
      audioTime: this.ctx ? Number(this.ctx.currentTime.toFixed(2)) : 0,
      sampleRate: this.ctx?.sampleRate,
      ...(this.engine ? this.engine.stats : {}),
      hidden: document.hidden,
    };
  }

  levels() {
    return this.engine && this.ctx?.state === 'running' ? this.engine.levels() : { rms: 0, low: 0, high: 0 };
  }

  beatHzNow(): number {
    return this.engine?.beatHzNow() ?? this.params.beatHz;
  }

  rootNow(): number {
    return this.engine?.rootNow() ?? 55;
  }

  isLanding(): boolean {
    return this.phase === 'winding' || this.phase === 'resting' || this.phase === 'ending' || this.phase === 'ready';
  }

  snapshot(): Snapshot {
    const remaining = this.remaining();
    const now = this.ctx?.currentTime ?? 0;
    return {
      phase: this.phase,
      mode: this.mode,
      preset: this.preset,
      edited: this.isEdited(),
      params: { ...this.params },
      prefs: { ...this.prefs },
      volume: this.volume,
      remaining,
      endsAt: remaining !== null ? new Date(Date.now() + remaining * 1000) : null,
      startedAt: this.startedWall,
      timerDone: this.timerDone,
      inBreak: this.inBreak,
      notice: this.notice,
      output: this.output,
      sweepPhase: this.isRunning() ? (now - this.startAt) % this.params.sweepPeriod : 0,
    };
  }

  private emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

export function freshParams(): SoundParams {
  return defaultParams();
}
