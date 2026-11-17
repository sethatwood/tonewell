// Local persistence: one JSON file in the app's data folder (Tauri store
// plugin), or localStorage in a browser. Nothing leaves the machine.
//
// Values are stored under separate keys (settings, modes, userPresets,
// sessionLog, ...) and each window writes only the keys it changed, so two
// windows can never overwrite each other's newer data.

import { isTauri } from './bridge';

type Doc = Record<string, unknown>;

const LOCAL_PREFIX = 'tonewell:';

let cache: Doc | null = null;
const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function tauriStore() {
  const { LazyStore } = await import('@tauri-apps/plugin-store');
  return new LazyStore('tonewell.json');
}

export async function loadDoc(): Promise<Doc> {
  if (cache) return cache;
  const doc: Doc = {};
  try {
    if (isTauri) {
      const store = await tauriStore();
      for (const [k, v] of await store.entries()) doc[k] = v;
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(LOCAL_PREFIX)) doc[k.slice(LOCAL_PREFIX.length)] = JSON.parse(localStorage.getItem(k) ?? 'null');
      }
    }
  } catch (err) {
    console.warn('Tonewell: could not read settings', err);
  }
  // Early builds kept everything in one 'tonewell' entry: spread it into separate keys once.
  const legacy = doc.tonewell;
  if (legacy && typeof legacy === 'object') {
    delete doc.tonewell;
    for (const [k, v] of Object.entries(legacy as Doc)) {
      if (!(k in doc)) {
        doc[k] = v;
        dirty.add(k);
      }
    }
    cache = doc;
    try {
      if (isTauri) await (await tauriStore()).delete('tonewell');
    } catch {
      // Not fatal: the old entry is simply ignored from now on.
    }
    await flush();
  }
  cache = doc;
  return cache;
}

/** Re-read everything (another window changed something). Unsaved local changes are kept. */
export async function reloadDoc(): Promise<Doc> {
  const pending: Doc = {};
  if (cache) for (const k of dirty) pending[k] = cache[k];
  cache = null;
  if (isTauri) {
    const store = await tauriStore();
    await store.reload();
  }
  const doc = await loadDoc();
  Object.assign(doc, pending);
  return doc;
}

async function flush(): Promise<void> {
  if (!cache || dirty.size === 0) return;
  const keys = [...dirty];
  dirty.clear();
  try {
    if (isTauri) {
      const store = await tauriStore();
      for (const k of keys) await store.set(k, cache[k]);
      await store.save();
    } else {
      for (const k of keys) localStorage.setItem(LOCAL_PREFIX + k, JSON.stringify(cache[k]));
    }
  } catch (err) {
    console.warn('Tonewell: could not save settings', err);
  }
}

/** Update some keys and save them shortly after (debounced), or at once. */
export async function patchDoc(patch: Doc, immediate = false): Promise<void> {
  const doc = await loadDoc();
  for (const [k, v] of Object.entries(patch)) {
    doc[k] = v;
    dirty.add(k);
  }
  if (saveTimer) clearTimeout(saveTimer);
  if (immediate) await flush();
  else saveTimer = setTimeout(() => void flush(), 400);
}

export async function flushNow(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  await flush();
}
