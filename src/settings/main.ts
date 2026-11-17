// Settings (⌘,): app preferences. Sound settings live with presets in the
// mini player's panel; this window is for how the app behaves.

import '../styles/pages.css';
import { GLOBAL_SHORTCUTS, clearLog, loadLog, loadSettings, saveSettings, type AppSettings, type LogEntry } from './model';
import { h, scale, switchControl } from '../ui/controls';
import { emit, isTauri, openExternal } from '../platform/bridge';

document.title = 'Tonewell Settings';
document.documentElement.dataset.mode = 'meditate';

async function autostart() {
  if (!isTauri) return null;
  return import('@tauri-apps/plugin-autostart');
}

async function boot(): Promise<void> {
  let s: AppSettings = await loadSettings();
  const save = async (patch: Partial<AppSettings>) => {
    s = { ...s, ...patch };
    await saveSettings(s);
    await emit('settings-changed');
  };

  const row = (label: string, help: string | null, control: HTMLElement) =>
    h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('span', { class: 'set-label' }, label), help ? h('p', { class: 'set-help' }, help) : null), control);

  const top = switchControl('Keep the mini player on top', s.alwaysOnTop, (on) => void save({ alwaysOnTop: on }), true);
  const time = switchControl('Show minutes left in the menu bar', s.showTimeInMenuBar, (on) => void save({ showTimeInMenuBar: on }), true);
  const login = switchControl('Open at login', false, async (on) => {
    const a = await autostart();
    if (!a) return;
    if (on) await a.enable();
    else await a.disable();
  }, true);
  void autostart().then(async (a) => login.set(a ? await a.isEnabled() : false));

  const shortcuts = switchControl('Global shortcuts', s.shortcutsEnabled, (on) => void save({ shortcutsEnabled: on }), true);
  const list = h('dl', { class: 'shortcut-list' }, ...GLOBAL_SHORTCUTS.flatMap((g) => [h('dt', {}, h('span', { class: 'kbd' }, g.keys)), h('dd', {}, g.label)]));

  const calm = switchControl('Calm visuals', s.calmVisuals, (on) => void save({ calmVisuals: on }), true);
  const cap = scale({
    label: 'Brightness limit', value: (s.brightnessCap - 0.3) / 0.7,
    valueText: (p) => `${Math.round((0.3 + p * 0.7) * 100)}%`,
    onInput: (p) => void save({ brightnessCap: Math.round((0.3 + p * 0.7) * 100) / 100 }),
  });
  const react = scale({
    label: 'Follow the sound', value: s.audioReactivity,
    valueText: (p) => (p < 0.02 ? 'Not at all' : `${Math.round(p * 100)}%`),
    onInput: (p) => void save({ audioReactivity: Math.round(p * 100) / 100 }),
  });

  const keepLog = switchControl('Keep a log of sessions', s.keepLog, (on) => void save({ keepLog: on }), true);
  const logBox = h('div', { class: 'log' });
  const renderLog = (log: LogEntry[]) => {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const week = log.filter((e) => new Date(e.at).getTime() >= weekAgo);
    const minutes = week.reduce((a, e) => a + e.minutes, 0);
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    logBox.replaceChildren(
      h('p', { class: 'set-help' }, log.length === 0
        ? 'Nothing here yet. Finished sessions of a minute or more appear here, on this Mac only.'
        : `In the last seven days: ${week.length} ${week.length === 1 ? 'session' : 'sessions'}, ${minutes} minutes.`),
      ...(log.length
        ? [h('ol', { class: 'log-list' }, ...log.slice(-12).reverse().map((e) => h('li', {}, h('span', {}, fmt.format(new Date(e.at))), h('span', {}, e.preset), h('span', {}, `${e.minutes} min`))))]
        : []),
    );
  };
  void loadLog().then(renderLog);
  const clear = h('button', { class: 'btn quiet' }, 'Clear the log');
  clear.addEventListener('click', async () => {
    await clearLog();
    await emit('settings-changed');
    renderLog([]);
  });

  const repo = h('a', { href: 'https://github.com/sethatwood/tonewell' }, 'github.com/sethatwood/tonewell');
  repo.addEventListener('click', (e) => {
    e.preventDefault();
    void openExternal('https://github.com/sethatwood/tonewell');
  });

  document.body.append(
    h(
      'main',
      { class: 'settings' },
      h('h1', { class: 'voice' }, 'Settings'),
      h('section', {}, h('h2', {}, 'General'),
        row('Keep the mini player on top', 'Floats above other windows. Right-click the player for this and for snapping it to a corner.', top.el),
        row('Show minutes left in the menu bar', 'Off by default: a number next to the icon, updated once a minute.', time.el),
        row('Open at login', null, login.el),
      ),
      h('section', {}, h('h2', {}, 'Shortcuts'),
        row('Global shortcuts', 'Control Tonewell from any app. They stay off until you turn them on, so they never clash with your other apps.', shortcuts.el),
        list,
        h('p', { class: 'set-help' }, 'In the mini player: Space starts, Esc winds down and then ends, ⌘↑ and ⌘↓ change the volume, + and − wind the timer, [ and ] change the preset.'),
      ),
      h('section', {}, h('h2', {}, 'Visuals'),
        row('Calm visuals', 'Dimmer, slower and softer color.', calm.el),
        h('div', { class: 'set-scale' }, cap.el),
        h('div', { class: 'set-scale' }, react.el),
        h('p', { class: 'set-help' }, 'Brightness never changes faster than three times a second, whatever you set here.'),
      ),
      h('section', {}, h('h2', {}, 'Sessions'),
        row('Keep a log of sessions', 'Just the date, length and preset. No streaks, no goals, nothing to keep up.', keepLog.el),
        logBox,
        h('div', {}, clear),
      ),
      h('section', {}, h('h2', {}, 'About'),
        h('p', {}, 'Tonewell makes every sound on your Mac as it plays: nothing is recorded, nothing is streamed, and nothing about how you use it leaves this computer.'),
        h('p', {}, 'Open source under the MIT License: ', repo, '.'),
        h('p', { class: 'set-help' }, 'Type: Cormorant Garamond (The Cormorant Project Authors) and Atkinson Hyperlegible Next (Braille Institute of America), both under the SIL Open Font License.'),
      ),
    ),
  );
}

void boot();
