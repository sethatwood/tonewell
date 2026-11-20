// Which system Tonewell is running on, for wording: "your Mac", "your
// computer" or "your phone", and shortcuts written the way the system writes
// them.

const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;

/** A phone (Android for now): one window, touch, the lock screen in place of the menu bar. */
export const isPhone = /Android|iPhone|iPod/.test(ua);

/** A Mac, or anything that doesn't say otherwise (a browser during development, the tests). */
export const isMac = !isPhone && !/Windows|Linux|X11|CrOS/.test(ua);

/** "Click", or "Tap" on a touch screen. */
export const Click = isPhone ? 'Tap' : 'Click';

/** "Mac", "phone" or "computer", for sentences about the machine. */
export const computer = isMac ? 'Mac' : isPhone ? 'phone' : 'computer';

/** A shortcut written Mac-style ("⌘M", "⇧⌘V", "⌃⌥⌘Space"), in this system's notation ("Ctrl+M", "Ctrl+Shift+V", "Ctrl+Alt+Win+Space"). */
export function keys(mac: string): string {
  if (isMac) return mac;
  const mods = new Set<string>();
  let i = 0;
  for (; i < mac.length && '⌃⌥⇧⌘'.includes(mac[i]); i++) mods.add(mac[i]);
  const ctrl = mods.has('⌃') || (mods.has('⌘') && !mods.has('⌃'));
  // ⌘ is Ctrl, except beside ⌃, where it can only be the Windows key.
  const win = mods.has('⌘') && mods.has('⌃');
  return [ctrl && 'Ctrl', mods.has('⌥') && 'Alt', mods.has('⇧') && 'Shift', win && 'Win', mac.slice(i)].filter(Boolean).join('+');
}
