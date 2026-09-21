/**
 * Which CodeMirror view is currently showing in which pane.
 *
 * A pane renders exactly one editor at a time. Commands that have to act on the
 * text the user is looking at — go to line, find, the trim-on-save fixups —
 * need a handle on that editor without going through React first, so the pane
 * component registers its view on mount and drops it on unmount.
 *
 * It deliberately does NOT know anything about documents. A view is a window
 * onto a `Doc` in `lib/documents.ts`; asking this module which file is open
 * would be asking the wrong one.
 */

import type { EditorView } from '@codemirror/view';
import type { PaneId } from './layout';
import { getWorkspace } from './workspace';

const views = new Map<PaneId, EditorView>();

/** Returns the teardown the pane component calls from its effect cleanup. */
export function registerView(pane: PaneId, view: EditorView): () => void {
  views.set(pane, view);
  return () => {
    // Only unregister if the entry is still ours. React can mount a pane's
    // replacement editor before unmounting the old one, and the newcomer must
    // not be deleted by the departing view's cleanup.
    if (views.get(pane) === view) views.delete(pane);
  };
}

export function viewFor(pane: PaneId): EditorView | undefined {
  return views.get(pane);
}

/** Every mounted editor, for things that change how all of them draw. */
export function allViews(): EditorView[] {
  return [...views.values()];
}

export function activeView(): EditorView | undefined {
  return views.get(getWorkspace().activePane);
}

/**
 * Puts the caret back in the editor.
 *
 * Every dialog in the app steals focus while it is open; without this, closing
 * the command palette leaves the keyboard pointing at nothing and the next
 * keystroke goes nowhere.
 */
export function focusActiveView(): void {
  activeView()?.focus();
}
