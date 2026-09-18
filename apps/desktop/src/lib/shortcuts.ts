/**
 * One keydown listener for the whole window, and the table of what is bound to
 * what.
 *
 * Two rules decide the table:
 *
 * 1. **Ctrl, never Alt.** On a German keyboard AltGr *is* Ctrl+Alt, and AltGr+7
 *    has to stay a `{`. Nothing in this app is worth breaking a brace for. The
 *    same reasoning, and the same conclusion, as UwUSSH's `lib/tabs.ts`.
 * 2. **Keys that belong to CodeMirror stay with CodeMirror.** Ctrl+C, Ctrl+V,
 *    Ctrl+Z, Ctrl+A, the arrows and Ctrl+Shift+Z are not in here and must not
 *    be: the editor already does the right thing with them, and doing it a
 *    second time at window level would do it twice.
 *
 * Letters and digits are matched on `event.code`, the physical key, so Ctrl+S
 * is the same finger on QWERTZ, QWERTY and Dvorak. The symbol keys used by zoom
 * are matched on `event.key` instead, because there the printed character *is*
 * the point — whichever key makes a `+` is the zoom-in key.
 */

import { t } from './i18n';
import { runCommand } from './commands';
import { activateTabAt, cyclePane } from './workspace';

/** German source names for the modifiers; {@link renderKeys} translates them. */
const CTRL = 'Strg';
const SHIFT = 'Umschalt';

type Binding = {
  /** `KeyboardEvent.code`: where the key is, not what is printed on it. */
  code: string;
  shift: boolean;
  command: string;
};

const BINDINGS: readonly Binding[] = [
  { code: 'KeyN', shift: false, command: 'file.new' },
  { code: 'KeyO', shift: false, command: 'file.open' },
  { code: 'KeyO', shift: true, command: 'file.openFolder' },
  { code: 'KeyS', shift: false, command: 'file.save' },
  { code: 'KeyS', shift: true, command: 'file.saveAs' },
  { code: 'KeyW', shift: false, command: 'file.close' },
  { code: 'KeyW', shift: true, command: 'file.closeAll' },
  { code: 'KeyT', shift: true, command: 'file.reopenClosed' },

  { code: 'Tab', shift: false, command: 'tab.next' },
  { code: 'Tab', shift: true, command: 'tab.previous' },
  // The PageUp/PageDown pair does the same thing, for the hands that learned it
  // in a browser. One label is enough for both.
  { code: 'PageDown', shift: false, command: 'tab.next' },
  { code: 'PageUp', shift: false, command: 'tab.previous' },

  { code: 'KeyR', shift: true, command: 'view.splitRight' },
  { code: 'KeyD', shift: true, command: 'view.splitDown' },
  { code: 'KeyQ', shift: true, command: 'view.closePane' },
  { code: 'KeyM', shift: true, command: 'view.moveTabToOtherPane' },

  { code: 'KeyF', shift: false, command: 'find.find' },
  { code: 'KeyF', shift: true, command: 'find.inFiles' },
  { code: 'KeyH', shift: false, command: 'find.replace' },
  // Ctrl+G is go-to-line, as in Notepad++. CodeMirror's search keymap would
  // rather have it for "find next"; that lives on F3, where muscle memory
  // expects it anyway.
  { code: 'KeyG', shift: false, command: 'find.gotoLine' },

  { code: 'KeyP', shift: true, command: 'app.palette' },
  { code: 'Comma', shift: false, command: 'app.settings' },
];

/**
 * How each bound command is written out in the palette.
 *
 * Separate from {@link BINDINGS} because the two keys zoom sits on are matched
 * by character rather than by code, and because F6 carries no Ctrl at all.
 */
const LABELS: Record<string, readonly string[]> = {
  'file.new': [CTRL, 'N'],
  'file.open': [CTRL, 'O'],
  'file.openFolder': [CTRL, SHIFT, 'O'],
  'file.save': [CTRL, 'S'],
  'file.saveAs': [CTRL, SHIFT, 'S'],
  'file.close': [CTRL, 'W'],
  'file.closeAll': [CTRL, SHIFT, 'W'],
  'file.reopenClosed': [CTRL, SHIFT, 'T'],
  'tab.next': [CTRL, 'Tab'],
  'tab.previous': [CTRL, SHIFT, 'Tab'],
  'view.splitRight': [CTRL, SHIFT, 'R'],
  'view.splitDown': [CTRL, SHIFT, 'D'],
  'view.closePane': [CTRL, SHIFT, 'Q'],
  'view.nextPane': ['F6'],
  'view.moveTabToOtherPane': [CTRL, SHIFT, 'M'],
  'view.zoomIn': [CTRL, '+'],
  'view.zoomOut': [CTRL, '-'],
  'view.zoomReset': [CTRL, '0'],
  'find.find': [CTRL, 'F'],
  'find.replace': [CTRL, 'H'],
  'find.inFiles': [CTRL, SHIFT, 'F'],
  'find.gotoLine': [CTRL, 'G'],
  'app.palette': [CTRL, SHIFT, 'P'],
  'app.settings': [CTRL, ','],
};

function renderKeys(keys: readonly string[]): string {
  return keys
    .map((key) => {
      if (key === CTRL) return t('Strg');
      if (key === SHIFT) return t('Umschalt');
      return key;
    })
    .join('+');
}

/** `Strg+S`, in the current language. `undefined` when nothing is bound. */
export function shortcutLabel(command: string): string | undefined {
  const keys = LABELS[command];
  return keys ? renderKeys(keys) : undefined;
}

/** Installs the listener. Returns the teardown. */
export function installShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const action = actionFor(event);
    if (!action) return;
    event.preventDefault();
    action();
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function actionFor(event: KeyboardEvent): (() => void) | null {
  // F6 is the one binding with no Ctrl. It prints nothing on any layout, so it
  // cannot collide with typing, and it is what every editor already uses.
  if (event.code === 'F6' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    const back = event.shiftKey;
    return () => cyclePane(back);
  }

  if (!event.ctrlKey || event.altKey || event.metaKey) return null;

  // Zoom by printed character: whichever key makes a plus is the one the user
  // will reach for, and on QWERTZ that is not where `Equal` is.
  if (event.key === '+' || event.key === '=') return () => runCommand('view.zoomIn');
  if (event.key === '-' || event.key === '_') return () => runCommand('view.zoomOut');
  if (event.code === 'Digit0' || event.code === 'Numpad0') {
    return () => runCommand('view.zoomReset');
  }

  // Ctrl+1…9 jumps straight to a tab instead of cycling towards it.
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  if (digit?.[1] && !event.shiftKey) {
    const index = Number(digit[1]) - 1;
    return () => activateTabAt(index);
  }

  const binding = BINDINGS.find(
    (entry) => entry.code === event.code && entry.shift === event.shiftKey,
  );
  if (!binding) return null;
  const { command } = binding;
  return () => runCommand(command);
}
