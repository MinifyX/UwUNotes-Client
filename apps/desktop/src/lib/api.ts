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
  /**
   * The text holds characters `encoding` cannot write, the user has been shown
   * that and has said to write it anyway. Without this Rust refuses the save
   * rather than putting `&#8594;` where the user typed `→`.
   */
  allowUnmappable: boolean;
}) => invoke<SavedFile>('write_text_file', args);

/** The file's current stamp, or `null` when it is gone. */
export const fileStatus = (path: string) => invoke<FileStamp | null>('file_status', { path });

export const listDir = (path: string) => invoke<DirEntry[]>('list_dir', { path });

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

/* ── Tools ─────────────────────────────────────────────── */

/** Tools → Hash. The wire names match `HashAlgorithm` in `uwunotes-fs`. */
export type HashAlgorithm = 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';

/** Lower-case hex of the text's UTF-8 bytes. */
export const hashText = (text: string, algorithm: HashAlgorithm) =>
  invoke<string>('hash_text', { text, algorithm });

/** Lower-case hex of the file's bytes, exactly as they are on disk. */
export const hashFile = (path: string, algorithm: HashAlgorithm) =>
  invoke<string>('hash_file', { path, algorithm });

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
  /**
   * Tab flags from the tab menu. Optional and left out when off: the Rust
   * store does not name them and carries them through verbatim (`extra` in
   * `crates/uwunotes-session/src/model.rs`), so an older build that never
   * heard of them still writes them back unchanged.
   */
  pinned?: boolean;
  /** One of `TAB_COLORS` in `lib/tabs.ts`. */
  color?: string;
  /** Bookmarked lines, 1-based. Left out when there are none; the store carries it verbatim. */
  bookmarks?: number[];
  /** The Markdown preview was open next to this document. Left out when it was not. */
  preview?: boolean;
  /**
   * The stable `Neu n` number of a buffer that was never saved. Its tab shows
   * a title taken from its first line instead, so the number cannot be read
   * back from `name`. Optional: Rust carries it without knowing it.
   */
  untitled?: number | null;
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

/**
 * Writes the session, and sweeps up drafts that belong to nothing — but only
 * when `prune` says the document list below is the whole truth.
 *
 * A draft is the only copy of text that was never saved anywhere. Every path
 * that ends in a fresh empty buffer — the restore setting switched off, a
 * session from another version, a session file that would not parse, a draft
 * that would not read — passes `false`, because on those paths the one new
 * buffer is not a list of what to keep. Rust holds the other half of the same
 * question and both have to agree.
 */
export const saveSession = (session: StoredSession, prune: boolean) =>
  invoke<void>('save_session', { session, prune });

/**
 * Unsaved text, parked next to the session file so closing the app never
 * costs anything. One file per document id; dropped as soon as the document
 * is saved or its tab is closed on purpose.
 */
export const writeDraft = (docId: string, text: string) =>
  invoke<void>('write_draft', { docId, text });

export const readDraft = (docId: string) => invoke<string | null>('read_draft', { docId });

export const dropDraft = (docId: string) => invoke<void>('drop_draft', { docId });

/* ── Zeitreise ─────────────────────────────────────────── */

/**
 * What a history belongs to: a file by its path, or a buffer that was never
 * saved by its document id. Rust hashes either into a directory name, so a
 * key never reaches the disk as written.
 */
export type HistoryKey = { kind: 'path'; path: string } | { kind: 'note'; id: string };

/** Why a version was taken. The wire names match `Reason` in `uwunotes-history`. */
export type HistoryReason =
  'save' | 'auto' | 'before-reload' | 'before-replace' | 'restore' | 'external-change';

export type HistoryVersion = {
  id: string;
  /** Milliseconds since the epoch. */
  time: number;
  reason: HistoryReason;
  /** The text's UTF-8 length. */
  size: number;
  lines: number;
  /** SHA-256 of the text. */
  hash: string;
  /** Compressed, on disk. */
  storedSize: number;
};

export type HistorySnapshot =
  | { status: 'created'; version: HistoryVersion }
  /** The text already is the newest version; nothing was written. */
  | { status: 'unchanged'; version: HistoryVersion }
  /** Too large to keep, or a file that was not cleanly text. */
  | { status: 'skipped' };

export type HistoryStats = { histories: number; versions: number; bytes: number };

/**
 * Keeps `text` as the newest version of `key` unless it already is, and thins
 * that history out by `retentionDays` while at it.
 */
export const historySnapshot = (
  key: HistoryKey,
  text: string,
  reason: HistoryReason,
  retentionDays: number,
) => invoke<HistorySnapshot>('history_snapshot', { key, text, reason, retentionDays });

/**
 * Keeps what is on disk at each path right now — for files no tab has open,
 * before "replace in files" rewrites them. Resolves with how many new versions
 * were written; files that could not be read are skipped, never an error.
 */
export const historySnapshotFiles = (
  paths: string[],
  reason: HistoryReason,
  retentionDays: number,
) => invoke<number>('history_snapshot_files', { paths, reason, retentionDays });

/** Newest first. A key nobody has written to has no versions, not an error. */
export const historyList = (key: HistoryKey) => invoke<HistoryVersion[]>('history_list', { key });

export const historyRead = (key: HistoryKey, id: string) =>
  invoke<string>('history_read', { key, id });

export const historyDelete = (key: HistoryKey, id: string) =>
  invoke<void>('history_delete', { key, id });

export const historyClear = (key: HistoryKey) => invoke<void>('history_clear', { key });

/** A note saved to a file for the first time, or a file renamed: the versions go along. */
export const historyMove = (from: HistoryKey, to: HistoryKey, retentionDays: number) =>
  invoke<void>('history_move', { from, to, retentionDays });

/** Thins every history and enforces the store's size cap. */
export const historyMaintain = (retentionDays: number) =>
  invoke<HistoryStats>('history_maintain', { retentionDays });

export const historyStats = () => invoke<HistoryStats>('history_stats');

/* ── Note trash ────────────────────────────────────────── */

/**
 * The unsaved text of a tab that was closed without saving. Closing never asks
 * "save or discard?" — the text goes here, next to the session, and comes back
 * from the sidebar or with Ctrl+Shift+T. See `crates/uwunotes-session/src/trash.rs`.
 */
export type TrashNote = {
  name: string;
  path: string | null;
  text: string;
  encoding: EncodingLabel;
  bom: boolean;
  eol: Eol;
  language: string | null;
  /** The `Neu n` number of an untitled note, carried by Rust untouched. */
  untitled?: number | null;
};

export type TrashEntry = TrashNote & {
  /** Minted by Rust; the only thing the page may hand back to name an entry. */
  id: string;
  /** Milliseconds since the epoch. */
  trashedAt: number;
};

/** An entry as the trash lists it: no full text, just the start of it. */
export type TrashSummary = {
  id: string;
  trashedAt: number;
  name: string;
  path: string | null;
  language: string | null;
  /** The text's size in UTF-8 bytes. */
  bytes: number;
  /** The first few thousand characters, for the preview and the search. */
  excerpt: string;
};

/** Only a resolved promise means the text is safe; the tab stays open otherwise. */
export const trashNote = (note: TrashNote) => invoke<TrashSummary>('trash_note', { note });

/** Newest first. Rust sweeps entries past 30 days, 200 entries or its size cap. */
export const listTrash = () => invoke<TrashSummary[]>('list_trash');

export const readTrash = (id: string) => invoke<TrashEntry | null>('read_trash', { id });

export const deleteTrash = (id: string) => invoke<void>('delete_trash', { id });

export const emptyTrash = () => invoke<void>('empty_trash');

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

/** Opens the system's print dialog for what the page currently shows for print. */
export const printPage = () => invoke<void>('print_page');

export const revealInFileManager = (path: string) =>
  invoke<void>('reveal_in_file_manager', { path });

/* ── Updates ───────────────────────────────────────────── */

/**
 * What a look at the update feed found.
 *
 * `failed` is not an error: the command resolves with it. Which of `none` and
 * `failed` the user gets told about is `lib/updates.ts`'s decision, and it
 * depends on whether they asked — see the comment there.
 */
export type UpdateCheck =
  | { status: 'none' }
  | {
      status: 'available';
      version: string;
      /**
       * Whether this copy can install it itself. Only on Windows, where the
       * signed setup replaces the app; elsewhere the hint links the releases page.
       */
      installable: boolean;
      /** The release notes from the feed. Text from elsewhere: never markup. */
      notes: string | null;
    }
  | { status: 'failed'; message: string };

/** Asks the configured feed. The address is Rust's; the page cannot set it. */
export const checkForUpdate = () => invoke<UpdateCheck>('check_for_update');

export type DownloadProgress = {
  received: number;
  /** `null` when the server sent no length, so there is no percentage to show. */
  total: number | null;
};

/**
 * Downloads the update the last {@link checkForUpdate} found and starts the
 * installer.
 *
 * On Windows this promise never resolves: the setup takes over and the app is
 * ended. Everything that has to be on disk must be written before this is
 * called — the window's close guard does not get a turn.
 */
export const installUpdate = (onProgress: (progress: DownloadProgress) => void) => {
  const channel = new Channel<DownloadProgress>();
  channel.onmessage = onProgress;
  return invoke<void>('install_update', { onProgress: channel });
};

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
  /** Not a directory and not an ordinary file: a named pipe, a device. */
  | 'notAFile'
  /** The text has characters the chosen encoding cannot write. */
  | 'unmappable'
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
