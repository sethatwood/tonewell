// A thin layer over Tauri so the same code also runs in a plain browser
// (for development and automated checks). In the browser, windows become
// tabs, events travel over a BroadcastChannel and storage is localStorage.

import type { UnlistenFn } from '@tauri-apps/api/event';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tonewell') : null;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri) return undefined;
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  if (isTauri) {
    const ev = await import('@tauri-apps/api/event');
    await ev.emit(event, payload);
  } else {
    channel?.postMessage({ event, payload });
  }
}

export async function emitTo(target: string, event: string, payload?: unknown): Promise<void> {
  if (isTauri) {
    const ev = await import('@tauri-apps/api/event');
    await ev.emitTo(target, event, payload);
  } else {
    channel?.postMessage({ event, payload });
  }
}

export async function listen<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri) {
    const ev = await import('@tauri-apps/api/event');
    return ev.listen<T>(event, (e) => cb(e.payload));
  }
  const handler = (m: MessageEvent) => {
    if (m.data?.event === event) cb(m.data.payload as T);
  };
  channel?.addEventListener('message', handler);
  return () => channel?.removeEventListener('message', handler);
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const opener = await import('@tauri-apps/plugin-opener');
    await opener.openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export interface WindowSpec {
  label: string;
  url: string;
  title: string;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  background?: string;
}

/** Open (or focus) a secondary window. */
export async function openWindow(spec: WindowSpec): Promise<void> {
  if (!isTauri) {
    window.open(spec.url, spec.label);
    return;
  }
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel(spec.label);
  if (existing) {
    await existing.unminimize();
    await existing.show();
    await existing.setFocus();
    return;
  }
  const w = new WebviewWindow(spec.label, {
    url: spec.url,
    title: spec.title,
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    resizable: spec.resizable ?? true,
    center: true,
    backgroundColor: spec.background ?? '#1e1124',
    titleBarStyle: 'overlay',
    hiddenTitle: true,
  });
  await new Promise<void>((resolve) => {
    void w.once('tauri://created', () => resolve());
    void w.once('tauri://error', () => resolve());
  });
}

export async function isWindowOpen(label: string): Promise<boolean> {
  if (!isTauri) return false;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  return (await WebviewWindow.getByLabel(label)) !== null;
}

export async function currentWindow() {
  if (!isTauri) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

// Secondary windows have a transparent title bar: give them a strip to drag by.
if (isTauri && typeof document !== 'undefined' && !location.pathname.endsWith('index.html') && location.pathname !== '/') {
  const strip = document.createElement('div');
  strip.className = 'drag-strip';
  strip.setAttribute('data-tauri-drag-region', '');
  strip.style.cssText = 'position:fixed;inset:0 0 auto 0;height:28px;z-index:5';
  addEventListener('DOMContentLoaded', () => document.body.prepend(strip));
}

// WebKit's own right-click menu offers Reload, which would end a session abruptly.
if (typeof window !== 'undefined') {
  addEventListener('contextmenu', (e) => {
    if (!(e.target as HTMLElement | null)?.closest?.('input, textarea')) e.preventDefault();
  });
}

// Uncaught errors from any window go to the app's log (stderr), where
// diagnostics runs can see them. Nothing is sent anywhere else.
if (isTauri) {
  const report = (msg: string) => void invoke('debug_log', { line: `${location.pathname}: ${msg}` }).catch(() => undefined);
  addEventListener('error', (e) => report(`${e.message} at ${e.filename}:${e.lineno}`));
  addEventListener('unhandledrejection', (e) => report(`unhandled: ${String(e.reason)}`));
}
