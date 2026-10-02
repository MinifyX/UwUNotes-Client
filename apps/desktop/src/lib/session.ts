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
 * nothing — the window closes without a single question and the next start
 * carries on where this one stopped ("hot exit"). Drafts are flushed a moment
 * after the typing, not only on the way out, so a crash or a killed process
 * loses a second of text at most. Documents that are clean get their draft
 * dropped, because a stale draft is a copy of a file that quietly disagrees
 * with the file.
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
  nextUntitledNumber,
  openDoc,
  openLoadedFile,
  patchMeta,
  seedUntitledCounter,
  setDocState,
  subscribeDocuments,
  subscribeText,
  type DocId,
} from './documents';
import { bookmarksForSession, restoreBookmarks, sanitizeBookmarkLines } from './bookmarks';
import { describeApiError, newFile } from './files';
import { sanitizeTabColor } from './tabs';
import { t } from './i18n';
import { newPaneId, paneIds, sanitizeLayout, type LayoutNode, type PaneId } from './layout';
import { previewForSession, setPreviewOpen } from './preview';
import { emitNyu } from './nyu-events';
import { getSettings } from './settings';
import { toast } from './toast';
import { viewFor } from './views';
import {
  getPane,
  getWorkspace,
  paneOf,
  replaceWorkspace,
  resetWorkspace,
  showDoc,
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

/** How many documents came back from a draft, for the toast after the restore. */
let draftsRestored = 0;

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
  draftsRestored = 0;

  // With "restore the session" switched off the clean files, the splits and
  // the folder stay closed — but unsaved text still comes back. Closing never
  // asks any more, so a setting about tab layout must not be what quietly
  // throws a note away at the next start.
  const fullRestore = getSettings().restoreSession;

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

  const entries = (Array.isArray(stored.documents) ? stored.documents : [])
    .map(sanitizeDocument)
    .filter((entry): entry is SessionDocument => entry !== null);

  // Every number first, then the documents: a document from a session older
  // than the `untitled` field gets a fresh number below, and that must not be
  // one a later entry in the list still holds.
  for (const entry of entries) {
    if (entry.untitled) highestUntitled = Math.max(highestUntitled, entry.untitled);
  }
  // Otherwise the next new file would be `Neu 1` again, next to the `Neu 1`
  // that just came back.
  seedUntitledCounter(highestUntitled);

  for (const entry of entries) {
    // Without the full restore only unsaved text comes back. A dirty entry is
    // exactly one that has a draft; a clean one has nothing to lose.
    if (!fullRestore && !entry.dirty) continue;
    if (!entry.path && !entry.untitled) entry.untitled = nextUntitledNumber();
    const id = await restoreDocument(entry, fullRestore);
    if (!id) continue;
    restored.set(entry.docId, id);
    // Before the panes are rebuilt below, so the workspace sees the pins when
    // it orders the tabs.
    if (entry.pinned || entry.color) {
      patchMeta(id, { pinned: entry.pinned, color: sanitizeTabColor(entry.color) });
    }
    restoreBookmarks(id, entry.bookmarks);
    if (entry.preview) setPreviewOpen(id, true);
    placeCaret(id, entry.cursor, entry.scrollTop);
  }

  if (fullRestore) {
    if (!rebuildWorkspace(stored, restored)) {
      resetWorkspace();
      newFile();
      return;
    }
  } else {
    // One pane with the notes in it, in the order they were listed. The rest
    // of the stored window — splits, folder, recent lists — is what the
    // switched-off setting asked not to bring back.
    for (const id of restored.values()) showDoc(id);
  }

  if (restored.size === 0) newFile();
  else {
    applyRestoredScroll();
    emitNyu('session-restored', { count: restored.size });
  }

  announceDrafts();

  // Set last, and only here: these are the paths that rebuilt documents from a
  // stored session, so they are the only ones that know what the drafts on
  // disk belong to. Every other way out of this function has already returned
  // with the flag still false.
  //
  // The reduced restore counts too. A draft only ever belongs to a document
  // the session marks dirty, and every one of those was brought back above or
  // set `draftUnreadable` trying — so the open documents account for every
  // draft the session names, which is the whole condition for the sweep. The
  // clean documents it skipped never had a draft to lose.
  pruneAllowed = !draftUnreadable && restored.size > 0;
}

/**
 * Says that unsaved text came back. Only when some did: a window of clean
 * files coming back is what everybody expects, and needs no announcement.
 */
function announceDrafts() {
  const count = draftsRestored;
  if (count === 0) return;
  const playful = getSettings().tone === 'playful';
  let text: string;
  if (count === 1) {
    text = playful
      ? t('Hab deinen Entwurf aufgehoben (๑˃ᴗ˂)ﻭ')
      : t('1 nicht gespeicherte Datei zurück');
  } else {
    text = playful
      ? t('Hab deine {count} Entwürfe aufgehoben (๑˃ᴗ˂)ﻭ', { count })
      : t('{count} nicht gespeicherte Dateien zurück', { count });
  }
  toast('success', text);
}

/**
 * One document, from its draft when it was dirty and from disk otherwise.
 *
 * `fullRestore` false is the restore setting switched off: only drafts come
 * back, and a dirty file whose draft is missing is not reopened from disk.
 */
async function restoreDocument(
  entry: SessionDocument,
  fullRestore: boolean,
): Promise<DocId | null> {
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
      draftsRestored += 1;
      return openDoc({
        id: entry.docId,
        path: entry.path,
        name: entry.name,
        untitled: entry.untitled,
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
    if (!entry.path || !fullRestore) return null;
  }

  if (!entry.path) {
    return openDoc({
      id: entry.docId,
      path: null,
      name: entry.name,
      untitled: entry.untitled,
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

/** The run in progress, and the one queued behind it. */
let persisting: Promise<boolean> | null = null;
let queued: Promise<boolean> | null = null;

/**
 * Writes the session and the drafts. Safe to call as often as you like.
 *
 * Resolves `true` when everything reached the disk — the window's close
 * handler destroys the window on that and only asks when it is `false`.
 *
 * One run at a time. Two overlapping runs could finish their draft writes in
 * either order and leave the older text on disk; so a call that arrives while
 * a run is going waits for it and then runs once more, and every call that
 * arrives in the meantime shares that one follow-up run.
 */
export function persistSession(): Promise<boolean> {
  if (persisting) {
    queued ??= persisting
      .catch(() => false)
      .then(() => {
        queued = null;
        return persistSession();
      });
    return queued;
  }
  const run = persistOnce().finally(() => {
    persisting = null;
  });
  persisting = run;
  return run;
}

/**
 * The `textVersion` of each document whose draft is on disk, or {@link NO_DRAFT}
 * once its draft is known to be gone.
 *
 * So a flush writes only the drafts whose text changed since the last one and
 * drops a clean document's draft once instead of on every save. A document
 * missing from the map is unknown and gets written (or dropped) on the next
 * run — which is what happens to everything after a restart.
 */
const draftsOnDisk = new Map<DocId, number>();
const NO_DRAFT = -1;

async function persistOnce(): Promise<boolean> {
  const workspace = getWorkspace();
  const documents: SessionDocument[] = [];
  let complete = true;

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
      // `undefined` is dropped by the JSON on its way to Rust, so a plain tab
      // writes exactly what it wrote before these existed.
      pinned: meta.pinned || undefined,
      color: meta.color,
      bookmarks: bookmarksForSession(meta.id),
      preview: previewForSession(meta.id),
      untitled: meta.untitled,
    });
    const onDisk = draftsOnDisk.get(meta.id);
    try {
      if (meta.dirty) {
        if (onDisk !== doc.textVersion) {
          // The version is read before the await: typing during the write
          // bumps it, and the next run must see that as a change.
          const version = doc.textVersion;
          await writeDraft(meta.id, doc.state.doc.toString());
          draftsOnDisk.set(meta.id, version);
        }
      } else if (onDisk !== NO_DRAFT) {
        await dropDraft(meta.id);
        draftsOnDisk.set(meta.id, NO_DRAFT);
      }
    } catch {
      // A draft that cannot be written is not worth failing the whole session
      // over — the tab list is still worth having. It is worth telling the
      // close handler about, though: that draft is now the only thing between
      // this text and the window going away.
      draftsOnDisk.delete(meta.id);
      if (meta.dirty) complete = false;
    }
  }
  // Closed documents: their tab is gone, and whoever closed it dealt with the
  // draft. Forgetting them keeps the map the size of the window.
  for (const id of [...draftsOnDisk.keys()]) {
    if (!getDoc(id)) draftsOnDisk.delete(id);
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
  try {
    await saveSession(session, pruneAllowed);
  } catch {
    // Drafts without a session naming them are drafts nothing will restore.
    complete = false;
  }
  return complete;
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
 * How soon typing reaches the draft. Typing does not announce through
 * `subscribeDocuments` — that fires on metadata — so the text has its own
 * signal, `subscribeText`, and its own timer.
 */
const DRAFT_FLUSH_MS = 1_000;

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

  // Not a debounce: a timer that restarted on every key would never fire while
  // somebody types without pausing, and that is exactly the text worth having.
  // The first change starts it, later ones ride along, and the flush writes
  // only the drafts whose text actually changed.
  let flush = 0;
  const stopText = subscribeText(() => {
    if (flush) return;
    flush = window.setTimeout(() => {
      flush = 0;
      void persistSession();
    }, DRAFT_FLUSH_MS);
  });

  const onUnload = () => {
    void persistSession();
  };
  window.addEventListener('beforeunload', onUnload);

  return () => {
    window.clearTimeout(debounce);
    window.clearTimeout(flush);
    window.removeEventListener('beforeunload', onUnload);
    stopDocuments();
    stopWorkspace();
    stopText();
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
    pinned: entry.pinned === true || undefined,
    color: sanitizeTabColor(entry.color),
    bookmarks: sanitizeBookmarkLines(entry.bookmarks),
    preview: entry.preview === true ? true : undefined,
    untitled: entry.path == null ? untitledNumber(entry) : null,
  };
}

/**
 * The `Neu n` number of an untitled entry: the stored field, or — for a
 * session written before it existed — the number in a name like `Neu 3`.
 * `null` when there is neither; the restore hands out a fresh one then.
 */
function untitledNumber(entry: Record<string, unknown>): number | null {
  const stored = entry.untitled;
  if (typeof stored === 'number' && Number.isInteger(stored) && stored > 0 && stored < 1e9) {
    return stored;
  }
  const legacy = typeof entry.name === 'string' ? /^Neu (\d+)$/.exec(entry.name) : null;
  return legacy?.[1] ? Number(legacy[1]) : null;
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
