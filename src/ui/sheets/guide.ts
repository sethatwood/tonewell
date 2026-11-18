// The Field guide (? or the help tool): numbered labels beside each of the
// player's controls, what each does, and the keys for a sit with your eyes
// closed.

import type { Snapshot } from '../../session/session';
import { keys } from '../../platform/os';
import { h } from '../controls';
import type { Sheet, SheetEnv } from './host';
import { sheetHead, sheetLabel } from './parts';

export const GUIDE_ITEMS = [
  'The light. Starts the sound; while playing, it winds down.',
  'Meditate or Focus. Each keeps its own sound.',
  'The sound. Click to choose another.',
  'How long. Opens the session settings.',
  'The beat, named by what it is used for.',
  'Shape the sound, visuals, and this guide.',
];

const EYES_CLOSED: Array<[string, string]> = [
  ['Space', 'Start or resume'],
  ['esc', 'Wind down, then end'],
  ['+ −', '5 min more or less'],
  ['[ ]', 'Previous or next sound'],
  ['⌘↑ ⌘↓', 'Volume'],
  ['⌘B', 'Beat on or off'],
  ['⌘1 ⌘2', 'Meditate or Focus'],
  ['⌘L', 'Learn'],
];

/** `badges` shows or hides the numbers beside the player's controls. */
export function guideSheet(env: SheetEnv, badges: (on: boolean) => void): Sheet {
  const close = h('button', { class: 'btn', type: 'button' }, 'Close', h('kbd', { class: 'kbd' }, '?'));
  close.addEventListener('click', () => env.close());
  env.hints.add(close, () => [{ b: 'Close the guide.' }, { k: '?' }, { t: 'or esc.' }]);
  const list = h('ol', { class: 'guide' }, ...GUIDE_ITEMS.map((t, i) => h('li', { class: 'guide__item' }, h('span', { class: 'guide__n', 'aria-hidden': 'true' }, String(i + 1)), t)));
  const grid = h(
    'dl',
    { class: 'keys' },
    ...EYES_CLOSED.map(([k, what]) => h('div', {}, h('dt', {}, h('kbd', {}, k.split(' ').map((x) => keys(x)).join(' '))), h('dd', {}, what))),
  );
  const note = h('p', { class: 'sheet__help' }, 'Headphone buttons and the play key work like esc while a session runs. Global shortcuts can be turned on in Settings.');
  const el = h('div', {}, sheetHead('Field guide', close), list, sheetLabel('Eyes closed'), grid, note);
  badges(true);
  return {
    el,
    label: 'Field guide',
    rest: () => [{ t: 'Hover anything for a one-line explanation right here.' }],
    initialFocus: () => close,
    dispose: () => badges(false),
    render(_s: Snapshot) {
      // The player places the numbers as it renders.
    },
  };
}
