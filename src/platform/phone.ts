// A session's life on a phone, through the playback plugin
// (src-tauri/plugins/playback): the lock screen and notification in place of
// the menu bar, headphone buttons, other apps' sound, headphones coming and
// going, and the system's Back.

import { invoke, isTauri } from './bridge';
import { isPhone } from './os';

/** Running as the phone app (not a phone's browser during development). */
export const onPhone = isPhone && isTauri;

export interface Control {
  id: string;
  label: string;
}

/** What the lock screen shows: the sound, where the session stands, and its controls. */
export interface NowPlaying {
  /** "playing", "paused" (winding down, resting, paused by a notice) or "stopped" (no session). */
  state: 'playing' | 'paused' | 'stopped';
  title: string;
  text?: string;
  subtext?: string;
  controls: Control[];
}

export interface OutputInfo {
  name: string;
  kind: string;
  muted: boolean;
}

export interface OutputChange {
  change: string;
  previous: OutputInfo | null;
  current: OutputInfo | null;
}

let lastShown = '';

/** Show the session (or, "stopped", stop showing it and let the phone sleep). Repeats are free. */
export async function showSession(now: NowPlaying): Promise<void> {
  if (!onPhone) return;
  const json = JSON.stringify(now);
  if (json === lastShown) return;
  lastShown = json;
  try {
    await invoke('plugin:playback|update', { ...now });
  } catch (err) {
    lastShown = '';
    console.warn('Tonewell: the lock screen did not update', err);
  }
}

export async function phoneOutput(): Promise<OutputInfo | null> {
  if (!onPhone) return null;
  return (await invoke<OutputInfo>('plugin:playback|output').catch(() => undefined)) ?? null;
}

/** While something is open over the player, Back closes it instead of leaving the app. */
export async function takeBack(on: boolean): Promise<void> {
  if (onPhone) await invoke('plugin:playback|handle_back', { on }).catch(() => undefined);
}

type Events = {
  /** A control on the lock screen, the notification or headphones: wind, resume, end, media-play, media-pause, media-toggle. */
  action: { id: string };
  output: OutputChange;
  /** Other apps' sound: "transient" (a call, a spoken direction), "duck", "loss" (another app plays for good), "gain". */
  focus: { state: 'transient' | 'duck' | 'loss' | 'gain' };
  back: Record<string, never>;
};

export async function onPlayback<K extends keyof Events>(event: K, cb: (payload: Events[K]) => void): Promise<void> {
  if (!onPhone) return;
  const { addPluginListener } = await import('@tauri-apps/api/core');
  await addPluginListener<Events[K]>('playback', event, cb);
}
