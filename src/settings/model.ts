// App preferences (as opposed to sound settings, which live with presets).

import { loadDoc, patchDoc } from '../platform/store';

export interface AppSettings {
  alwaysOnTop: boolean;
  folded: boolean;
  showTimeInMenuBar: boolean;
  launchAtLogin: boolean;
  shortcutsEnabled: boolean;
  calmVisuals: boolean;
  /** Global brightness ceiling for the visuals, 0.3..1. */
  brightnessCap: number;
  audioReactivity: number;
  visualsWarned: boolean;
  firstRunDone: boolean;
  keepLog: boolean;
}

export const SETTINGS_DEFAULT: AppSettings = {
  alwaysOnTop: false,
  folded: false,
  showTimeInMenuBar: false,
  launchAtLogin: false,
  shortcutsEnabled: false,
  calmVisuals: true,
  brightnessCap: 0.8,
  audioReactivity: 0.4,
  visualsWarned: false,
  firstRunDone: false,
  keepLog: true,
};

/** One finished session, kept only on this Mac. */
export interface LogEntry {
  at: string;
  minutes: number;
  preset: string;
  mode: 'meditate' | 'focus';
}

export async function loadLog(): Promise<LogEntry[]> {
  const doc = await loadDoc();
  return Array.isArray(doc.sessionLog) ? (doc.sessionLog as LogEntry[]) : [];
}

export async function appendLog(entry: LogEntry): Promise<void> {
  const settings = await loadSettings();
  if (!settings.keepLog) return;
  const log = await loadLog();
  log.push(entry);
  await patchDoc({ sessionLog: log.slice(-1000) }, true);
}

export async function clearLog(): Promise<void> {
  await patchDoc({ sessionLog: [] }, true);
}

export async function loadSettings(): Promise<AppSettings> {
  const doc = await loadDoc();
  return { ...SETTINGS_DEFAULT, ...((doc.settings as Partial<AppSettings>) ?? {}) };
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await patchDoc({ settings: s }, true);
}

/** Global shortcuts, used only when the person turns them on in Settings. */
export const GLOBAL_SHORTCUTS: Array<{ keys: string; accel: string; action: string; label: string }> = [
  { keys: '⌃⌥⌘Space', accel: 'Control+Alt+Super+Space', action: 'go', label: 'Start, wind down or resume' },
  { keys: '⌃⌥⌘.', accel: 'Control+Alt+Super+Period', action: 'end', label: 'End' },
  { keys: '⌃⌥⌘↑', accel: 'Control+Alt+Super+ArrowUp', action: 'volume:up', label: 'Louder' },
  { keys: '⌃⌥⌘↓', accel: 'Control+Alt+Super+ArrowDown', action: 'volume:down', label: 'Quieter' },
  { keys: '⌃⌥⌘]', accel: 'Control+Alt+Super+BracketRight', action: 'next-preset', label: 'Next preset' },
];
