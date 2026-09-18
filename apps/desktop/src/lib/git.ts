/**
 * What git thinks of the open folder, in two resolutions.
 *
 * **Per file** — `git status` for the whole folder, refreshed on a timer, so
 * the file tree and the tab bar can put a colour next to a changed file.
 * Polling rather than watching: `git status` on a cold repository is fast, a
 * file watcher over a working tree is not, and the indicator is decoration.
 *
 * **Per line** — `git diff` for one open file, so the editor's gutter can mark
 * the lines that changed. This one is not polled: a diff is asked for when the
 * file is opened, when it is written, when the branch or the file's status
 * moves underneath it, and once after a burst of typing. Keystrokes do not
 * trigger anything on their own, and the answers are cached per path until the
 * file is closed.
 *
 * Every failure — no git, no repository, folder deleted underneath us — ends up
 * as "nothing to say" and no message, because nobody opened a text editor to be
 * told about their version control.
 *
 * The two halves have a setting each and ignore each other: with
 * `gitIndicators` off there is no interval and no IPC, and with `gitGutter` off
 * there is no cache, no diff and no listener.
 */

import { useSyncExternalStore } from 'react';
import { gitFileDiff, gitStatuses, type GitFileStatus, type GitHunk } from './api';
import { allDocs, getMeta, subscribeDocuments, type DocId, type DocMeta } from './documents';
import { getSettings, subscribeSettings } from './settings';
import { getWorkspace, subscribeWorkspace } from './workspace';

const POLL_MS = 8_000;

type GitSnapshot = {
  /** The repository root, which is not always the folder the user opened. */
  root: string | null;
  branch: string | null;
  /** Keyed by {@link pathKey}, so a lookup from the tree is one hash. */
  files: ReadonlyMap<string, GitFileStatus>;
};

const NOTHING: GitSnapshot = { root: null, branch: null, files: new Map() };

let snapshot: GitSnapshot = NOTHING;
const listeners = new Set<() => void>();

function commit(next: GitSnapshot) {
  // Two empty snapshots in a row would re-render every row in the tree for
  // nothing, and the idle case is exactly "still not a repository".
  if (next === NOTHING && snapshot === NOTHING) return;
  const previous = snapshot;
  snapshot = next;
  for (const listener of listeners) listener();
  refreshHunksAfterStatusChange(previous, next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): GitSnapshot {
  return snapshot;
}

/**
 * Same normalisation as `samePath` in `lib/documents.ts`: Windows disagrees
 * with itself about case and slashes, and git reports whichever it likes.
 */
const CASE_INSENSITIVE = navigator.userAgent.includes('Windows');

function pathKey(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return CASE_INSENSITIVE ? slashed.toLowerCase() : slashed;
}

/** What git says about one file, or `null` when it has nothing to say. */
export function useGitStatus(path: string): GitFileStatus | null {
  return useSyncExternalStore(subscribe, getSnapshot).files.get(pathKey(path)) ?? null;
}

/** The current branch, for the status bar. `null` outside a repository. */
export function useGitBranch(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot).branch;
}

export function gitBranch(): string | null {
  return snapshot.branch;
}

let inFlight = false;

/** Fire-and-forget; the result arrives through the store. */
export function refreshGitStatus(): void {
  void poll();
}

async function poll(): Promise<void> {
  if (inFlight) return;
  const folder = getWorkspace().folder;
  if (!getSettings().gitIndicators || !folder) {
    commit(NOTHING);
    return;
  }
  inFlight = true;
  try {
    const statuses = await gitStatuses(folder);
    if (!statuses) {
      commit(NOTHING);
      return;
    }
    const files = new Map<string, GitFileStatus>();
    for (const [path, status] of Object.entries(statuses.files)) files.set(pathKey(path), status);
    commit({ root: statuses.root, branch: statuses.branch, files });
  } catch {
    commit(NOTHING);
  } finally {
    inFlight = false;
  }
}

/**
 * Starts polling. Called once from `main.tsx`; returns the teardown.
 *
 * Re-arms whenever the setting or the open folder changes, which is also what
 * turns the whole thing off again without a restart.
 */
export function startGitWatch(): () => void {
  let timer = 0;
  let lastFolder = getWorkspace().folder;

  const tick = () => {
    void poll();
  };

  const arm = () => {
    window.clearInterval(timer);
    timer = 0;
    if (!getSettings().gitIndicators) {
      commit(NOTHING);
      return;
    }
    tick();
    timer = window.setInterval(tick, POLL_MS);
  };

  const onWorkspaceChange = () => {
    const folder = getWorkspace().folder;
    if (folder === lastFolder) return;
    lastFolder = folder;
    commit(NOTHING);
    arm();
  };

  arm();
  const stopSettings = subscribeSettings(arm);
  const stopWorkspace = subscribeWorkspace(onWorkspaceChange);
  const stopHunks = startHunkWatch();
  // Coming back to the window is the moment the statuses are most likely stale:
  // the user was just in a terminal, and that is where commits happen.
  window.addEventListener('focus', tick);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', tick);
    stopSettings();
    stopWorkspace();
    stopHunks();
    commit(NOTHING);
  };
}

/* ── Per-line marks ────────────────────────────────────── */

export type { GitHunk };

/**
 * How long the typing has to stop before we ask git again.
 *
 * Long enough that a sentence is one question rather than forty, short enough
 * that a save half a second ago is already drawn by the time you look.
 */
const AFTER_EDIT_MS = 700;

/** Shared, so "this file has no marks" is one object and not a new array a second. */
const NO_HUNKS: GitHunk[] = [];

/** Keyed by {@link pathKey}; an entry is dropped when the file is closed. */
const hunksByPath = new Map<string, GitHunk[]>();
/** The paths currently open, so an answer for a file nobody has any more is dropped. */
const openPaths = new Set<string>();
/** Per document: what was last on disk, which is what a diff is against. */
const diskSignatures = new Map<DocId, string>();
const hunkListeners = new Set<() => void>();

let gutterWasEnabled = false;

function announceHunks() {
  for (const listener of hunkListeners) listener();
}

/** For the gutter, which is not React and needs the marks the moment it mounts. */
export function subscribeGitHunks(listener: () => void): () => void {
  hunkListeners.add(listener);
  return () => hunkListeners.delete(listener);
}

/** The same, read outside React. Returns the cached array, so identity means "unchanged". */
export function gitHunks(docId: DocId): GitHunk[] {
  const path = getMeta(docId)?.path;
  if (!path) return NO_HUNKS;
  return hunksByPath.get(pathKey(path)) ?? NO_HUNKS;
}

/** What git diff says about one open document. Empty while the feature is off. */
export function useGitHunks(docId: DocId): GitHunk[] {
  return useSyncExternalStore(subscribeGitHunks, () => gitHunks(docId));
}

const afterEditTimers = new Map<string, number>();

/**
 * "The user has stopped typing in this file."
 *
 * Called by the gutter, which is the only part of the app that sees a
 * keystroke at all. Usually it confirms what we already know — an unsaved
 * buffer has not reached the disk and `git diff` reads the disk — but it is
 * what catches an autosave, or a rebase that happened in a terminal while the
 * file sat open. An identical answer is dropped without a redraw.
 */
export function scheduleGitHunks(docId: DocId): void {
  const path = getMeta(docId)?.path;
  if (!path || !getSettings().gitGutter) return;
  const key = pathKey(path);
  window.clearTimeout(afterEditTimers.get(key));
  afterEditTimers.set(
    key,
    window.setTimeout(() => {
      afterEditTimers.delete(key);
      void loadHunks(path);
    }, AFTER_EDIT_MS),
  );
}

/** Paths with a diff in flight, and the ones that were asked for again meanwhile. */
const diffsInFlight = new Set<string>();
const diffsToRepeat = new Set<string>();

async function loadHunks(path: string): Promise<void> {
  const key = pathKey(path);
  if (diffsInFlight.has(key)) {
    // Two processes asking git the same question get the same answer twice.
    // The second ask is remembered and served after the first lands.
    diffsToRepeat.add(key);
    return;
  }
  diffsInFlight.add(key);
  try {
    storeHunks(key, (await gitFileDiff(path)) ?? NO_HUNKS);
  } catch {
    storeHunks(key, NO_HUNKS);
  } finally {
    diffsInFlight.delete(key);
    if (diffsToRepeat.delete(key) && openPaths.has(key)) void loadHunks(path);
  }
}

function storeHunks(key: string, hunks: GitHunk[]) {
  // The file was closed while git was thinking. Keeping the answer would leak
  // one entry per file the user ever opened.
  if (!openPaths.has(key)) return;
  const known = hunksByPath.get(key);
  // The array that is already out there is kept rather than replaced by an
  // equal one: everything downstream compares these by identity.
  if (known && sameHunks(known, hunks)) return;
  // A first answer of "nothing" only fills the cache — the column was already
  // blank, and nobody needs waking up to be told so.
  const changed = known !== undefined || hunks.length > 0;
  hunksByPath.set(key, hunks);
  if (changed) announceHunks();
}

function sameHunks(a: GitHunk[], b: GitHunk[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((hunk, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      other.kind === hunk.kind &&
      other.fromLine === hunk.fromLine &&
      other.lineCount === hunk.lineCount
    );
  });
}

/**
 * What the diff is taken against: the file as it was last read from or written
 * to disk. It changes on open, on save and on reload, and it deliberately does
 * not change while the buffer is merely dirty — the text in the editor is not
 * what git is looking at.
 */
function diskSignature(meta: DocMeta): string {
  // Numbers first: a path can contain anything, including whatever we picked as
  // a separator, and two of them are the only things here that can collide.
  return `${meta.stamp?.mtimeMs ?? 0} ${meta.stamp?.size ?? 0} ${meta.path ?? ''}`;
}

/**
 * Brings the cache in line with the open documents: a diff for anything new or
 * newly written, and nothing at all for a file that has been closed.
 *
 * Runs on every metadata change, which is as often as a tab is renamed — so it
 * has to stay a walk over a handful of documents and a string compare.
 */
function syncOpenDocuments(): void {
  const enabled = getSettings().gitGutter;
  if (enabled !== gutterWasEnabled) {
    gutterWasEnabled = enabled;
    forgetHunks();
  }
  if (!enabled) return;

  const wanted = new Set<string>();
  for (const { meta } of allDocs()) {
    if (!meta.path) continue;
    const key = pathKey(meta.path);
    wanted.add(key);
    const signature = diskSignature(meta);
    if (diskSignatures.get(meta.id) === signature && hunksByPath.has(key)) continue;
    diskSignatures.set(meta.id, signature);
    openPaths.add(key);
    void loadHunks(meta.path);
  }

  for (const key of hunksByPath.keys()) if (!wanted.has(key)) hunksByPath.delete(key);
  for (const key of openPaths) if (!wanted.has(key)) openPaths.delete(key);
  for (const id of diskSignatures.keys()) if (!getMeta(id)) diskSignatures.delete(id);
}

/**
 * A commit, a checkout or a `git add` changes what "changed" means without
 * touching a byte of any file, so nothing else in here would notice.
 *
 * This rides on the status poll, which means it only happens while
 * `gitIndicators` is also on. With it off, a commit made elsewhere leaves the
 * marks as they were until the file is saved or typed in — stale marks on a
 * feature the user switched half off is a fair trade for not running a second
 * timer.
 */
function refreshHunksAfterStatusChange(previous: GitSnapshot, next: GitSnapshot): void {
  if (!getSettings().gitGutter) return;
  const branchChanged = previous.branch !== next.branch;
  for (const { meta } of allDocs()) {
    if (!meta.path) continue;
    const key = pathKey(meta.path);
    if (!openPaths.has(key)) continue;
    if (branchChanged || previous.files.get(key) !== next.files.get(key)) void loadHunks(meta.path);
  }
}

function forgetHunks(): void {
  hunksByPath.clear();
  openPaths.clear();
  diskSignatures.clear();
  // Unconditionally, because the gutter hides itself when the feature is off
  // and has no other way to hear that the setting moved.
  announceHunks();
}

/**
 * The per-line half of {@link startGitWatch}, kept separate because it shares
 * nothing with the poll: its own setting, its own listeners, no timer.
 */
function startHunkWatch(): () => void {
  syncOpenDocuments();
  const stopDocuments = subscribeDocuments(syncOpenDocuments);
  const stopSettings = subscribeSettings(syncOpenDocuments);

  return () => {
    stopDocuments();
    stopSettings();
    for (const timer of afterEditTimers.values()) window.clearTimeout(timer);
    afterEditTimers.clear();
    forgetHunks();
  };
}
