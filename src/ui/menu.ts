// One menu description serves the native pop-up menus (preset, length,
// beat, right-click) and the menu-bar menu. In a browser the pop-ups fall
// back to a small HTML list.

import { isTauri } from '../platform/bridge';

export type MenuNode =
  | { kind: 'item'; id: string; label: string; enabled?: boolean }
  | { kind: 'check'; id: string; label: string; checked: boolean; enabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; children: MenuNode[]; enabled?: boolean };

export const item = (id: string, label: string, enabled = true): MenuNode => ({ kind: 'item', id, label, enabled });
export const check = (id: string, label: string, checked: boolean, enabled = true): MenuNode => ({ kind: 'check', id, label, checked, enabled });
export const sep: MenuNode = { kind: 'separator' };
export const submenu = (label: string, children: MenuNode[], enabled = true): MenuNode => ({ kind: 'submenu', label, children, enabled });

/** Show a menu under `anchor`, or at `at` (a right-click), and resolve with the chosen id (or null). */
export async function popup(nodes: MenuNode[], anchor: HTMLElement, at?: { x: number; y: number }): Promise<string | null> {
  if (isTauri) return nativePopup(nodes, anchor, at);
  return htmlPopup(nodes, anchor, at);
}

async function nativePopup(nodes: MenuNode[], anchor: HTMLElement, at?: { x: number; y: number }): Promise<string | null> {
  const { Menu, MenuItem, CheckMenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu');
  const { LogicalPosition } = await import('@tauri-apps/api/dpi');
  let chosen: string | null = null;
  let resolveChosen: (id: string | null) => void = () => undefined;
  const picked = new Promise<string | null>((r) => (resolveChosen = r));
  const action = (id: string) => () => {
    chosen = id;
    resolveChosen(id);
  };
  type Built = Awaited<ReturnType<typeof MenuItem.new>> | Awaited<ReturnType<typeof CheckMenuItem.new>> | Awaited<ReturnType<typeof PredefinedMenuItem.new>> | Awaited<ReturnType<typeof Submenu.new>>;
  const build = async (list: MenuNode[]): Promise<Built[]> => {
    const out: Built[] = [];
    for (const n of list) {
      if (n.kind === 'separator') out.push(await PredefinedMenuItem.new({ item: 'Separator' }));
      else if (n.kind === 'item') out.push(await MenuItem.new({ id: n.id, text: n.label, enabled: n.enabled ?? true, action: action(n.id) }));
      else if (n.kind === 'check') out.push(await CheckMenuItem.new({ id: n.id, text: n.label, checked: n.checked, enabled: n.enabled ?? true, action: action(n.id) }));
      else out.push(await Submenu.new({ text: n.label, enabled: n.enabled ?? true, items: await build(n.children) }));
    }
    return out;
  };
  const menu = await Menu.new({ items: await build(nodes) });
  const r = anchor.getBoundingClientRect();
  await menu.popup(at ? new LogicalPosition(at.x, at.y) : new LogicalPosition(r.left, r.bottom + 4));
  // popup() resolves when the menu closes; an action may arrive just after.
  const result = await Promise.race([picked, new Promise<null>((r) => setTimeout(() => r(null), 80))]);
  return result ?? chosen;
}

function htmlPopup(nodes: MenuNode[], anchor: HTMLElement, at?: { x: number; y: number }): Promise<string | null> {
  return new Promise((resolve) => {
    document.querySelector('.pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.setAttribute('role', 'menu');
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(at?.x ?? r.left, innerWidth - 248))}px`;
    pop.style.top = `${at?.y ?? r.bottom + 4}px`;
    const close = (id: string | null) => {
      pop.remove();
      removeEventListener('pointerdown', outside, true);
      anchor.focus();
      resolve(id);
    };
    const outside = (e: Event) => {
      if (!pop.contains(e.target as Node)) close(null);
    };
    const add = (list: MenuNode[], depth: number) => {
      for (const n of list) {
        if (n.kind === 'separator') {
          const hr = document.createElement('div');
          hr.className = 'pop-sep';
          pop.append(hr);
        } else if (n.kind === 'submenu') {
          const h = document.createElement('div');
          h.className = 'pop-head';
          h.textContent = n.label;
          pop.append(h);
          add(n.children, depth + 1);
        } else {
          const b = document.createElement('button');
          b.setAttribute('role', n.kind === 'check' ? 'menuitemcheckbox' : 'menuitem');
          if (n.kind === 'check') b.setAttribute('aria-checked', String(n.checked));
          b.disabled = n.enabled === false;
          b.style.paddingLeft = `${12 + depth * 12}px`;
          b.textContent = n.label;
          b.addEventListener('click', () => close(n.id));
          pop.append(b);
        }
      }
    };
    add(nodes, 0);
    pop.addEventListener('keydown', (e) => {
      const items = [...pop.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      } else if (e.key === 'ArrowDown') {
        items[(i + 1) % items.length]?.focus();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        items[(i - 1 + items.length) % items.length]?.focus();
        e.preventDefault();
      }
    });
    document.body.append(pop);
    pop.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    setTimeout(() => addEventListener('pointerdown', outside, true), 0);
  });
}
