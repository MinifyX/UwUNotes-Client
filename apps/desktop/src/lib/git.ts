/**
 * `git status` for the open folder, refreshed on a timer, so the file tree and
 * the tab bar can put a colour next to a changed file.
 *
 * Polling rather than watching: `git status` on a cold repository is fast, a
 * file watcher over a working tree is not, and the indicator is decoration.
 * Every failure — no git, no repository, folder deleted underneath us — ends up
 * as "no statuses" and no message, because nobody opened a text editor to be
 * told about their version control.
 *
 * When `gitIndicators` is off this module does nothing at all: no interval, no
 * IPC, no listeners.
 */

import { useSyncExternalStore } from 'react';
import { gitStatuses, type GitFileStatus } from './api';
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
  snapshot = next;
  for (const listener of listeners) listener();
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
  // Coming back to the window is the moment the statuses are most likely stale:
  // the user was just in a terminal, and that is where commits happen.
  window.addEventListener('focus', tick);

  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', tick);
    stopSettings();
    stopWorkspace();
    commit(NOTHING);
  };
}
