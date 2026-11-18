// Settings (⌘,): how the app behaves. Nothing about the sound lives here (the
// player's sheets have that), and the visuals' settings live in the visuals
// window's Light panel. Four tabs: General, Shortcuts, Sessions, About.

import '../styles/pages.css';
import { GLOBAL_SHORTCUTS, clearLog, loadLog, loadSettings, patchSettings, type AppSettings, type LogEntry } from './model';
import { h, switchControl } from '../ui/controls';
import { emit, isTauri, listen, openExternal } from '../platform/bridge';
import { reloadDoc } from '../platform/store';
import { checkForUpdate, onUpdateStatus, updateStatus, type UpdateStatus } from '../platform/updates';
import { computer, isMac, keys } from '../platform/os';

document.title = 'Tonewell Settings';
document.documentElement.dataset.mode = 'meditate';

type Tab = 'general' | 'shortcuts' | 'sessions' | 'about';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'about', label: 'About' },
];
let tab: Tab = 'general';

/** Repaints the update line; replaced each time the page is rebuilt. */
let paintUpdate: (u: UpdateStatus) => void = () => undefined;

function updateText(u: UpdateStatus): string {
  const when = u.checkedAt ? new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(u.checkedAt)) : null;
  switch (u.state) {
    case 'checking':
      return 'Checking…';
    case 'downloading':
      return `Downloading version ${u.version}…`;
    case 'ready':
      return u.installsAtQuit
        ? `Version ${u.version} is ready. It installs when you quit Tonewell, or restart from the player now.`
        : `Version ${u.version} is ready. Restart from the player to install it.`;
    case 'failed':
      return 'Couldn’t check for updates just now. Tonewell will try again later.';
    case 'latest':
      return `Version ${u.current}, the latest.${when ? ` Checked ${when}.` : ''}`;
    default:
      return `Version ${u.current}.`;
  }
}

async function autostart() {
  if (!isTauri) return null;
  return import('@tauri-apps/plugin-autostart');
}

async function appVersion(): Promise<string> {
  if (!isTauri) return '';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion().catch(() => '');
}

const row = (label: string, help: string | null, control: HTMLElement) =>
  h('div', { class: 'row' }, h('div', { class: 'row__text' }, h('span', { class: 'row__label' }, label), help ? h('p', { class: 'row__help' }, help) : null), control);

const MARK = '<svg viewBox="0 0 56 56" aria-hidden="true"><rect width="56" height="56" rx="13" fill="#0B0E1A" stroke="#2A3150"/><g transform="translate(10 10)" fill="none"><circle cx="18" cy="18" r="4.8" fill="#DCE3FF"/><circle cx="18" cy="18" r="10.4" stroke="#AFC0FF" stroke-width="2" stroke-opacity=".75"/><circle cx="18" cy="18" r="16" stroke="#AFC0FF" stroke-width="1.6" stroke-opacity=".38"/></g></svg>';

async function boot(): Promise<void> {
  let s: AppSettings = await loadSettings();
  const save = async (patch: Partial<AppSettings>) => {
    s = await patchSettings(patch);
  };

  // ---------- General ----------
  const top = switchControl('Keep the player on top', s.alwaysOnTop, (on) => void save({ alwaysOnTop: on }), true);
  const time = switchControl('Show minutes left in the menu bar', s.showTimeInMenuBar, (on) => void save({ showTimeInMenuBar: on }), true);
  const dock = switchControl('Show in the Dock', s.showInDock, (on) => void save({ showInDock: on }), true);
  const soften = switchControl('Soften during calls', s.softenForCalls, (on) => void save({ softenForCalls: on }), true);
  const login = switchControl('Open at login', false, async (on) => {
    const a = await autostart();
    if (!a) return;
    if (on) await a.enable();
    else await a.disable();
  }, true);
  void autostart().then(async (a) => login.set(a ? await a.isEnabled() : false));
  const general = h(
    'div',
    {},
    row('Keep the player on top', 'Floats above other windows. Right-click the player to snap it to a corner.', top.el),
    isMac ? row('Show minutes left in the menu bar', 'A number beside the icon, updated once a minute.', time.el) : null,
    row('Open at login', null, login.el),
    // The Dock and microphone watching exist only on macOS.
    isMac ? row('Show in the Dock', 'Turn this off to keep Tonewell only in the menu bar.', dock.el) : null,
    isMac ? row('Soften during calls', 'While any app is using a microphone, the sound gets noticeably quieter. Tonewell only checks whether a microphone is in use; it never listens.', soften.el) : null,
    h('p', { class: 'foot' }, 'Visuals settings, including the brightness limit, live in the visuals window’s Light panel.'),
  );

  // ---------- Shortcuts ----------
  const shortcuts = switchControl('Global shortcuts', s.shortcutsEnabled, (on) => void save({ shortcutsEnabled: on }), true);
  const list = h('dl', { class: 'shortcut-list' }, ...GLOBAL_SHORTCUTS.flatMap((g) => [h('dt', {}, h('span', { class: 'keycap' }, keys(g.keys))), h('dd', {}, g.label)]));
  const shortcutsPanel = h(
    'div',
    {},
    row('Global shortcuts', 'Control Tonewell from any app. They stay off until you turn them on, so they never clash with your other apps.', shortcuts.el),
    list,
    h(
      'p',
      { class: 'foot' },
      `In the player: Space starts, esc winds down, + and − change the length, [ and ] change the sound, ${keys('⌘↑')} ${keys('⌘↓')} volume, ? the field guide. Headphone buttons and the play key walk the same steps as esc while a session runs.`,
    ),
  );

  // ---------- Sessions ----------
  const keepLog = switchControl('Keep a log of sessions', s.keepLog, (on) => void save({ keepLog: on }), true);
  const logBox = h('div', {});
  const clearArea = h('div', {});
  const renderLog = (log: LogEntry[]) => {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const minutes = log.filter((e) => new Date(e.at).getTime() >= weekAgo).reduce((a, e) => a + e.minutes, 0);
    const total = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
    const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
    const today = new Date().toDateString();
    const when = (d: Date) => `${d.toDateString() === today ? 'Today' : day.format(d)} ${clock.format(d)}`;
    logBox.replaceChildren(
      ...(log.length
        ? [
            h('div', { class: 'week' }, h('span', { class: 'week__total' }, total), h('span', { class: 'week__label' }, 'in the last seven days')),
            h('ol', { class: 'log-list' }, ...log.slice(-12).reverse().map((e) => h('li', {}, h('span', {}, when(new Date(e.at))), h('span', {}, e.preset), h('span', {}, `${e.minutes} min`)))),
          ]
        : [h('p', { class: 'foot' }, `Nothing here yet. Finished sessions of a minute or more appear here, on this ${computer} only.`)]),
    );
    clearArea.hidden = log.length === 0;
  };
  void loadLog().then(renderLog);
  const askClear = () => {
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const clear = h('button', { class: 'btn btn--primary', type: 'button' }, 'Clear');
    clearArea.replaceChildren(h('div', { class: 'confirm', role: 'group', 'aria-label': 'Clear the session log?' }, h('span', {}, 'Clear the session log? This can’t be undone.'), cancel, clear));
    cancel.addEventListener('click', () => {
      showClear();
      clearArea.querySelector('button')?.focus();
    });
    clear.addEventListener('click', async () => {
      await clearLog();
      await emit('settings-changed');
      renderLog([]);
      showClear();
    });
    cancel.focus();
  };
  const showClear = () => {
    const b = h('button', { class: 'btn', type: 'button' }, 'Clear the log…');
    b.addEventListener('click', askClear);
    clearArea.replaceChildren(h('div', { class: 'confirm' }, b));
  };
  showClear();
  const sessions = h('div', {}, row('Keep a log of sessions', 'Just the date, length and sound. No streaks, no goals, nothing to keep up.', keepLog.el), logBox, clearArea);

  // ---------- About, and updates ----------
  const version = h('div', { class: 'about-head__version' });
  void appVersion().then((v) => (version.textContent = v ? `Version ${v}` : ''));
  const mark = h('span', {});
  mark.innerHTML = MARK;
  const updates = switchControl('Check for updates', s.checkUpdates, (on) => void save({ checkUpdates: on }), true);
  const updateLine = h('p', { class: 'row__help', role: 'status' });
  const checkNow = h('button', { class: 'btn', type: 'button' }, 'Check now');
  checkNow.addEventListener('click', () => void checkForUpdate());
  paintUpdate = (u) => {
    updateLine.textContent = updateText(u);
    checkNow.disabled = u.state === 'checking' || u.state === 'downloading' || u.state === 'ready';
  };
  void updateStatus().then((u) => u && paintUpdate(u));
  const repo = h('a', { href: 'https://github.com/sethatwood/tonewell' }, 'Source code');
  repo.addEventListener('click', (e) => {
    e.preventDefault();
    void openExternal('https://github.com/sethatwood/tonewell');
  });
  const about = h(
    'div',
    {},
    h('div', { class: 'about-head' }, mark, h('div', {}, h('div', { class: 'about-head__name' }, 'tonewell'), version)),
    h('p', { class: 'about-lead' }, `Tonewell makes every sound live on your ${computer}. Nothing is recorded or streamed.`),
    h(
      'p',
      { class: 'about-body' },
      `There are no accounts and no analytics. Your settings, sounds and session log stay in one file on this ${computer}. The only things that reach the internet are the daily update check, which sends nothing about you, and Learn’s sources, which open in your browser.`,
    ),
    h('p', { class: 'about-small' }, 'MIT license. ', repo),
    h('p', { class: 'about-small' }, 'Type: Figtree, by Erik Kennedy, SIL Open Font License.'),
    row(
      'Check for updates',
      'Once a day, Tonewell asks tonewell.space whether there’s a new version. If there is, it downloads it from GitHub and installs it when you quit or restart, never during a session. Turning this off also drops an update that’s waiting.',
      updates.el,
    ),
    updateLine,
    h('div', { class: 'confirm' }, checkNow),
  );

  // ---------- the tabs ----------
  const panels: Record<Tab, HTMLElement> = { general, shortcuts: shortcutsPanel, sessions, about };
  const tabButtons = TABS.map((t) => h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'tab-panel' }, t.label));
  const panel = h('div', { class: 'tab-panel', id: 'tab-panel', role: 'tabpanel', tabindex: '-1' });
  const select = (next: Tab, focus = false) => {
    tab = next;
    TABS.forEach((t, i) => {
      tabButtons[i].setAttribute('aria-selected', String(t.id === tab));
      tabButtons[i].tabIndex = t.id === tab ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
    panel.replaceChildren(panels[tab]);
    if (focus) tabButtons[TABS.findIndex((t) => t.id === tab)].focus();
  };
  tabButtons.forEach((b, i) => b.addEventListener('click', () => select(TABS[i].id)));
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings' }, ...tabButtons);
  tablist.addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      select(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id, true);
    }
  });
  select(tab);

  document.body.append(
    h('header', { class: 'win-strip', 'data-tauri-drag-region': '' }, h('span', { class: 'win-strip__title', 'data-tauri-drag-region': '' }, 'Settings')),
    h('main', { class: 'settings' }, tablist, panel),
  );
}

let rendering = false;
async function rebuild(): Promise<void> {
  if (rendering) return;
  rendering = true;
  const scroll = document.querySelector('.tab-panel')?.scrollTop ?? 0;
  const focusedLabel = (document.activeElement as HTMLElement | null)?.getAttribute('aria-label');
  await reloadDoc();
  document.querySelector('.settings')?.remove();
  document.querySelector('.win-strip')?.remove();
  await boot();
  const panel = document.querySelector('.tab-panel');
  if (panel) panel.scrollTop = scroll;
  if (focusedLabel) document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusedLabel)}"]`)?.focus();
  rendering = false;
}

void boot().then(async () => {
  await listen('settings-changed', () => void rebuild());
  await onUpdateStatus((u) => paintUpdate(u));
});
