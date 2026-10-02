/**
 * What the tab menu and the palette do with pinned and coloured tabs.
 *
 * The rules are in `lib/tabs.ts`, where they can be tested on strings; this is
 * the thin layer that applies them to the real stores and goes through
 * `closeDocsSafely` for anything that closes, so a bulk close puts every
 * unsaved file in the note trash and says so in one toast.
 */

import { getMeta, patchMeta, type DocId } from './documents';
import { closeDocsSafely } from './files';
import type { PaneId } from './layout';
import { tabsToClose, type CloseScope, type TabColor } from './tabs';
import { getWorkspace, paneOf, setTabPinned, tabsIn } from './workspace';

const isPinned = (doc: DocId) => getMeta(doc)?.pinned === true;

/** Closes a list of tabs; unsaved ones go to the note trash, nothing asks. */
export function closeEach(ids: readonly DocId[]): Promise<boolean> {
  return closeDocsSafely(ids);
}

/** "Alle/Andere/Rechts schließen" in one pane, pinned tabs excepted. */
export async function closeInPane(
  pane: PaneId,
  doc: DocId | null,
  scope: CloseScope,
): Promise<boolean> {
  return closeEach(tabsToClose(tabsIn(pane), doc, scope, isPinned));
}

/** The palette's "close all": every pane, pinned tabs excepted. */
export async function closeAllUnpinned(): Promise<boolean> {
  const ids = Object.values(getWorkspace().panes).flatMap((pane) =>
    tabsToClose(pane.tabs, null, 'all', isPinned),
  );
  return closeEach(ids);
}

/** Whether a bulk close of this scope would close anything at all. */
export function canCloseInPane(pane: PaneId, doc: DocId | null, scope: CloseScope): boolean {
  return tabsToClose(tabsIn(pane), doc, scope, isPinned).length > 0;
}

export function togglePinned(doc: DocId): void {
  if (!paneOf(doc)) return;
  setTabPinned(doc, !isPinned(doc));
}

export function setTabColor(doc: DocId, color: TabColor | null): void {
  patchMeta(doc, { color: color ?? undefined });
}
