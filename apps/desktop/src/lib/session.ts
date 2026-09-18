/**
 * Putting the window back the way it was: which files, in which panes, with the
 * caret where it was left.
 *
 * The session file is JSON on the user's disk written by an earlier version of
 * this app, so nothing in it is trusted. Every value is checked, a file that has
 * since been deleted becomes one toast and a missing tab rather than a crash,
 * and a version number this build does not recognise is ignored outright — a
 * half-understood session is worse than a fresh window.
 *
 * Unsaved text lives in drafts next to the session (`writeDraft` in
 * `lib/api.ts`), so closing the app with a scratch buffer full of notes costs
 * nothing. Documents that are clean get their draft dropped, because a stale
 * draft is a copy of a file that quietly disagrees with the file.
 *
 * This module does NOT own preferences. Those are `lib/settings.ts` and they
 * live in the page's own storage.
 */

import {
  asApiError,
  dropDraft,
  loadSession,
  readDraft,
  readTextFile,
  saveSession,
  writeDraft,
  type FileStamp,
  type SessionDocument,
  type StoredSession,
} from './api';
import {
  allDocs,
  clearDocuments,
  getDoc,
  openDoc,
  openLoadedFile,
  patchMeta,
  seedUntitledCounter,
  setDocState,
  subscribeDocuments,
  type DocId,
} from './documents';
import { describeApiError, newFile } from './files';
import { t } from './i18n';
import { newPaneId, paneIds, sanitizeLayout, type LayoutNode, type PaneId } from './layout';
import { getSettings } from './settings';
import { toast } from './toast';
import { viewFor } from './views';
import {
  getPane,
  getWorkspace,
  paneOf,
  replaceWorkspace,
  resetWorkspace,
  subscribeWorkspace,
  type Pane,
} from './workspace';

/** Bumped when the shape changes. An older or newer file is dropped, not guessed at. */
const SESSION_VERSION = 1;

/* ── Restoring ─────────────────────────────────────────── */

/** The one restore, kept so a second caller waits on it instead of starting another. */
let restoring: Promise<void> | null = null;

/**
 * Whether the drafts on disk are accounted for by the documents in the window.
 *
 * Only a restore that actually rebuilt from a stored session can say yes. Every
 * other way this module ends up with a window — the "restore my tabs" setting
 * switched off, a session from a version this build does not know, a session
 * file that would not read, a draft that came back as an error — leaves it
 * false, because then the one empty buffer on screen is not a list of what to
 * keep. `saveSession` passes it on, and `prune_drafts` in Rust refuses while it
 * is false. Starting false means the answer is no until something proves
 * otherwise, including if the restore throws halfway.
 */
let pruneAllowed = false;

/**
 * A draft existed and would not read during this restore.
 *
 * Which is not the same as there being no draft: the document gets dropped
 * either way, but only in this case does dropping it mean the next save would
 * collect text that was merely briefly unreadable.
 */
let draftUnreadable = false;

/**
 * Rebuilds the last window, or opens one empty buffer.
 *
 * Idempotent on purpose. `App` starts this from an effect, and React's
 * StrictMode runs an effect twice in development — a second restore would deal
 * a second set of tabs on top of the first, which is how an empty start-up ends
 * up showing `Neu 1` and `Neu 2` side by side. Handing every caller the same
 * promise also means the start-up screen waits for the real thing rather than
 * for a race between two of them.
 */
export function restoreSession(): Promise<void> {
  restoring ??= restoreOnce();
  return restoring;
}

async function restoreOnce(): Promise<void> {
  pruneAllowed = false;
  draftUnreadable = false;

  if (!getSettings().restoreSession) {
    newFile();
    return;
  }

  const stored = await loadSession().catch(() => null);
  if (!stored || stored.version !== SESSION_VERSION) {
    newFile();
    return;
  }

  clearDocuments();
  resetWorkspace();

  // Stored id -> the id the document actually got. They are usually the same,
  // but a document that failed to come back has no entry at all, which is how
  // the pane rebuild below drops its tab.
  const restored = new Map<string, DocId>();
  let highestUntitled = 0;

  for (const raw of Array.isArray(stored.documents) ? stored.documents : []) {
    const entry = sanitizeDocument(raw);
    if (!entry) continue;
    const id = await restoreDocument(entry);
    if (!id) continue;
    restored.set(entry.docId, id);
    placeCaret(id, entry.cursor, entry.scrollTop);
    const untitled = /^Neu (\d+)$/.exec(entry.name);
    if (untitled?.[1]) highestUntitled = Math.max(highestUntitled, Number(untitled[1]));
  }
  // Otherwise the next new file would be `Neu 1` again, next to the `Neu 1`
  // that just came back.
  seedUntitledCounter(highestUntitled);

  if (!rebuildWorkspace(stored, restored)) {
    resetWorkspace();
    newFile();
    return;
  }

  if (restored.size === 0) newFile();
  else applyRestoredScroll();

  // Set last, and only here: this is the one path that rebuilt the window from
  // a stored session, so it is the only one that knows what the drafts on disk
  // belong to. Every other way out of this function has already returned with
  // the flag still false.
  pruneAllowed = !draftUnreadable && restored.size > 0;
}

/** One document, from its draft when it was dirty and from disk otherwise. */
async function restoreDocument(entry: SessionDocument): Promise<DocId | null> {
  if (entry.dirty) {
    let draft: string | null = null;
    try {
      draft = await readDraft(entry.docId);
    } catch {
      // The draft is there and would not read — a virus scanner holding the
      // file, a disk hiccup. Dropping the document is what would let the next
      // save collect text that was only briefly unreadable, so this whole run
      // sweeps up nothing at all.
      draftUnreadable = true;
      toast(
        'error',
        t('Eine ungespeicherte Notiz ließ sich nicht laden: {name}', {
          name: entry.name,
        }),
      );
      return null;
    }
    if (draft !== null) {
      return openDoc({
        id: entry.docId,
        path: entry.path,
        name: entry.name,
        text: draft,
        encoding: entry.encoding,
        bom: entry.bom,
        eol: entry.eol,
        languageOverride: entry.language,
        stamp: entry.stamp,
        dirty: true,
      });
    }
    // The draft is gone. For a file on disk that means losing the edits, which
    // is bad; for a buffer that was never saved it means losing everything,
    // and an empty tab named `Neu 3` is not worth restoring.
    if (!entry.path) return null;
  }

  if (!entry.path) {
    return openDoc({
      id: entry.docId,
      path: null,
      name: entry.name,
      text: '',
      encoding: entry.encoding,
      bom: entry.bom,
      eol: entry.eol,
      languageOverride: entry.language,
    });
  }

  try {
    const file = await readTextFile(entry.path);
    const id = openLoadedFile(file, entry.name, entry.docId);
    if (entry.language) patchMeta(id, { languageOverride: entry.language });
    return id;
  } catch (error) {
    toast('error', describeApiError(asApiError(error), entry.path));
    return null;
  }
}

/**
 * Puts the panes and the split tree back.
 *
 * Pane ids are minted fresh rather than reused: `newPaneId()` counts up from
 * zero in every run, so restoring `pane-2` and then splitting would hand out a
 * second `pane-2` and two halves of the window would share a tab bar.
 *
 * Returns `false` when there is nothing usable left and the caller should start
 * over with an empty window.
 */
function rebuildWorkspace(stored: StoredSession, restored: Map<string, DocId>): boolean {
  const storedPanes: Record<string, unknown> =
    typeof stored.panes === 'object' && stored.panes !== null
      ? (stored.panes as Record<string, unknown>)
      : {};

  const rename = new Map<PaneId, PaneId>();
  const panes: Record<PaneId, Pane> = {};
  for (const [storedId, raw] of Object.entries(storedPanes)) {
    const storedPane = (typeof raw === 'object' && raw !== null ? raw : {}) as {
      tabs?: unknown;
      active?: unknown;
    };
    const fresh = newPaneId();
    rename.set(storedId, fresh);
    const tabs = (Array.isArray(storedPane.tabs) ? storedPane.tabs : [])
      .map((docId: unknown) => (typeof docId === 'string' ? restored.get(docId) : undefined))
      .filter((docId): docId is DocId => docId !== undefined);
    const active =
      typeof storedPane.active === 'string' ? restored.get(storedPane.active) : undefined;
    panes[fresh] = { tabs, active: active ?? tabs[tabs.length - 1] ?? null };
  }

  const layout = sanitizeLayout(stored.layout, new Set(rename.keys()));
  if (!layout) return false;
  const live = renamePanes(layout, rename);
  const liveIds = new Set(paneIds(live));

  // A pane the layout no longer mentions still has tabs in it. They go to the
  // first surviving pane: losing a split is a nuisance, losing a file is not.
  const homeless: DocId[] = [];
  for (const id of Object.keys(panes)) {
    if (liveIds.has(id)) continue;
    homeless.push(...(panes[id]?.tabs ?? []));
    delete panes[id];
  }
  const firstId = paneIds(live)[0];
  const first = firstId ? panes[firstId] : undefined;
  if (!firstId || !first) return false;
  if (homeless.length > 0) {
    panes[firstId] = {
      tabs: [...first.tabs, ...homeless],
      active: first.active ?? homeless[homeless.length - 1] ?? null,
    };
  }

  const storedActive =
    typeof stored.activePane === 'string' ? rename.get(stored.activePane) : undefined;
  replaceWorkspace({
    layout: live,
    panes,
    activePane: storedActive && liveIds.has(storedActive) ? storedActive : firstId,
    folder: typeof stored.folder === 'string' ? stored.folder : null,
    recentFiles: stringList(stored.recentFiles),
    recentFolders: stringList(stored.recentFolders),
  });
  return true;
}

function renamePanes(node: LayoutNode, rename: Map<PaneId, PaneId>): LayoutNode {
  if (node.kind === 'pane') return { kind: 'pane', id: rename.get(node.id) ?? node.id };
  return {
    ...node,
    first: renamePanes(node.first, rename),
    second: renamePanes(node.second, rename),
  };
}

/* ── Caret and scroll ──────────────────────────────────── */

/** Scroll offsets waiting for an editor to exist; see {@link applyRestoredScroll}. */
const pendingScroll = new Map<DocId, number>();

/**
 * The selection goes straight into the `EditorState`, so whichever editor is
 * built from it later already has the caret in the right place. The scroll
 * offset cannot: it is a property of a DOM element that does not exist yet.
 */
function placeCaret(id: DocId, cursor: number, scrollTop: number) {
  const doc = getDoc(id);
  if (!doc) return;
  const at = Math.max(0, Math.min(Math.round(cursor), doc.state.doc.length));
  setDocState(id, doc.state.update({ selection: { anchor: at } }).state);
  if (scrollTop > 0) pendingScroll.set(id, scrollTop);
}

/**
 * Scrolls the restored editors once React has mounted them.
 *
 * Two frames: one for the mount, one for CodeMirror to measure itself. Anything
 * still unclaimed after that is left for {@link takeRestoredScroll}, which the
 * editor pane calls when it registers a view that arrived late.
 */
function applyRestoredScroll() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      for (const [id, scrollTop] of [...pendingScroll]) {
        const pane = paneOf(id);
        if (!pane || getPane(pane)?.active !== id) continue;
        const view = viewFor(pane);
        if (!view) continue;
        view.scrollDOM.scrollTop = scrollTop;
        pendingScroll.delete(id);
      }
    });
  });
}

/** Consumes the restored scroll offset for a document, if there is one left. */
export function takeRestoredScroll(id: DocId): number | null {
  const scrollTop = pendingScroll.get(id);
  if (scrollTop === undefined) return null;
  pendingScroll.delete(id);
  return scrollTop;
}

/* ── Persisting ────────────────────────────────────────── */

/** Writes the session and the drafts. Safe to call as often as you like. */
export async function persistSession(): Promise<void> {
  const workspace = getWorkspace();
  const documents: SessionDocument[] = [];

  for (const doc of allDocs()) {
    const meta = doc.meta;
    documents.push({
      docId: meta.id,
      path: meta.path,
      name: meta.name,
      encoding: meta.encoding,
      bom: meta.bom,
      eol: meta.eol,
      language: meta.languageOverride,
      cursor: doc.state.selection.main.head,
      scrollTop: scrollTopOf(meta.id),
      dirty: meta.dirty,
      stamp: meta.stamp,
    });
    try {
      if (meta.dirty) await writeDraft(meta.id, doc.state.doc.toString());
      else await dropDraft(meta.id);
    } catch {
      // A draft that cannot be written is not worth failing the whole session
      // over — the tab list is still worth having.
    }
  }

  const panes: Record<string, { tabs: string[]; active: string | null }> = {};
  for (const [id, pane] of Object.entries(workspace.panes)) {
    panes[id] = { tabs: [...pane.tabs], active: pane.active };
  }

  const session: StoredSession = {
    version: SESSION_VERSION,
    documents,
    layout: workspace.layout,
    panes,
    activePane: workspace.activePane,
    folder: workspace.folder,
    recentFiles: [...workspace.recentFiles],
    recentFolders: [...workspace.recentFolders],
  };
  await saveSession(session, pruneAllowed).catch(() => undefined);
}

/**
 * Only the visible tab in each pane has an editor, so only it has a real scroll
 * offset. A background tab restores to the top, which is where its caret will
 * put it anyway.
 */
function scrollTopOf(id: DocId): number {
  const pane = paneOf(id);
  if (!pane || getPane(pane)?.active !== id) return pendingScroll.get(id) ?? 0;
  return viewFor(pane)?.scrollDOM.scrollTop ?? 0;
}

/* ── Autosave ──────────────────────────────────────────── */

/** Long enough that opening ten files is one write, short enough to survive a crash. */
const DEBOUNCE_MS = 1_500;

/**
 * Typing does not announce — `subscribeDocuments` fires on metadata, and the
 * dirty flag only flips once — so drafts are also flushed on a plain clock.
 */
const DRAFT_INTERVAL_MS = 20_000;

/** Persists after changes and on the way out. Returns the teardown. */
export function startSessionAutosave(): () => void {
  let debounce = 0;
  const schedule = () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      void persistSession();
    }, DEBOUNCE_MS);
  };

  const stopDocuments = subscribeDocuments(schedule);
  const stopWorkspace = subscribeWorkspace(schedule);

  const interval = window.setInterval(() => {
    if (allDocs().some((doc) => doc.meta.dirty)) void persistSession();
  }, DRAFT_INTERVAL_MS);

  const onUnload = () => {
    void persistSession();
  };
  window.addEventListener('beforeunload', onUnload);

  return () => {
    window.clearTimeout(debounce);
    window.clearInterval(interval);
    window.removeEventListener('beforeunload', onUnload);
    stopDocuments();
    stopWorkspace();
  };
}

/* ── Reading a file nobody promised was well formed ────── */

function sanitizeDocument(raw: unknown): SessionDocument | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.docId !== 'string' || typeof entry.name !== 'string') return null;
  const settings = getSettings();
  return {
    docId: entry.docId,
    path: typeof entry.path === 'string' ? entry.path : null,
    name: entry.name,
    encoding: typeof entry.encoding === 'string' ? entry.encoding : settings.defaultEncoding,
    bom: entry.bom === true,
    eol:
      entry.eol === 'crlf' || entry.eol === 'cr' || entry.eol === 'lf'
        ? entry.eol
        : settings.defaultEol,
    language: typeof entry.language === 'string' ? entry.language : null,
    cursor: finite(entry.cursor),
    scrollTop: finite(entry.scrollTop),
    dirty: entry.dirty === true,
    stamp: sanitizeStamp(entry.stamp),
  };
}

function sanitizeStamp(raw: unknown): FileStamp | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const stamp = raw as Record<string, unknown>;
  return {
    mtimeMs: finite(stamp.mtimeMs),
    size: finite(stamp.size),
    readOnly: stamp.readOnly === true,
  };
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string').slice(0, 50);
}
