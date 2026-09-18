/**
 * Find in files: one query, the whole open folder, results arriving while they
 * are found.
 *
 * The walk happens in Rust (`search_files`), which streams a message per file
 * and one summary at the end. Nothing here blocks on the whole search, because
 * the point of a streaming search is that the first hit is on screen long
 * before the last directory has been opened, and the user keeps typing in their
 * file the entire time.
 *
 * With no folder open there is still something worth searching — the buffers
 * that are already in the window — so this module falls back to scanning them
 * with the same {@link compileSearch} query the find bar uses. The panel says
 * out loud when that is what happened; quietly searching less than the user
 * asked for is how a search tool loses its credibility.
 *
 * What it does NOT do: repeat the walk before replacing. Replace-in-files is
 * handed exactly the file list the user is looking at, so a file that appeared
 * between the search and the click is not silently rewritten.
 */

import { useSyncExternalStore } from 'react';
import {
  asApiError,
  cancelSearch,
  replaceInFiles,
  searchFiles,
  type SearchEvent,
  type SearchMatch,
  type SearchOptions,
} from './api';
import { closeDialog, getUiState } from './commands';
import { allDocs, findByPath, getDoc, setDocState, type DocId } from './documents';
import { checkDiskChanges, describeApiError, openPaths } from './files';
import { compileSearch } from './find';
import { t } from './i18n';
import { ask } from './prompt';
import { toast } from './toast';
import { viewFor } from './views';
import { activateDoc, getWorkspace, paneOf } from './workspace';
import { EditorView } from '@codemirror/view';
import type { SearchQuery } from '@codemirror/search';

/** Rust stops walking here. Beyond a few thousand hits nobody is reading rows. */
const MAX_MATCHES = 5_000;

/** Files bigger than this are counted as skipped rather than read. */
const MAX_FILE_SIZE = 4_000_000;

/** How much of a line a result row is willing to carry. */
const PREVIEW_MAX = 400;

/** One file with everything found in it, in the order Rust found it. */
export type FileResult = {
  /** The row's identity: the path, or the document id for an unsaved buffer. */
  id: string;
  /** `null` for a buffer that has never been written anywhere. */
  path: string | null;
  name: string;
  matches: readonly SearchMatch[];
};

export type ProjectSearchState = {
  open: boolean;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Dot-files and dot-directories take part. Off, because `.git` is enormous. */
  includeHidden: boolean;
  /** Comma-separated globs, e.g. `*.ts, *.rs`. Empty means every file. */
  include: string;
  exclude: string;
  respectIgnoreFiles: boolean;
  replacement: string;
  results: readonly FileResult[];
  files: number;
  matches: number;
  running: boolean;
  /** The walk stopped at {@link MAX_MATCHES}: there is more than this. */
  truncated: boolean;
  /** Files passed over for being too big or unreadable. */
  skipped: number;
  error: string | null;
  /** A search has run since the query was last edited — so "nothing found" means it. */
  searched: boolean;
  /** No folder was open, so the open documents were searched instead. */
  inMemory: boolean;
  /** Ids of the file rows the user folded shut. */
  collapsed: ReadonlySet<string>;
};

const EMPTY: ProjectSearchState = {
  open: false,
  query: '',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  includeHidden: false,
  include: '',
  exclude: '',
  respectIgnoreFiles: true,
  replacement: '',
  results: [],
  files: 0,
  matches: 0,
  running: false,
  truncated: false,
  skipped: 0,
  error: null,
  searched: false,
  inMemory: false,
  collapsed: new Set(),
};

/** What the form is allowed to change. The results are this module's business. */
export type ProjectSearchPatch = Partial<
  Pick<
    ProjectSearchState,
    | 'query'
    | 'regex'
    | 'caseSensitive'
    | 'wholeWord'
    | 'includeHidden'
    | 'include'
    | 'exclude'
    | 'respectIgnoreFiles'
    | 'replacement'
  >
>;

let current: ProjectSearchState = EMPTY;
const listeners = new Set<() => void>();

function commit(next: ProjectSearchState) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getProjectSearch(): ProjectSearchState {
  return current;
}

export function useProjectSearch(): ProjectSearchState {
  return useSyncExternalStore(subscribe, getProjectSearch);
}

function options(): SearchOptions {
  return {
    query: current.query,
    regex: current.regex,
    caseSensitive: current.caseSensitive,
    wholeWord: current.wholeWord,
  };
}

/* ── Opening and closing ───────────────────────────────── */

/**
 * Shows the panel.
 *
 * The panel is not a dialog — a search that dies when the user clicks back into
 * their file is useless — so it takes the `projectSearch` slot from
 * `lib/commands.ts` and immediately gives it back. The command flips the slot,
 * this notices, and from then on the panel is just part of the window.
 */
export function openProjectSearch(): void {
  if (!current.open) commit({ ...current, open: true });
  if (getUiState().dialog === 'projectSearch') closeDialog();
}

export function closeProjectSearch(): void {
  stopProjectSearch();
  if (current.open) commit({ ...current, open: false });
}

export function updateProjectSearch(patch: ProjectSearchPatch): void {
  // Editing the query invalidates the verdict, not the rows: the results stay
  // on screen to be clicked, but the panel stops claiming that nothing matches
  // a query nobody has searched for yet.
  const searched = patch.query === undefined || patch.query === current.query;
  commit({ ...current, ...patch, searched: current.searched && searched });
}

export function toggleFileCollapsed(id: string): void {
  const collapsed = new Set(current.collapsed);
  if (!collapsed.delete(id)) collapsed.add(id);
  commit({ ...current, collapsed });
}

/* ── Running a search ──────────────────────────────────── */

let runs = 0;
/** The search Rust is working on right now, so the next one can call it off. */
let runningId: string | null = null;

export function stopProjectSearch(): void {
  if (runningId) {
    // Best effort: a search that has already finished has nothing to cancel,
    // and a failed cancel is not something to bother the user about.
    void cancelSearch(runningId).catch(() => undefined);
    runningId = null;
  }
  if (current.running) commit({ ...current, running: false });
}

export function runProjectSearch(): void {
  stopProjectSearch();
  runs += 1;
  const id = `project-search-${runs}`;

  const { query, error } = compileSearch(options());
  const folder = getWorkspace().folder;
  if (!query) {
    commit({
      ...current,
      results: [],
      files: 0,
      matches: 0,
      running: false,
      truncated: false,
      skipped: 0,
      error,
      searched: false,
      inMemory: folder === null,
      collapsed: new Set(),
    });
    return;
  }

  if (!folder) {
    const found = scanOpenDocuments(query);
    commit({
      ...current,
      results: found.results,
      files: found.results.length,
      matches: found.matches,
      running: false,
      truncated: found.truncated,
      skipped: 0,
      error: null,
      searched: true,
      inMemory: true,
      collapsed: new Set(),
    });
    return;
  }

  runningId = id;
  commit({
    ...current,
    results: [],
    files: 0,
    matches: 0,
    running: true,
    truncated: false,
    skipped: 0,
    error: null,
    searched: true,
    inMemory: false,
    collapsed: new Set(),
  });

  void searchFiles(
    {
      id,
      root: folder,
      query: current.query,
      regex: current.regex,
      caseSensitive: current.caseSensitive,
      wholeWord: current.wholeWord,
      include: current.include,
      exclude: current.exclude,
      respectIgnoreFiles: current.respectIgnoreFiles,
      includeHidden: current.includeHidden,
      maxMatches: MAX_MATCHES,
      maxFileSize: MAX_FILE_SIZE,
    },
    (event) => {
      // A message from a search the user has already replaced. Dropping it is
      // the entire reason each search carries an id.
      if (runningId === id) absorb(event);
    },
  ).catch((problem: unknown) => {
    if (runningId !== id) return;
    runningId = null;
    commit({ ...current, running: false, error: describeApiError(asApiError(problem), folder) });
  });
}

function absorb(event: SearchEvent): void {
  if (event.kind === 'file') {
    commit({
      ...current,
      results: [
        ...current.results,
        { id: event.path, path: event.path, name: baseName(event.path), matches: event.matches },
      ],
      files: current.files + 1,
      matches: current.matches + event.matches.length,
    });
    return;
  }
  runningId = null;
  commit({
    ...current,
    running: false,
    files: event.files,
    matches: event.matches,
    truncated: event.truncated,
    skipped: event.skipped,
    error: event.error,
  });
}

/* ── The fallback: the documents already in the window ─── */

/**
 * Searches the open buffers, producing the same rows Rust would.
 *
 * The offsets go out in UTF-16 code units, counted from the start of the
 * preview, because that is the contract `SearchMatch` states and the panel
 * slices the preview with them without thinking about it.
 */
function scanOpenDocuments(query: SearchQuery): {
  results: FileResult[];
  matches: number;
  truncated: boolean;
} {
  const results: FileResult[] = [];
  let matches = 0;
  let truncated = false;

  for (const doc of allDocs()) {
    const text = doc.state.doc;
    const cursor = query.getCursor(doc.state);
    const hits: SearchMatch[] = [];
    for (;;) {
      const step = cursor.next();
      if (step.done) break;
      const line = text.lineAt(step.value.from);
      const preview = line.text.slice(0, PREVIEW_MAX);
      hits.push({
        line: line.number,
        preview,
        start: Math.min(step.value.from - line.from, preview.length),
        end: Math.min(step.value.to - line.from, preview.length),
      });
      matches += 1;
      if (matches >= MAX_MATCHES) {
        truncated = true;
        break;
      }
    }
    if (hits.length > 0) {
      results.push({
        id: doc.meta.path ?? doc.meta.id,
        path: doc.meta.path,
        name: doc.meta.name,
        matches: hits,
      });
    }
    if (truncated) break;
  }

  return { results, matches, truncated };
}

/* ── Going to a result ─────────────────────────────────── */

/** Opens the file a result belongs to and puts the caret on the match. */
export async function openMatch(result: FileResult, match: SearchMatch): Promise<void> {
  if (result.path) await openPaths([result.path]);
  const doc = result.path ? findByPath(result.path) : result.id;
  if (!doc || !getDoc(doc)) return;
  activateDoc(doc);
  reveal(doc, match, true);
}

/**
 * Selects the match in the editor.
 *
 * A file that was just opened has no editor yet — React has not rendered the
 * pane — so the selection goes into the document state, which is what the new
 * view will be built from, and one frame later there is something to scroll.
 */
function reveal(doc: DocId, match: SearchMatch, retry: boolean): void {
  const found = getDoc(doc);
  if (!found) return;
  const text = found.state.doc;
  const line = text.line(Math.min(Math.max(match.line, 1), text.lines));
  const from = Math.min(line.from + match.start, line.to);
  const to = Math.min(line.from + match.end, line.to);

  const pane = paneOf(doc);
  const view = pane ? viewFor(pane) : undefined;
  if (view && view.state === found.state) {
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
      scrollIntoView: true,
    });
    setDocState(doc, view.state);
    view.focus();
    return;
  }

  setDocState(doc, found.state.update({ selection: { anchor: from, head: to } }).state);
  if (retry) window.requestAnimationFrame(() => reveal(doc, match, false));
}

/* ── Replacing across files ────────────────────────────── */

/**
 * Rewrites every file in the current results, after saying how many that is.
 *
 * The confirmation is not politeness: this is the one action in the app that
 * changes files the user never opened, and it cannot be undone with Ctrl+Z
 * because most of those files have no editor to undo in.
 */
export async function replaceAllInFiles(): Promise<void> {
  if (current.inMemory) {
    toast('info', t('Ersetzen in Dateien braucht einen geöffneten Ordner.'));
    return;
  }
  const paths = current.results
    .map((result) => result.path)
    .filter((path): path is string => path !== null);
  if (paths.length === 0 || !current.query) return;

  const answer = await ask(
    t('In {files} Dateien ersetzen?', { files: paths.length }),
    t(
      '{matches} Treffer werden durch „{replacement}“ ersetzt. Das lässt sich nicht rückgängig machen.',
      { matches: current.matches, replacement: current.replacement },
    ),
    [
      { id: 'replace', label: t('Ersetzen'), tone: 'danger' },
      { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
    ],
  );
  if (answer !== 'replace') return;

  try {
    const summary = await replaceInFiles({
      ...options(),
      replacement: current.replacement,
      files: paths,
    });
    if (summary.failed.length > 0) {
      toast(
        'error',
        t('{done} Dateien geändert, {failed} nicht beschreibbar.', {
          done: summary.files,
          failed: summary.failed.length,
        }),
      );
    } else {
      toast(
        'success',
        t('{count} Ersetzungen in {files} Dateien.', {
          count: summary.replacements,
          files: summary.files,
        }),
      );
    }
  } catch (problem) {
    commit({ ...current, error: describeApiError(asApiError(problem), null) });
    return;
  }

  // Tabs pointing at files that were just rewritten, and a result list that is
  // now describing the previous contents. Both are stale for the same reason.
  await checkDiskChanges();
  runProjectSearch();
}

/* ── Odds and ends ─────────────────────────────────────── */

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** The folder a result sits in, for the second line of a file row. */
export function parentOf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  parts.pop();
  const root = getWorkspace().folder;
  const full = parts.join('/');
  if (!root) return full;
  const rootParts = root.split(/[\\/]/).filter(Boolean);
  // Relative to the folder the user opened: the absolute prefix is the same on
  // every row and steals the width the interesting part needs.
  const shared = rootParts.every((part, index) => parts[index] === part);
  return shared ? parts.slice(rootParts.length).join('/') : full;
}
