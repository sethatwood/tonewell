// On a phone Tonewell has one window. Learn, Settings and Visuals open over
// the player as full-screen pages, each in a frame of its own, so the page
// making the sound never navigates away. The system's Back closes the top one.
// Every page reaches the same set through the top window.

export interface Routes {
  open(label: string, url: string, title: string): void;
  close(label?: string): Promise<void>;
  isOpen(label: string): boolean;
  /** The page in front, if any. */
  top(): string | null;
  /** The system's Back: the page in front steps back within itself if it can (see onBack), else closes. */
  back(): Promise<void>;
  onChange(cb: () => void): void;
}

type Host = Window & { __tonewellRoutes?: Routes; __tonewellBack?: () => boolean };

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function create(): Routes {
  const frames = new Map<string, HTMLIFrameElement>();
  const listeners: Array<() => void> = [];
  const changed = () => listeners.forEach((cb) => cb());
  return {
    open(label, url, title) {
      const existing = frames.get(label);
      if (existing) {
        // Bring it to the front.
        frames.delete(label);
        frames.set(label, existing);
        document.body.append(existing);
        existing.focus();
        changed();
        return;
      }
      const f = document.createElement('iframe');
      f.className = 'route';
      f.dataset.label = label;
      f.title = title;
      f.src = url;
      f.dataset.entering = '';
      frames.set(label, f);
      document.body.append(f);
      // Two frames: the first lays the page out where it starts, the second lets it rise.
      requestAnimationFrame(() => requestAnimationFrame(() => delete f.dataset.entering));
      f.addEventListener('load', () => f.focus(), { once: true });
      changed();
    },
    async close(label) {
      const key = label ?? [...frames.keys()].pop();
      const f = key ? frames.get(key) : undefined;
      if (!key || !f) return;
      frames.delete(key);
      f.dataset.leaving = '';
      changed();
      await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 200));
      f.remove();
    },
    async back() {
      const key = [...frames.keys()].pop();
      const f = key ? frames.get(key) : undefined;
      if (!f) return;
      let handled = false;
      try {
        handled = (f.contentWindow as Host | null)?.__tonewellBack?.() ?? false;
      } catch {
        handled = false;
      }
      if (!handled) await this.close(key);
    },
    isOpen: (label) => frames.has(label),
    top: () => [...frames.keys()].pop() ?? null,
    onChange: (cb) => void listeners.push(cb),
  };
}

/** The phone window's pages, from whichever page asks. */
export function routes(): Routes {
  let host: Host;
  try {
    host = (window.top ?? window) as Host;
    void host.document;
  } catch {
    host = window as Host;
  }
  if (host === window) return (host.__tonewellRoutes ??= create());
  return host.__tonewellRoutes ?? ((window as Host).__tonewellRoutes ??= create());
}

/** This page's own label, when it is one of the phone window's pages. */
export function ownRoute(): string | null {
  try {
    return (window.frameElement as HTMLElement | null)?.dataset.label ?? null;
  } catch {
    return null;
  }
}

/** Let this page take the system's Back first (Learn: from a card back to the list). Return true if it did. */
export function onBack(handler: () => boolean): void {
  (window as Host).__tonewellBack = handler;
}
