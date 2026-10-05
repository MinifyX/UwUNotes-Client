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
import { commandEnabled, runCommand } from './commands';
import { macroWithShortcut, playMacro } from './macros';
import { activateTabAt, cyclePane } from './workspace';
import { zenActive } from './zen';

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
  { code: 'KeyP', shift: false, command: 'file.print' },

  { code: 'Tab', shift: false, command: 'tab.next' },
  { code: 'Tab', shift: true, command: 'tab.previous' },
  // The PageUp/PageDown pair does the same thing, for the hands that learned it
  // in a browser. One label is enough for both.
  { code: 'PageDown', shift: false, command: 'tab.next' },
  { code: 'PageUp', shift: false, command: 'tab.previous' },

  // Splitting right used to be Ctrl+Shift+R. Recording a macro is Notepad++'s
  // Ctrl+Shift+R and the hands of everyone who has ever used one go there
  // first, so the split moved one letter over rather than the other way round.
  { code: 'KeyE', shift: true, command: 'view.splitRight' },
  { code: 'KeyD', shift: true, command: 'view.splitDown' },
  { code: 'KeyQ', shift: true, command: 'view.closePane' },
  { code: 'KeyM', shift: true, command: 'view.moveTabToOtherPane' },
  { code: 'KeyB', shift: false, command: 'view.toggleSidebar' },
  { code: 'KeyC', shift: true, command: 'view.compare' },
  // VS Code's key for the same thing. It is also "paste as plain text" in a
  // browser — which the text fields of the app still need, and so does the
  // editor on a file without a preview: `actionFor` only takes the key when
  // the preview can actually toggle (see `YIELDING`).
  { code: 'KeyV', shift: true, command: 'markdown.togglePreview' },

  { code: 'KeyF', shift: false, command: 'find.find' },
  { code: 'KeyF', shift: true, command: 'find.inFiles' },
  { code: 'KeyH', shift: false, command: 'find.replace' },
  // Ctrl+G is go-to-line, as in Notepad++. CodeMirror's search keymap would
  // rather have it for "find next"; that lives on F3, where muscle memory
  // expects it anyway.
  { code: 'KeyG', shift: false, command: 'find.gotoLine' },

  { code: 'KeyR', shift: true, command: 'macro.toggleRecording' },
  // Notepad++ plays the last macro with Ctrl+Shift+P, which is the palette
  // here, so playback is on Y instead. One caveat, written down because it is
  // invisible from the code: on a German layout `KeyY` is the key printed Z,
  // and on Linux — only there — CodeMirror binds Ctrl+Shift+Z to redo. On
  // Windows, where redo is Ctrl+Y, this chord is free.
  { code: 'KeyY', shift: true, command: 'macro.playLast' },

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
  'file.print': [CTRL, 'P'],
  'tab.next': [CTRL, 'Tab'],
  'tab.previous': [CTRL, SHIFT, 'Tab'],
  'view.splitRight': [CTRL, SHIFT, 'E'],
  'view.splitDown': [CTRL, SHIFT, 'D'],
  'view.closePane': [CTRL, SHIFT, 'Q'],
  'view.nextPane': ['F6'],
  'view.zen': ['F11'],
  'view.moveTabToOtherPane': [CTRL, SHIFT, 'M'],
  'view.toggleSidebar': [CTRL, 'B'],
  'view.columns2': [CTRL, SHIFT, '2'],
  'view.columns3': [CTRL, SHIFT, '3'],
  'view.compare': [CTRL, SHIFT, 'C'],
  'view.nextDifference': ['F8'],
  'view.previousDifference': [SHIFT, 'F8'],
  'view.zoomIn': [CTRL, '+'],
  'view.zoomOut': [CTRL, '-'],
  'view.zoomReset': [CTRL, '0'],
  'markdown.togglePreview': [CTRL, SHIFT, 'V'],
  // Bound in the editor's own keymap (`editor/tasks.ts`), because it only
  // claims the key on a task line; listed here so the palette shows it.
  'markdown.toggleTask': [CTRL, 'Enter'],
  'bookmark.toggle': [CTRL, 'F2'],
  'bookmark.next': ['F2'],
  'bookmark.previous': [SHIFT, 'F2'],
  'find.find': [CTRL, 'F'],
  'find.replace': [CTRL, 'H'],
  'find.inFiles': [CTRL, SHIFT, 'F'],
  'find.gotoLine': [CTRL, 'G'],
  'macro.toggleRecording': [CTRL, SHIFT, 'R'],
  'macro.playLast': [CTRL, SHIFT, 'Y'],
  'app.palette': [CTRL, SHIFT, 'P'],
  'app.settings': [CTRL, ','],
};

/**
 * Bound commands that give their key back when they cannot run, or when the
 * focus is in one of the app's own text fields. Only those whose key means
 * something to the browser on its own: everywhere else a disabled command
 * swallowing its key is the quiet no-op it should be — Ctrl+W with nothing
 * open must not close the webview's page.
 */
const YIELDING: ReadonlySet<string> = new Set(['markdown.togglePreview']);

/** Input types a person types text into, where F2 and friends are editing keys. */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'url',
  'email',
  'password',
  'number',
  'tel',
]);

/**
 * Focus is in a text field of the app's own chrome — the find bar, a rename
 * box, the palette — rather than in the editor. CodeMirror's content is a
 * contenteditable too, and must keep every key this file gives it.
 */
export function inPlainTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('.cm-content')) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  return target.isContentEditable;
}

function renderKeys(keys: readonly string[]): string {
  return keys
    .map((key) => {
      if (key === CTRL) return t('Strg');
      if (key === SHIFT) return t('Umschalt');
      return key;
    })
    .join('+');
}

/**
 * A bound command's keys in the table's own spelling — {@link KEY_CTRL},
 * {@link KEY_SHIFT}, then the key — for the native macOS menu, which turns them
 * into accelerators (`lib/native-menu.ts`). `undefined` when nothing is bound.
 */
export function shortcutKeys(command: string): readonly string[] | undefined {
  return LABELS[command];
}

export const KEY_CTRL = CTRL;
export const KEY_SHIFT = SHIFT;

/**
 * Set while the native macOS menu is installed. That menu carries the function
 * keys of its entries (F2, F8, F11) as real accelerators, so the menu shows
 * them, and from then on the menu alone answers them: see the comment at the
 * top of `lib/native-menu.ts` for why the two must never both answer.
 */
let functionKeysNative = false;

export function setFunctionKeysNative(on: boolean): void {
  functionKeysNative = on;
}

/** `Strg+S`, in the current language. `undefined` when nothing is bound. */
export function shortcutLabel(command: string): string | undefined {
  const keys = LABELS[command];
  return keys ? renderKeys(keys) : undefined;
}

/* ── Keys a user gave to a macro ───────────────────────── */

/**
 * A macro's own key, written down.
 *
 * The format is `Ctrl+KeyM` or `Ctrl+Shift+KeyM`: always Ctrl (rule 1 above,
 * and it also keeps a macro from swallowing a plain letter), optionally Shift,
 * then a `KeyboardEvent.code` — the physical key, for the same reason
 * {@link BINDINGS} uses codes. It is stored in `uwunotes.macros` and therefore
 * read back from a file a person may have edited, so every function here
 * returns `null` rather than throwing on nonsense.
 *
 * The regular expressions are written inline rather than hoisted to module
 * constants on purpose: `lib/macros.ts` calls {@link normalizeMacroShortcut}
 * while *it* is being imported, and a module constant is not there yet at that
 * point. A literal inside the function body always is.
 */
type MacroKey = { shift: boolean; code: string };

function parseMacroShortcut(text: string): MacroKey | null {
  const parts = text
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const code = parts.pop();
  if (!code || !/^[A-Za-z][A-Za-z0-9]*$/.test(code)) return null;
  // A modifier on its own is a key that can never be pressed alone.
  if (/^(?:Control|Shift|Alt|Meta|OS)/.test(code)) return null;

  let ctrl = false;
  let shift = false;
  for (const part of parts) {
    if (part === 'Ctrl') ctrl = true;
    else if (part === 'Shift') shift = true;
    else return null;
  }
  return ctrl ? { shift, code } : null;
}

function writeMacroShortcut(key: MacroKey): string {
  return key.shift ? `Ctrl+Shift+${key.code}` : `Ctrl+${key.code}`;
}

/** The canonical spelling of a shortcut, or `null` when it is not one. */
export function normalizeMacroShortcut(text: string): string | null {
  const key = parseMacroShortcut(text);
  return key ? writeMacroShortcut(key) : null;
}

/** What the user just pressed, as a shortcut — or `null` if it cannot be one. */
export function macroShortcutFromEvent(event: KeyboardEvent): string | null {
  if (!event.ctrlKey || event.altKey || event.metaKey) return null;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(event.code)) return null;
  if (/^(?:Control|Shift|Alt|Meta|OS)/.test(event.code)) return null;
  return writeMacroShortcut({ shift: event.shiftKey, code: event.code });
}

/**
 * Whether the app already answers to this chord.
 *
 * {@link actionFor} looks at macros last, so a macro on Ctrl+S would simply
 * never run. Telling the user that while they are choosing the key is kinder
 * than letting them find out next week.
 */
export function macroShortcutTaken(shortcut: string): boolean {
  const key = parseMacroShortcut(shortcut);
  if (!key) return true;
  // The digits are zoom reset and the tab jumps, neither of which is in BINDINGS.
  if (/^(?:Digit|Numpad)\d$/.test(key.code)) return true;
  // Ctrl+F2 toggles a bookmark, and like F6 and F8 it is matched before
  // BINDINGS, so it is not in that list to be found.
  if (key.code === 'F2' && !key.shift) return true;
  // Zoom in and out are matched on the printed character, so their keys cannot
  // be named by code — which is the only thing a macro shortcut stores. Every
  // key that prints a `+` or a `-` on a layout this app runs under is therefore
  // spoken for: `Minus`/`Equal` on QWERTY, `Slash`/`BracketRight` on QWERTZ, and
  // the two numpad keys everywhere. Without this the dialog would happily hand
  // a macro a key that `actionFor` answers before it ever looks at macros, and
  // the macro would simply never run, with nothing on screen saying why.
  if (/^(?:Minus|Equal|Slash|BracketRight|Numpad(?:Add|Subtract))$/.test(key.code)) return true;
  return BINDINGS.some((entry) => entry.code === key.code && entry.shift === key.shift);
}

/** `Strg+Umschalt+M`, in the current language. */
export function macroShortcutText(shortcut: string): string {
  const key = parseMacroShortcut(shortcut);
  if (!key) return shortcut;
  return renderKeys(key.shift ? [CTRL, SHIFT, keyLabel(key.code)] : [CTRL, keyLabel(key.code)]);
}

/** `KeyM` is a fine thing to store and a terrible thing to show. */
function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
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

  // F8 walks the differences of a comparison, like WinMerge's Alt+Down but
  // without the Alt that AltGr would turn into a brace.
  if (
    event.code === 'F8' &&
    !functionKeysNative &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    const command = event.shiftKey ? 'view.previousDifference' : 'view.nextDifference';
    return () => runCommand(command);
  }

  // F11 is zen mode. It is the fullscreen key in every browser and in
  // Notepad++, and zen mode is fullscreen with the furniture taken out, so the
  // finger that knows one finds the other. No chord with Ctrl was free that
  // meant anything: Ctrl+Shift+Z is redo on Linux, and VS Code's Ctrl+K Z is a
  // two-step chord this listener does not do.
  if (
    event.code === 'F11' &&
    !functionKeysNative &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey
  ) {
    return () => runCommand('view.zen');
  }

  // Escape leaves zen mode — but only an Escape nobody else wanted. Every bar,
  // menu and dialog in the app handles its own Escape and prevents the default
  // (the modal ones even stop it in the capture phase), and CodeMirror does
  // the same when Escape closed its autocomplete or collapsed a multi-caret
  // selection. This listener runs last, on the way up, so a closed find bar
  // costs one Escape and leaving zen a second one, never both at once.
  if (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    zenActive()
  ) {
    return () => runCommand('view.zen');
  }

  // F2 and Shift+F2 walk the bookmarks, Ctrl+F2 sets one — Notepad++'s keys,
  // unchanged, because these are the ones its users reach for blind.
  // Ctrl+Shift+F2 is left to fall through to the macros. Not when somebody
  // else already answered it — F2 renames in the file tree — and not inside a
  // text field, where the editor's bookmarks are not what anybody meant.
  if (
    event.code === 'F2' &&
    !functionKeysNative &&
    !event.defaultPrevented &&
    !inPlainTextField(event.target) &&
    !event.altKey &&
    !event.metaKey &&
    !(event.ctrlKey && event.shiftKey)
  ) {
    const command = event.ctrlKey
      ? 'bookmark.toggle'
      : event.shiftKey
        ? 'bookmark.previous'
        : 'bookmark.next';
    return () => runCommand(command);
  }

  if (!event.ctrlKey || event.altKey || event.metaKey) return null;

  // Ctrl+Shift+2 and Ctrl+Shift+3: two or three files side by side. By code,
  // so the key printed 2 works whatever Shift turns it into on this layout.
  if (event.shiftKey && (event.code === 'Digit2' || event.code === 'Digit3')) {
    const command = event.code === 'Digit2' ? 'view.columns2' : 'view.columns3';
    return () => runCommand(command);
  }

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
  if (binding) {
    const { command } = binding;
    if (YIELDING.has(command) && (inPlainTextField(event.target) || !commandEnabled(command))) {
      return null;
    }
    return () => runCommand(command);
  }

  // Macros come last, so no macro a user saves can ever take a key away from
  // the app itself.
  const pressed = macroShortcutFromEvent(event);
  const macro = pressed ? macroWithShortcut(pressed) : undefined;
  if (macro) return () => void playMacro(macro.id);
  return null;
}
