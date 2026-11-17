// Local persistence: one JSON document in the app's data folder (Tauri
// store plugin), or localStorage in a browser. Nothing leaves the machine.

import { isTauri } from './bridge';

const KEY = 'tonewell';

type Doc = Record<string, unknown>;

let cache: Doc | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function tauriStore() {
  const { LazyStore } = await import('@tauri-apps/plugin-store');
  return new LazyStore('tonewell.json');
}

export async function loadDoc(): Promise<Doc> {
  if (cache) return cache;
  try {
    if (isTauri) {
      const store = await tauriStore();
      cache = ((await store.get<Doc>(KEY)) ?? {}) as Doc;
    } else {
      cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Doc;
    }
  } catch {
    cache = {};
  }
  return cache;
}

export async function reloadDoc(): Promise<Doc> {
  cache = null;
  if (isTauri) {
    const store = await tauriStore();
    await store.reload();
  }
  return loadDoc();
}

async function flush(): Promise<void> {
  if (!cache) return;
  try {
    if (isTauri) {
      const store = await tauriStore();
      await store.set(KEY, cache);
      await store.save();
    } else {
      localStorage.setItem(KEY, JSON.stringify(cache));
    }
  } catch (err) {
    console.warn('Tonewell: could not save settings', err);
  }
}

/** Update part of the document and save shortly after (debounced). */
export async function patchDoc(patch: Doc, immediate = false): Promise<void> {
  const doc = await loadDoc();
  Object.assign(doc, patch);
  if (saveTimer) clearTimeout(saveTimer);
  if (immediate) await flush();
  else saveTimer = setTimeout(() => void flush(), 400);
}

export async function flushNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  await flush();
}
