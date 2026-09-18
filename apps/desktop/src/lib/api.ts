/**
 * The Rust side, as functions.
 *
 * Every `invoke` in the app goes through here, so the IPC surface is one file
 * you can read top to bottom — and so the types on this side and the
 * `#[tauri::command]`s in `src-tauri/src/` are edited together or not at all.
 * Nothing else in `src/` imports from `@tauri-apps/api`.
 *
 * The split is deliberate: Rust owns bytes (decoding, encoding, atomic writes,
 * walking a tree) and the page owns text. By the time a file reaches React it
 * is a JavaScript string with `\n` line endings, and how it got that way —
 * which code page, which BOM, which line ending — travels alongside it so
 * saving can put it all back exactly as it was.
 */

import { Channel, invoke } from '@tauri-apps/api/core';

/* ── Files ─────────────────────────────────────────────── */

/** How a file's lines end on disk. In the editor everything is `\n`. */
export type Eol = 'lf' | 'crlf' | 'cr';

/**
 * An `encoding_rs` label, e.g. `UTF-8`, `windows-1252`, `UTF-16LE`. The BOM is
 * a separate flag rather than its own encoding: "UTF-8 with BOM" is one
 * checkbox, not a different code page.
 */
export type EncodingLabel = string;

/** What the file looked like on disk when we last touched it. */
export type FileStamp = {
  /** Modification time in milliseconds since the epoch, 0 when unknown. */
  mtimeMs: number;
  size: number;
  readOnly: boolean;
};

/** How the encoding was decided — shown in the status bar, and worth arguing with. */
export type EncodingSource = 'bom' | 'guessed' | 'forced';

export type LoadedFile = {
  path: string;
  /** Line endings already normalised to `\n`; `eol` says what to write back. */
  text: string;
  encoding: EncodingLabel;
  bom: boolean;
  eol: Eol;
  /** The file mixed CRLF and LF. We picked the majority; the user gets told. */
  mixedEol: boolean;
  stamp: FileStamp;
  /** Decoding produced replacement characters: the guess was wrong, or it is not text. */
  lossy: boolean;
  /** NUL bytes in the first block. Opened anyway, with a warning — never silently. */
  binary: boolean;
  encodingSource: EncodingSource;
};

export type SavedFile = { stamp: FileStamp };

export type DirEntryKind = 'file' | 'dir';

export type DirEntry = {
  name: string;
  path: string;
  kind: DirEntryKind;
  size: number;
  mtimeMs: number;
  hidden: boolean;
};

/** A starting point in the file tree: Home, Desktop, a drive. */
export type Place = {
  name: string;
  path: string;
  icon: 'home' | 'desktop' | 'documents' | 'drive';
};

/** Reads a file and decodes it. `encoding` forces one instead of detecting it. */
export const readTextFile = (path: string, encoding?: EncodingLabel) =>
  invoke<LoadedFile>('read_text_file', { path, encoding: encoding ?? null });

/**
 * Writes the file, encoding the text back and re-applying `eol`.
 *
 * `expectedStamp` is what the editor believes is on disk. Rust refuses the
 * write when the file changed underneath — the reply is an error the UI turns
 * into "the file changed, overwrite?". Pass `null` to write regardless.
 */
export const writeTextFile = (args: {
  path: string;
  text: string;
  encoding: EncodingLabel;
  bom: boolean;
  eol: Eol;
  expectedStamp: FileStamp | null;
}) => invoke<SavedFile>('write_text_file', args);

/** The file's current stamp, or `null` when it is gone. */
export const fileStatus = (path: string) => invoke<FileStamp | null>('file_status', { path });

export const listDir = (path: string) => invoke<DirEntry[]>('list_dir', { path });

export const listPlaces = () => invoke<Place[]>('list_places');

export const createDir = (path: string) => invoke<void>('create_dir', { path });

export const createFile = (path: string) => invoke<void>('create_file', { path });

export const renamePath = (from: string, to: string) => invoke<void>('rename_path', { from, to });

/** To the recycle bin, never a hard delete. */
export const trashPath = (path: string) => invoke<void>('trash_path', { path });

export type PathInfo = {
  /** The path, cleaned up and made absolute. */
  path: string;
  name: string;
  parent: string | null;
  exists: boolean;
  isDir: boolean;
};

export const pathInfo = (path: string) => invoke<PathInfo>('path_info', { path });

/** Joins with the platform's separator, so the page never guesses the slash. */
export const joinPath = (base: string, name: string) => invoke<string>('join_path', { base, name });

/* ── Dialogs ───────────────────────────────────────────── */

export const pickFiles = () => invoke<string[]>('pick_files');

export const pickSavePath = (suggestedName: string, startIn: string | null) =>
  invoke<string | null>('pick_save_path', { suggestedName, startIn });

export const pickFolder = () => invoke<string | null>('pick_folder');

/* ── Find in files ─────────────────────────────────────── */

export type SearchOptions = {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
};

export type SearchRequest = SearchOptions & {
  /** Cancels by id; a second search with the same id replaces the first. */
  id: string;
  root: string;
  /** Comma-separated globs. Empty means every file. */
  include: string;
  exclude: string;
  /** Skip what .gitignore skips. On by default: nobody wants node_modules. */
  respectIgnoreFiles: boolean;
  includeHidden: boolean;
  maxMatches: number;
  /** Files above this many bytes are skipped and counted, not searched. */
  maxFileSize: number;
};

export type SearchMatch = {
  /** 1-based, as shown to the user. */
  line: number;
  /** The whole line, trimmed to something a list row can hold. */
  preview: string;
  /**
   * Where the match sits inside `preview`, in UTF-16 code units — the same
   * units JavaScript strings and CodeMirror positions use, converted on the
   * Rust side where the byte offsets are.
   */
  start: number;
  end: number;
};

export type SearchEvent =
  | { kind: 'file'; path: string; matches: SearchMatch[] }
  | {
      kind: 'done';
      files: number;
      matches: number;
      /** Stopped at `maxMatches`; there are more. */
      truncated: boolean;
      /** Files skipped for being too big or unreadable. */
      skipped: number;
      error: string | null;
    };

/** Streams results as they are found; resolves when the walk is finished. */
export const searchFiles = (request: SearchRequest, onEvent: (event: SearchEvent) => void) => {
  const channel = new Channel<SearchEvent>();
  channel.onmessage = onEvent;
  return invoke<void>('search_files', { request, onEvent: channel });
};

export const cancelSearch = (id: string) => invoke<void>('cancel_search', { id });

export type ReplaceRequest = SearchOptions & {
  replacement: string;
  /**
   * Exactly the files to touch, from a search the user has already seen. The
   * walk is never repeated: replacing in a file that appeared between the
   * search and the click is the kind of surprise an editor must not spring.
   */
  files: string[];
};

export type ReplaceSummary = {
  files: number;
  replacements: number;
  /** Paths that could not be written, with why. */
  failed: { path: string; error: string }[];
};

export const replaceInFiles = (request: ReplaceRequest) =>
  invoke<ReplaceSummary>('replace_in_files', { request });

/* ── Session ───────────────────────────────────────────── */

export type SessionDocument = {
  docId: string;
  /** `null` for a buffer that was never saved anywhere. */
  path: string | null;
  name: string;
  encoding: EncodingLabel;
  bom: boolean;
  eol: Eol;
  /** A language the user picked by hand; `null` means "decide by file name". */
  language: string | null;
  /** Caret offset, in UTF-16 code units. */
  cursor: number;
  scrollTop: number;
  /** There were unsaved changes, so a draft was written next to the session. */
  dirty: boolean;
  stamp: FileStamp | null;
};

export type SessionPane = { tabs: string[]; active: string | null };

export type StoredSession = {
  version: number;
  documents: SessionDocument[];
  /** The split tree, as `lib/layout.ts` writes it. */
  layout: unknown;
  panes: Record<string, SessionPane>;
  activePane: string;
  folder: string | null;
  recentFiles: string[];
  recentFolders: string[];
};

export const loadSession = () => invoke<StoredSession | null>('load_session');

export const saveSession = (session: StoredSession) => invoke<void>('save_session', { session });

/**
 * Unsaved text, parked next to the session file so closing the app never
 * costs anything. One file per document id; dropped as soon as the document
 * is saved or its tab is closed on purpose.
 */
export const writeDraft = (docId: string, text: string) =>
  invoke<void>('write_draft', { docId, text });

export const readDraft = (docId: string) => invoke<string | null>('read_draft', { docId });

export const dropDraft = (docId: string) => invoke<void>('drop_draft', { docId });

/* ── Git ───────────────────────────────────────────────── */

export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'untracked' | 'conflicted';

export type GitStatuses = {
  /** The repository root, which is not always the folder the user opened. */
  root: string;
  branch: string | null;
  /** Absolute path to status, for the files git has something to say about. */
  files: Record<string, GitFileStatus>;
};

/** `null` when the folder is not in a repository, or git is not installed. */
export const gitStatuses = (root: string) => invoke<GitStatuses | null>('git_statuses', { root });

/** One run of changed lines, numbered in the file as it is on disk now. */
export type GitHunk = {
  kind: 'added' | 'modified' | 'deleted';
  /**
   * 1-based. For `deleted` it is the line the removal sits *after* — 0 when the
   * removed lines were at the very top of the file.
   */
  fromLine: number;
  /** Always 1 for `deleted`: the lines are gone, so there is nothing to cover. */
  lineCount: number;
};

/** `null` when the file is untracked, unchanged, or not in a repository at all. */
export const gitFileDiff = (path: string) => invoke<GitHunk[] | null>('git_file_diff', { path });

/* ── System ────────────────────────────────────────────── */

export type AppInfo = { version: string; platform: string; configDir: string };

export const appInfo = () => invoke<AppInfo>('app_info');

export const openExternal = (url: string) => invoke<void>('open_external', { url });

export const revealInFileManager = (path: string) =>
  invoke<void>('reveal_in_file_manager', { path });

/**
 * An error a command returned. Rust sends `{ kind, message, path }` for
 * everything a user could plausibly hit, so the UI can react to the kind
 * (offer "overwrite anyway" on `changed`) instead of matching on prose.
 */
export type ApiErrorKind =
  | 'notFound'
  | 'permission'
  | 'changed'
  | 'tooLarge'
  | 'isDirectory'
  | 'encoding'
  | 'invalidRegex'
  | 'other';

export type ApiError = { kind: ApiErrorKind; message: string; path: string | null };

/** Narrows whatever a rejected `invoke` threw into an {@link ApiError}. */
export function asApiError(error: unknown): ApiError {
  if (typeof error === 'object' && error !== null && 'kind' in error && 'message' in error) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.kind === 'string' && typeof candidate.message === 'string') {
      return {
        kind: candidate.kind as ApiErrorKind,
        message: candidate.message,
        path: typeof candidate.path === 'string' ? candidate.path : null,
      };
    }
  }
  return { kind: 'other', message: String(error), path: null };
}
