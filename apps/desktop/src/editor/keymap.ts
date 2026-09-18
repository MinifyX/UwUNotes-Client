/**
 * The keys the editor itself answers to.
 *
 * Only keys that act on text live here: moving the caret, folding, undo,
 * completion. Anything that acts on the *app* — save, new tab, switch pane,
 * command palette — belongs to `lib/shortcuts.ts`, which listens on the window
 * and can therefore work while the focus is in the sidebar.
 *
 * Order is precedence. `closeBracketsKeymap` and `completionKeymap` come
 * first so that Backspace deletes both halves of a bracket pair and Enter
 * accepts a completion instead of breaking the line. Anything the app wants to
 * take back — Ctrl+F, if `lib/find.ts` ships its own panel — can be bound at
 * `Prec.high` from outside and will win over everything below.
 */

import { acceptCompletion, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { foldKeymap } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';

/**
 * Tab indents, and that is a deliberate accessibility trade.
 *
 * `indentWithTab` traps Tab inside the editor: a keyboard-only user can no
 * longer tab out to the next control, which is exactly the behaviour WCAG
 * 2.1.2 ("No Keyboard Trap") exists to forbid — unless there is a documented
 * way out. Ours is Escape: it un-traps the editor, and the next Tab moves
 * focus normally. That escape hatch is built into `indentWithTab` itself, it
 * is in the shortcut list, and it is the reason we can ship this at all.
 *
 * The alternative — Tab always moves focus — is what CodeMirror does by
 * default and what an editor must not do: a text editor where Tab does not
 * indent fails the first thirty seconds of use.
 */
const tabIndent = [indentWithTab];

export const editorKeymap: Extension = keymap.of([
  ...closeBracketsKeymap,
  ...completionKeymap,
  // Tab completes when a completion popup is open, and only then falls through
  // to indenting. Without this the popup is unreachable from the keyboard for
  // anyone who expects Tab to take the highlighted suggestion.
  { key: 'Tab', run: acceptCompletion },
  ...tabIndent,
  ...searchKeymap,
  ...historyKeymap,
  ...foldKeymap,
  ...defaultKeymap,
]);
