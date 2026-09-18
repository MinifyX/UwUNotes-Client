/**
 * What the window is showing: which panes exist, which tabs are in them, which
 * folder is open.
 *
 * The documents themselves are in `lib/documents.ts` and the split tree is in
 * `lib/layout.ts`; this is the piece that ties the two together and the one
 * thing the UI subscribes to. It lives outside React for the same reason the
 * documents do — a command from the palette, a keyboard shortcut and a click
 * on a tab all have to change the same state, and none of them wants to reach
 * for a context provider first.
 *
 * Everything in here is the whole state at once, replaced immutably, so React
 * only needs one `useSyncExternalStore` to stay in step and the session file is
 * one `JSON.stringify` away.
 */

import { useSyncExternalStore } from 'react';
import type { DocId } from './documents';
import { closeDoc, getMeta } from './documents';
import {
  newPaneId,
  nextPane,
  paneIds,
  removePane,
  setRatio,
  singlePane,
  splitPane,
  type LayoutNode,
  type PaneId,
  type SplitDirection,
  type SplitPath,
} from './layout';

export type Pane = {
  /** Left to right, in the order the tab bar shows them. */
  tabs: DocId[];
  active: DocId | null;
};

export type Workspace = {
  layout: LayoutNode;
  panes: Record<PaneId, Pane>;
  activePane: PaneId;
  /** The project folder in the sidebar; `null` when only loose files are open. */
  folder: string | null;
  recentFiles: string[];
  recentFolders: string[];
};

const RECENT_LIMIT = 20;

function emptyWorkspace(): Workspace {
  const first = newPaneId();
  return {
    layout: singlePane(first),
    panes: { [first]: { tabs: [], active: null } },
    activePane: first,
    folder: null,
    recentFiles: [],
    recentFolders: [],
  };
}

let current = emptyWorkspace();
const listeners = new Set<() => void>();

function commit(next: Workspace) {
  current = next;
  for (const listener of listeners) listener();
}

export function getWorkspace(): Workspace {
  return current;
}

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspace(): Workspace {
  return useSyncExternalStore(subscribeWorkspace, getWorkspace);
}

/** Straight from the session loader, which builds the whole thing at once. */
export function replaceWorkspace(next: Workspace) {
  commit(next);
}

export function resetWorkspace() {
  commit(emptyWorkspace());
}

export function getPane(id: PaneId): Pane | undefined {
  return current.panes[id];
}

export function activeDocId(): DocId | null {
  return current.panes[current.activePane]?.active ?? null;
}

/** Which pane a document is in, if any. A document is only ever in one. */
export function paneOf(doc: DocId): PaneId | null {
  for (const [id, pane] of Object.entries(current.panes)) {
    if (pane.tabs.includes(doc)) return id;
  }
  return null;
}

/* ── Tabs ──────────────────────────────────────────────── */

/**
 * Shows `doc` in a pane, adding it to the tab bar if it is not there yet.
 * A document already open somewhere is revealed where it is rather than
 * opened twice — a file has one editor, or its undo history would fork.
 */
export function showDoc(doc: DocId, pane: PaneId = current.activePane) {
  const existing = paneOf(doc);
  if (existing) {
    commit({
      ...current,
      activePane: existing,
      panes: { ...current.panes, [existing]: { ...current.panes[existing]!, active: doc } },
    });
    return;
  }
  const target = current.panes[pane] ?? current.panes[current.activePane]!;
  const targetId = current.panes[pane] ? pane : current.activePane;
  commit({
    ...current,
    activePane: targetId,
    panes: { ...current.panes, [targetId]: { tabs: [...target.tabs, doc], active: doc } },
  });
}

/** Opens `doc` right after the active tab, the way a middle-click would. */
export function showDocNext(doc: DocId, pane: PaneId = current.activePane) {
  if (paneOf(doc)) return showDoc(doc, pane);
  const target = current.panes[pane];
  if (!target) return showDoc(doc, current.activePane);
  const at = target.active ? target.tabs.indexOf(target.active) + 1 : target.tabs.length;
  const tabs = [...target.tabs.slice(0, at), doc, ...target.tabs.slice(at)];
  commit({
    ...current,
    activePane: pane,
    panes: { ...current.panes, [pane]: { tabs, active: doc } },
  });
}

/**
 * Takes a tab out of its pane and closes the document.
 *
 * Whoever calls this has already dealt with unsaved changes — the guard lives
 * in `lib/files.ts`, where it can offer to save, because a store that could
 * open a dialog would be a store that cannot be tested.
 */
export function closeTab(doc: DocId) {
  const pane = paneOf(doc);
  if (!pane) return;
  const found = current.panes[pane]!;
  const index = found.tabs.indexOf(doc);
  const tabs = found.tabs.filter((id) => id !== doc);
  // The tab to the right takes over, or the one to the left at the end —
  // what every editor does, and the only thing that does not feel random.
  const active =
    found.active === doc ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : found.active;
  const panes = { ...current.panes, [pane]: { tabs, active } };
  const next = { ...current, panes };
  // An empty pane that is not the last one goes away with its tab.
  commit(tabs.length === 0 && paneIds(current.layout).length > 1 ? dropPane(next, pane) : next);
  closeDoc(doc);
}

/** Every tab in a pane, for "close all" and for closing a whole pane. */
export function tabsIn(pane: PaneId): DocId[] {
  return current.panes[pane]?.tabs ?? [];
}

export function activateDoc(doc: DocId) {
  const pane = paneOf(doc);
  if (!pane) return;
  commit({
    ...current,
    activePane: pane,
    panes: { ...current.panes, [pane]: { ...current.panes[pane]!, active: doc } },
  });
}

/** Ctrl+Tab: the next tab in the active pane, wrapping around. */
export function cycleTab(back = false) {
  const pane = current.panes[current.activePane];
  if (!pane || pane.tabs.length < 2 || !pane.active) return;
  const index = pane.tabs.indexOf(pane.active);
  const step = back ? -1 : 1;
  const next = pane.tabs[(index + step + pane.tabs.length) % pane.tabs.length];
  if (next) activateDoc(next);
}

/** Ctrl+Shift+1…9. Nothing happens when that tab does not exist. */
export function activateTabAt(index: number) {
  const doc = current.panes[current.activePane]?.tabs[index];
  if (doc) activateDoc(doc);
}

/** Dragging a tab within its bar. */
export function reorderTab(doc: DocId, toIndex: number) {
  const pane = paneOf(doc);
  if (!pane) return;
  const found = current.panes[pane]!;
  const without = found.tabs.filter((id) => id !== doc);
  const at = Math.max(0, Math.min(without.length, toIndex));
  commit({
    ...current,
    panes: {
      ...current.panes,
      [pane]: { ...found, tabs: [...without.slice(0, at), doc, ...without.slice(at)] },
    },
  });
}

/* ── Panes ─────────────────────────────────────────────── */

/** Removes a pane from the tree and from `panes`, keeping the two in step. */
function dropPane(workspace: Workspace, pane: PaneId): Workspace {
  const layout = removePane(workspace.layout, pane);
  if (!layout) return workspace; // the last pane stays, empty
  const panes = { ...workspace.panes };
  delete panes[pane];
  const activePane =
    workspace.activePane === pane ? (paneIds(layout)[0] ?? pane) : workspace.activePane;
  return { ...workspace, layout, panes, activePane };
}

/**
 * Splits the active pane and moves the active tab into the new half — which is
 * what "open this next to that" means, and saves a drag every single time.
 * With only one tab open the document moves across, leaving an empty pane
 * behind rather than duplicating the editor.
 */
export function splitActivePane(direction: SplitDirection, moveActiveTab = true) {
  const source = current.activePane;
  const pane = current.panes[source];
  if (!pane) return;
  const created = newPaneId();
  const layout = splitPane(current.layout, source, direction, created);
  const moving = moveActiveTab ? pane.active : null;
  const rest = moving ? pane.tabs.filter((id) => id !== moving) : pane.tabs;
  const stillActive = pane.active === moving ? (rest[rest.length - 1] ?? null) : pane.active;
  commit({
    ...current,
    layout,
    panes: {
      ...current.panes,
      [source]: { tabs: rest, active: stillActive },
      [created]: { tabs: moving ? [moving] : [], active: moving },
    },
    activePane: created,
  });
}

/** Closes a pane, moving whatever was open in it into the pane that remains. */
export function closePane(pane: PaneId) {
  if (paneIds(current.layout).length < 2) return;
  const closing = current.panes[pane];
  if (!closing) return;
  const survivor = paneIds(current.layout).find((id) => id !== pane);
  if (!survivor) return;
  const target = current.panes[survivor]!;
  const moved = { ...current, panes: { ...current.panes } };
  moved.panes[survivor] = {
    tabs: [...target.tabs, ...closing.tabs],
    active: target.active ?? closing.active,
  };
  commit(dropPane(moved, pane));
}

export function focusPane(pane: PaneId) {
  if (!current.panes[pane] || pane === current.activePane) return;
  commit({ ...current, activePane: pane });
}

/** F6 and Ctrl+Shift+Arrow: hop to the next pane in reading order. */
export function cyclePane(back = false) {
  focusPane(nextPane(current.layout, current.activePane, back));
}

/** Moves a tab into another pane — Notepad++'s "move to other view". */
export function moveTabToPane(doc: DocId, target: PaneId) {
  const source = paneOf(doc);
  if (!source || source === target || !current.panes[target]) return;
  const from = current.panes[source]!;
  const to = current.panes[target]!;
  const index = from.tabs.indexOf(doc);
  const tabs = from.tabs.filter((id) => id !== doc);
  const next: Workspace = {
    ...current,
    activePane: target,
    panes: {
      ...current.panes,
      [source]: {
        tabs,
        active:
          from.active === doc ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : from.active,
      },
      [target]: { tabs: [...to.tabs, doc], active: doc },
    },
  };
  commit(tabs.length === 0 && paneIds(current.layout).length > 1 ? dropPane(next, source) : next);
}

/** Dragging a divider. `path` says which one; see `lib/layout.ts`. */
export function resizeSplit(path: SplitPath, ratio: number) {
  commit({ ...current, layout: setRatio(current.layout, path, ratio) });
}

/* ── Folder and recents ────────────────────────────────── */

export function setFolder(folder: string | null) {
  const recentFolders = folder
    ? [folder, ...current.recentFolders.filter((f) => f !== folder)].slice(0, RECENT_LIMIT)
    : current.recentFolders;
  commit({ ...current, folder, recentFolders });
}

export function rememberFile(path: string) {
  commit({
    ...current,
    recentFiles: [path, ...current.recentFiles.filter((f) => f !== path)].slice(0, RECENT_LIMIT),
  });
}

export function forgetRecents() {
  commit({ ...current, recentFiles: [], recentFolders: [] });
}

/** The window title: the active file, then the folder, then the app. */
export function windowTitle(): string {
  const doc = activeDocId();
  const meta = doc ? getMeta(doc) : undefined;
  const name = meta ? `${meta.dirty ? '• ' : ''}${meta.name}` : null;
  const folder = current.folder?.split(/[\\/]/).filter(Boolean).pop() ?? null;
  return [name, folder, 'UwUNotes'].filter(Boolean).join(' — ');
}
