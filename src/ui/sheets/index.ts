import type { SheetBuilder, SheetName } from './host';
import { allSettingsSheet } from './all-settings';
import { beatSheet } from './beat';
import { customBeatSheet } from './custom-beat';
import { guideSheet } from './guide';
import { nameSheet } from './name';
import { sessionSheet } from './session';
import { shapeSheet } from './shape';
import { soundSheet } from './sound';

export { SheetHost, sheetAllowed, type SheetName, type NameRequest } from './host';

/** Every sheet, by name. The Field guide needs to show its numbers on the player. */
export function sheetBuilders(badges: (on: boolean) => void): Record<SheetName, SheetBuilder> {
  return {
    sound: (env) => soundSheet(env),
    session: (env) => sessionSheet(env),
    beat: (env) => beatSheet(env),
    custom: (env) => customBeatSheet(env),
    shape: (env) => shapeSheet(env),
    all: (env, arg) => allSettingsSheet(env, arg),
    guide: (env) => guideSheet(env, badges),
    name: (env, arg) => nameSheet(env, arg),
  };
}
