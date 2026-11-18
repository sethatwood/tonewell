// Updates, as the page sees them. The native side checks, downloads and
// installs (src-tauri/src/updates.rs); the page decides when to look and
// when to offer a restart, which is only ever while nothing is playing.

import { invoke, isTauri, listen } from './bridge';
import { loadDoc, patchDoc } from './store';

export type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'failed';

export interface UpdateStatus {
  /** The version running now. */
  current: string;
  state: UpdateState;
  /** The newer version, once one is found. */
  version: string | null;
  /** When the last check finished, in milliseconds since 1970. */
  checkedAt: number | null;
  error: string | null;
  /** Whether a downloaded update can install by itself at quit (no password needed). */
  installsAtQuit: boolean;
}

/** How often to look, at most. A little under a day, so a daily habit doesn't drift later. */
export const CHECK_EVERY_MS = 20 * 3600 * 1000;

export async function updateStatus(): Promise<UpdateStatus | null> {
  if (!isTauri) return null;
  return (await invoke<UpdateStatus>('update_status')) ?? null;
}

/** Look now. Resolves once a newer version has downloaded, or there is none, or the check failed. */
export async function checkForUpdate(): Promise<UpdateStatus | null> {
  if (!isTauri) return null;
  try {
    return (await invoke<UpdateStatus>('update_check')) ?? null;
  } catch (err) {
    return { current: '', state: 'failed', version: null, checkedAt: Date.now(), error: String(err), installsAtQuit: false };
  }
}

/** Install the downloaded version and start it. Only while nothing is playing. */
export async function restartToUpdate(): Promise<void> {
  await invoke('update_restart');
}

export async function onUpdateStatus(cb: (s: UpdateStatus) => void): Promise<void> {
  if (isTauri) await listen<UpdateStatus>('update-status', cb);
}

interface UpdateMemory {
  /** When a check last finished, so a relaunch doesn't look again straight away. */
  lastCheck?: number;
  /** The version that last ran, to say so after an update. */
  lastVersion?: string;
}

export async function loadUpdateMemory(): Promise<UpdateMemory> {
  const doc = await loadDoc();
  return (doc.updates as UpdateMemory | undefined) ?? {};
}

export async function saveUpdateMemory(patch: UpdateMemory): Promise<void> {
  await patchDoc({ updates: { ...(await loadUpdateMemory()), ...patch } }, true);
}

/** Whether a check is due: never looked, or looked long enough ago. A clock set back counts as due. */
export function checkDue(lastCheck: number | undefined, now: number): boolean {
  return lastCheck === undefined || now - lastCheck >= CHECK_EVERY_MS || now < lastCheck;
}
