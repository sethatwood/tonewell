// What the visuals follow in the sound: change, not level. A slow drone's
// loudness hardly moves, so following the level shows almost nothing.
// Following how each band differs from its own recent average shows the
// swells, the bells and the new notes, which is what the ear notices too.
//
// The input is the bed before the beat joins it (WebAudioEngine.bedLevels),
// on a decibel scale, so the beat never reaches the picture and a change
// reads as the ear hears it. The output is plain numbers; the renderer
// smooths and rate-limits everything it draws from them.

export interface Heard {
  rms: number;
  low: number;
  high: number;
  /** The drone's root right now, in hertz. */
  rootHz?: number;
}

export interface Followed {
  /** The low end against its recent average, -1..1: the picture swells and eases. */
  swell: number;
  /** Bells, voices and rain against their recent average, 0..1: light blooms. */
  bloom: number;
  /** Overall loudness against its recent average, -1..1: motion flows faster or slower. */
  drive: number;
  /** The drone's pitch against its recent average, -0.5..0.5 of the palette: colors shift with a new note. */
  hue: number;
}

export const STILL: Readonly<Followed> = { swell: 0, bloom: 0, drive: 0, hue: 0 };

type Band = 'rms' | 'low' | 'high';
const BANDS: readonly Band[] = ['rms', 'low', 'high'];

/** Seconds: tames frame-to-frame jitter in the analyser; loudness jitters most, so it's smoothed most. */
const FAST: Record<Band, number> = { rms: 1, low: 0.3, high: 0.3 };
/** Seconds: what counts as "recent" for loudness, once there's that much to go on. */
const SLOW = 12;
/** Seconds: what counts as "recent" for pitch; the drone changes note about once a minute. */
const ROOT_SLOW = 45;
/** Seconds over which following eases in at the start, while there's little "recent" to compare with. */
const WARM = 8;
/** -85 dB. Quieter overall is the analyser's floor, a suspended context or a silent start: nothing heard. */
const FLOOR = 0.15;
/** Output per decibel above or below the recent average, set from the real engine's levels. */
export const PER_DB = { swell: 0.18, bloom: 0.07, drive: 0.15 };
/** Palette fraction per semitone: a fourth or fifth away moves the colors about a third of the way round. */
const HUE_PER_SEMITONE = 1 / 15;
/** After a gap this long with nothing heard, start the averages afresh. */
const GAP = 3;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const ease = (v: number, target: number, dt: number, tau: number): number => v + (target - v) * Math.min(1, dt / tau);

export class SoundFollower {
  private fast: Record<Band, number> = { rms: 0, low: 0, high: 0 };
  private avg: Record<Band, number> = { rms: 0, low: 0, high: 0 };
  private pitch = 0;
  private pitchAvg = 0;
  private hasPitch = false;
  private primed = false;
  /** Seconds of sound since the averages started. */
  private heardFor = 0;
  private quiet = 0;

  /** Advance by `dt` seconds with what was heard, or null when nothing is playing. */
  update(dt: number, heard: Heard | null): Followed {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 1) : 0;
    const usable = heard !== null && BANDS.every((k) => Number.isFinite(heard[k])) && heard.rms > FLOOR;
    if (!usable) {
      this.quiet += dt;
      if (this.quiet > GAP) {
        this.primed = false;
        this.hasPitch = false;
      }
      return STILL;
    }
    this.quiet = 0;
    const level = { rms: heard.rms, low: Math.max(FLOOR, heard.low), high: Math.max(FLOOR, heard.high) };
    if (!this.primed) {
      this.fast = { ...level };
      this.avg = { ...level };
      this.heardFor = 0;
      this.primed = true;
    }
    this.heardFor += dt;
    // Until there's SLOW seconds of sound, "recent" means everything heard so far.
    const slow = Math.min(SLOW, Math.max(1, this.heardFor));
    const db = {} as Record<Band, number>;
    for (const k of BANDS) {
      this.fast[k] = ease(this.fast[k], level[k], dt, FAST[k]);
      this.avg[k] = ease(this.avg[k], level[k], dt, slow);
      // Levels are 0..1 for -100..0 dB, so 100× the difference is decibels.
      db[k] = 100 * (this.fast[k] - this.avg[k]);
    }

    let hue = 0;
    const root = heard.rootHz;
    if (root !== undefined && Number.isFinite(root) && root > 0) {
      this.pitch = 12 * Math.log2(root);
      if (!this.hasPitch) {
        this.pitchAvg = this.pitch;
        this.hasPitch = true;
      }
      this.pitchAvg = ease(this.pitchAvg, this.pitch, dt, ROOT_SLOW);
      hue = clamp((this.pitch - this.pitchAvg) * HUE_PER_SEMITONE, -0.5, 0.5);
    }

    const warm = Math.min(1, this.heardFor / WARM);
    return {
      swell: warm * clamp(db.low * PER_DB.swell, -1, 1),
      bloom: warm * clamp(db.high * PER_DB.bloom, 0, 1),
      drive: warm * clamp(db.rms * PER_DB.drive, -1, 1),
      hue: warm * hue,
    };
  }
}
