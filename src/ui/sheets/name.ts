// Keep as your sound, Rename and Delete: a small sheet with its focus kept
// inside. Return keeps (or renames, or deletes); Esc cancels.

import type { Snapshot } from '../../session/session';
import { h } from '../controls';
import type { NameRequest, Sheet, SheetEnv } from './host';

export function nameSheet(env: SheetEnv, arg: unknown): Sheet {
  const { session } = env;
  const req = (arg as NameRequest | undefined) ?? { kind: 'keep' };
  const target = req.id ? session.findPreset(req.id) : undefined;
  const current = session.preset;
  const title = h('h2', { class: 'sheet__title' });
  const line = h('p', { class: 'sheet__help' });
  const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Name' });
  const cancel = h('button', { class: 'btn btn--lg', type: 'button' }, 'Cancel');
  const primary = h('button', { class: 'btn btn--lg btn--primary', type: 'submit' });
  const secondary = h('button', { class: 'btn btn--lg', type: 'button', hidden: true });
  const form = h('form', { class: 'name-form' }, title, line, input, h('div', { class: 'name-form__actions' }, cancel, secondary, primary));
  // Leave once: deleting re-renders this sheet (which also leaves when its sound is gone).
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    env.back();
  };
  cancel.addEventListener('click', leave);

  // One of yours, changed: offer to update it first, or keep the change as a new one.
  const updating = req.kind === 'keep' && !current.builtin && session.isEdited();
  const name = () => input.value.trim();

  const keepAsNew = () => {
    if (!name()) return input.focus();
    session.saveAsPreset(name());
    leave();
  };
  if (req.kind === 'keep') {
    title.textContent = 'Keep as your sound';
    line.textContent = updating ? `Update ${current.name} with what you hear, or keep it as a new sound under the name below.` : 'A name you will recognize later.';
    input.value = updating ? `${current.name} (new)` : `${current.name} (mine)`;
    primary.textContent = updating ? `Update ${current.name}` : 'Keep';
    if (updating) {
      secondary.hidden = false;
      secondary.textContent = 'Keep as new';
      secondary.addEventListener('click', keepAsNew);
    }
  } else if (req.kind === 'rename') {
    title.textContent = `Rename ${target?.name ?? ''}`;
    line.textContent = 'A name you will recognize later.';
    input.value = target?.name ?? '';
    primary.textContent = 'Rename';
  } else {
    title.textContent = `Delete ${target?.name ?? ''}?`;
    line.textContent = 'This can’t be undone.';
    input.hidden = true;
    primary.textContent = 'Delete';
    primary.classList.add('btn--danger');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (req.kind === 'keep') {
      // Return in the name field keeps a new sound under that name; on Update, it updates.
      if (updating && document.activeElement === input) return keepAsNew();
      if (updating) session.savePreset();
      else if (name()) session.saveAsPreset(name());
      else return input.focus();
    } else if (req.kind === 'rename') {
      if (!target || !name()) return input.focus();
      session.renamePreset(target.id, name());
    } else if (target) session.deletePreset(target.id);
    leave();
  });
  // Esc cancels here, before it reaches anything else.
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      leave();
    }
  });

  return {
    el: h('div', {}, form),
    label: title.textContent ?? 'Name',
    trap: true,
    rest: () =>
      req.kind === 'delete'
        ? [{ t: 'Your other sounds stay as they are.' }]
        : updating
          ? [{ b: 'Return' }, { t: 'in the name keeps a new sound;' }, { b: 'esc' }, { t: 'cancels.' }]
          : [{ b: 'Return' }, { t: 'keeps it,' }, { b: 'esc' }, { t: 'cancels.' }],
    initialFocus: () => {
      if (req.kind === 'delete') return cancel;
      if (updating) return primary;
      queueMicrotask(() => input.select());
      return input;
    },
    render(_s: Snapshot) {
      // A sound that was deleted elsewhere can't be renamed or deleted here.
      if ((req.kind === 'rename' || req.kind === 'delete') && (!req.id || !session.findPreset(req.id))) leave();
    },
  };
}
