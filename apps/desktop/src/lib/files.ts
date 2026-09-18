/**
 * The file lifecycle: open, save, save as, close, reload, change the encoding.
 *
 * This is the only module in the app allowed to ask the user a question, and it
 * asks a lot of them, because every one of them is a place where a text editor
 * can silently destroy work: a file that changed on disk between opening and
 * saving, a buffer with unsaved changes about to be closed, a "text" file that
 * is actually a JPEG. The stores in `lib/documents.ts` and `lib/workspace.ts`
 * stay dumb on purpose — a store that can open a dialog is a store that cannot
 * be tested — and every guard lives here instead.
 *
 * It does NOT know what an editor looks like. It reaches for a CodeMirror view
 * only through `lib/views.ts`, and only to keep what is on screen identical to
 * what went to disk.
 */

import {
  asApiError,
  dropDraft,
  fileStatus,
  pathInfo,
  pickFiles,
  pickFolder,
  pickSavePath,
  readTextFile,
  writeTextFile,
  type ApiError,
  type EncodingLabel,
  type Eol,
  type FileStamp,
} from './api';
import { COMMON_ENCODINGS, encodingName, EOL_LABELS } from './encodings';
import {
  allDocs,
  forgetSavedText,
  getDoc,
  getMeta,
  findByPath,
  markReloaded,
  markSaved,
  openLoadedFile,
  openUntitled,
  patchMeta,
  setDocState,
  type DocId,
  type DocMeta,
} from './documents';
import { t } from './i18n';
import type { PaneId } from './layout';
import { ask } from './prompt';
import { getSettings, subscribeSettings, type Settings } from './settings';
import { playError, playSaved } from './sound';
import { toast } from './toast';
import { viewFor } from './views';
import {
  closeTab,
  getPane,
  getWorkspace,
  paneOf,
  rememberFile,
  setFolder,
  showDoc,
  showDocNext,
} from './workspace';
import { applyDocLanguage } from '../editor/setup';
import type { ChangeSpec, EditorState } from '@codemirror/state';

/* ── Opening ───────────────────────────────────────────── */

/**
 * Opens each path in turn, one await at a time.
 *
 * Sequential rather than parallel because opening can ask questions, and three
 * dialogs racing each other for the same modal slot is how a "open all" turns
 * into a guessing game.
 */
export async function openPaths(paths: string[], pane?: PaneId): Promise<void> {
  for (const path of paths) await openOnePath(path, pane);
}

async function openOnePath(path: string, pane?: PaneId): Promise<DocId | null> {
  const already = findByPath(path);
  if (already) {
    // Already open: reveal the tab it is in. A second copy would be a second
    // undo history for one file, and the loser is whichever one saves last.
    showDoc(already, pane);
    return already;
  }

  const resolved = await pathInfo(path).catch((error: unknown) => {
    reportFileError(error, path);
    return null;
  });
  if (!resolved) return null;

  // Dropping a folder onto the window means "open this project", not "decode
  // a directory as text".
  if (resolved.isDir) {
    openFolder(resolved.path);
    return null;
  }

  const reopened = findByPath(resolved.path);
  if (reopened) {
    showDoc(reopened, pane);
    return reopened;
  }

  const file = await readTextFile(resolved.path).catch((error: unknown) => {
    reportFileError(error, resolved.path);
    return null;
  });
  if (!file) return null;

  if (file.binary) {
    const answer = await ask(
      t('Binärdatei öffnen?'),
      t(
        '{name} enthält Nullbytes und ist mit ziemlicher Sicherheit keine Textdatei. Ansehen geht, aber Speichern kann sie unbrauchbar machen.',
        { name: resolved.name },
      ),
      [
        { id: 'open', label: t('Trotzdem öffnen'), tone: 'danger' },
        { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
      ],
    );
    if (answer !== 'open') return null;
  }

  const id = openLoadedFile(file, resolved.name);
  showDoc(id, pane);
  rememberFile(resolved.path);
  await applyDocLanguage(id);

  if (file.lossy) {
    toast(
      'error',
      t('{name} ließ sich nicht sauber dekodieren — einzelne Zeichen wurden ersetzt.', {
        name: resolved.name,
      }),
      {
        label: t('Anders öffnen…'),
        run: () => {
          void promptReopenEncoding(id);
        },
      },
    );
  } else if (file.mixedEol) {
    toast(
      'info',
      t('{name} mischt Zeilenenden. Gespeichert wird als {eol}.', {
        name: resolved.name,
        eol: EOL_LABELS[file.eol],
      }),
    );
  }

  return id;
}

export async function openFileDialog(): Promise<void> {
  const paths = await pickFiles().catch((error: unknown) => {
    reportFileError(error, null);
    return [];
  });
  if (paths.length > 0) await openPaths(paths);
}

export async function openFolderDialog(): Promise<void> {
  const folder = await pickFolder().catch((error: unknown) => {
    reportFileError(error, null);
    return null;
  });
  if (folder) openFolder(folder);
}

/** The project folder in the sidebar. Files already open stay open. */
export function openFolder(path: string): void {
  setFolder(path);
}

/** A fresh buffer, next to the tab the user is on rather than at the far right. */
export function newFile(): void {
  showDocNext(openUntitled());
}

/* ── Saving ────────────────────────────────────────────── */

/** Whether a save may stop and ask, and whether it is allowed to make a noise. */
type SaveMode = {
  saveAs: boolean;
  /** Autosave: never ask, never chirp. A conflict marks the tab stale instead. */
  silent: boolean;
};

export function saveDoc(id: DocId, saveAs = false): Promise<boolean> {
  return save(id, { saveAs, silent: false });
}

async function save(id: DocId, mode: SaveMode): Promise<boolean> {
  const initial = getMeta(id);
  if (!initial) return false;

  if (initial.binary && !mode.silent) {
    const answer = await ask(
      t('Binärdatei speichern?'),
      t(
        '{name} wurde als Binärdatei erkannt. Der Text wird neu kodiert geschrieben, was den ursprünglichen Inhalt zerstören kann.',
        { name: initial.name },
      ),
      [
        { id: 'save', label: t('Trotzdem speichern'), tone: 'danger' },
        { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
      ],
    );
    if (answer !== 'save') return false;
  }

  const known = getMeta(id);
  if (!known) return false;

  let path = known.path;
  if (mode.saveAs || !path) {
    if (mode.silent) return false;
    const picked = await pickPathFor(known);
    if (!picked) return false;
    path = picked;
  } else if (known.readOnly) {
    if (mode.silent) return false;
    const answer = await ask(
      t('Datei ist schreibgeschützt'),
      t(
        '{name} ist auf dem Datenträger schreibgeschützt. Der Schreibversuch scheitert vermutlich.',
        {
          name: known.name,
        },
      ),
      [
        { id: 'try', label: t('Trotzdem versuchen'), tone: 'danger' },
        { id: 'saveAs', label: t('Speichern unter…'), tone: 'primary' },
        { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
      ],
    );
    if (answer === 'cancel') return false;
    if (answer === 'saveAs') return save(id, { saveAs: true, silent: false });
  }

  // The fixups run on the editor as well as on the outgoing text, so what is on
  // screen after a save is exactly what landed on disk. Silently differing by a
  // trailing space is how a diff gains a line nobody typed.
  const text = applySaveFixups(id);

  const meta = getMeta(id);
  if (!meta) return false;
  const newPath = meta.path === null || meta.path !== path;
  // A path the user picked in the save dialog has already been confirmed for
  // overwriting there, so there is no stamp to hold Rust to.
  let expectedStamp: FileStamp | null = newPath ? null : meta.stamp;
  // Both start as "not authorised" and can only be turned on by the user
  // answering a question below. `encoding` is a local because switching to
  // UTF-8 has to reach the very next attempt, not the next save.
  let encoding = meta.encoding;
  let allowUnmappable = false;

  // Three attempts at most, and each extra one is a question the user
  // answered: overwrite the changed file, and write the characters this
  // encoding cannot hold.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const written = await writeTextFile({
        path,
        text,
        encoding,
        bom: meta.bom,
        eol: meta.eol,
        expectedStamp,
        allowUnmappable,
      });
      if (encoding !== meta.encoding) patchMeta(id, { encoding });
      markSaved(id, path, await fileNameOf(path), written.stamp);
      rememberFile(path);
      void dropDraft(id).catch(() => undefined);
      if (newPath) await applyDocLanguage(id);
      if (!mode.silent) playSaved();
      return true;
    } catch (error) {
      const failure = asApiError(error);
      if (failure.kind === 'unmappable') {
        // The file's encoding cannot write something in the buffer — an arrow
        // or an emoji in a Windows-1252 file, say. Rust refused rather than
        // writing `&#8594;` and calling it a success, so nothing on disk has
        // changed yet and the choice is still the user's.
        if (mode.silent) return false;
        const answer = await ask(
          t('Zeichen passen nicht zur Kodierung'),
          t(
            '{name} wird als {encoding} gespeichert, und diese Kodierung kann nicht alle Zeichen im Text darstellen. Als UTF-8 bleibt alles erhalten; sonst werden die fehlenden Zeichen als „&#8594;“ geschrieben.',
            { name: meta.name, encoding: encodingName(encoding) },
          ),
          [
            { id: 'utf8', label: t('Als UTF-8 speichern'), tone: 'primary' },
            { id: 'anyway', label: t('Trotzdem speichern'), tone: 'danger' },
            { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
          ],
        );
        if (answer === 'utf8') encoding = 'UTF-8';
        else if (answer === 'anyway') allowUnmappable = true;
        else return false;
        continue;
      }
      if (failure.kind !== 'changed') {
        reportFileError(error, path);
        return false;
      }
      if (mode.silent) {
        // Autosave does not get to decide whose version wins.
        patchMeta(id, { staleOnDisk: true });
        return false;
      }
      const answer = await ask(
        t('Die Datei hat sich auf dem Datenträger geändert'),
        t('{name} wurde von einem anderen Programm verändert, seit sie hier geöffnet wurde.', {
          name: meta.name,
        }),
        [
          { id: 'overwrite', label: t('Überschreiben'), tone: 'danger' },
          { id: 'reload', label: t('Neu laden'), tone: 'primary' },
          { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
        ],
      );
      if (answer === 'reload') {
        await reloadFromDisk(id);
        return false;
      }
      if (answer !== 'overwrite') return false;
      expectedStamp = null;
    }
  }
  return false;
}

/**
 * Saves every dirty document.
 *
 * Carries on past a file that failed rather than stopping: the user asked for
 * all of them, and the eight that can be written should be. One summary at the
 * end beats eight toasts.
 */
export async function saveAll(): Promise<void> {
  const pending = allDocs()
    .map((doc) => doc.meta)
    .filter((meta) => meta.dirty);
  if (pending.length === 0) return;

  let saved = 0;
  const failed: string[] = [];
  for (const meta of pending) {
    if (await save(meta.id, { saveAs: false, silent: false })) saved += 1;
    else failed.push(meta.name);
  }

  if (failed.length === 0) {
    playSaved();
    toast('success', t('{count} Dateien gespeichert.', { count: saved }));
  } else {
    playError();
    toast('error', t('Nicht gespeichert: {names}', { names: failed.join(', ') }));
  }
}

async function pickPathFor(meta: DocMeta): Promise<string | null> {
  const startIn = meta.path ? await parentOf(meta.path) : getWorkspace().folder;
  try {
    return await pickSavePath(meta.name, startIn);
  } catch (error) {
    reportFileError(error, null);
    return null;
  }
}

/* ── Save fixups ───────────────────────────────────────── */

/**
 * The edits `trimTrailingWhitespaceOnSave` and `ensureFinalNewlineOnSave` want,
 * in ascending order and never overlapping.
 *
 * The final newline is folded into the last line's trim rather than added as a
 * separate insertion, because two edits that meet at the same offset are one
 * edit as far as a `ChangeSet` is concerned.
 */
function saveFixups(state: EditorState, settings: Settings): ChangeSpec[] {
  if (!settings.trimTrailingWhitespaceOnSave && !settings.ensureFinalNewlineOnSave) return [];
  const changes: ChangeSpec[] = [];
  const lastLine = state.doc.lines;
  for (let number = 1; number <= lastLine; number += 1) {
    const line = state.doc.line(number);
    const kept = settings.trimTrailingWhitespaceOnSave
      ? line.text.replace(/[ \t]+$/, '')
      : line.text;
    // An empty last line already ends the file with a newline; adding another
    // one every save would grow the file by a line a day.
    const insert =
      settings.ensureFinalNewlineOnSave && number === lastLine && kept.length > 0 ? '\n' : '';
    if (kept.length === line.text.length && !insert) continue;
    changes.push({ from: line.from + kept.length, to: line.to, insert });
  }
  return changes;
}

/** Applies the fixups wherever the document lives and returns the text to write. */
function applySaveFixups(id: DocId): string {
  const doc = getDoc(id);
  if (!doc) return '';
  const changes = saveFixups(doc.state, getSettings());
  if (changes.length === 0) return doc.state.doc.toString();

  const view = viewForDoc(id);
  if (view && view.state === doc.state) {
    // Through the view, so the caret is mapped across the deletions instead of
    // jumping to the top of the file.
    view.dispatch({ changes });
    setDocState(id, view.state);
    return view.state.doc.toString();
  }

  const next = doc.state.update({ changes }).state;
  setDocState(id, next);
  return next.doc.toString();
}

/** The editor showing this document right now, if one is. */
function viewForDoc(id: DocId) {
  const pane = paneOf(id);
  if (!pane || getPane(pane)?.active !== id) return undefined;
  return viewFor(pane);
}

/* ── Closing ───────────────────────────────────────────── */

export async function closeDocSafely(id: DocId): Promise<boolean> {
  const meta = getMeta(id);
  if (!meta) return true;

  if (meta.dirty) {
    const answer = await ask(
      t('Ungespeicherte Änderungen'),
      t('{name} wurde geändert. Vor dem Schließen speichern?', { name: meta.name }),
      [
        { id: 'save', label: t('Speichern'), tone: 'primary' },
        { id: 'discard', label: t('Verwerfen'), tone: 'danger' },
        { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
      ],
    );
    if (answer === 'cancel') return false;
    if (answer === 'save' && !(await save(id, { saveAs: false, silent: false }))) return false;
  }

  rememberClosed(id);
  // Closing on purpose is the one moment a draft becomes garbage: the user
  // either saved it or said to throw it away.
  void dropDraft(id).catch(() => undefined);
  closeTab(id);
  return true;
}

/**
 * Closes everything, asking once per dirty file.
 *
 * The first Cancel stops the whole run — half a "close all" is not what anyone
 * meant by it, and the tabs already closed are gone either way.
 */
export async function closeAllSafely(): Promise<boolean> {
  for (const doc of [...allDocs()]) {
    if (!(await closeDocSafely(doc.meta.id))) return false;
  }
  return true;
}

/** Closed tabs that could be brought back, most recent last. Paths only. */
const closedPaths: string[] = [];
const CLOSED_LIMIT = 20;

function rememberClosed(id: DocId) {
  const path = getMeta(id)?.path;
  // An untitled buffer has nothing on disk to reopen from; its draft is the
  // session's problem, not this stack's.
  if (!path) return;
  closedPaths.push(path);
  if (closedPaths.length > CLOSED_LIMIT) closedPaths.shift();
}

export function hasClosedTabs(): boolean {
  return closedPaths.length > 0;
}

/** Ctrl+Shift+T, the shortcut everybody learns by accident and then relies on. */
export async function reopenClosedTab(): Promise<void> {
  const path = closedPaths.pop();
  if (path) await openPaths([path]);
}

/* ── Reloading and disk changes ────────────────────────── */

export async function reloadDoc(id: DocId): Promise<void> {
  const meta = getMeta(id);
  if (!meta?.path) return;
  if (meta.dirty && !(await confirmDiscard(meta))) return;
  await reloadFromDisk(id);
}

/** No questions. For the paths where the user has already answered one. */
async function reloadFromDisk(id: DocId, encoding?: EncodingLabel): Promise<boolean> {
  const meta = getMeta(id);
  if (!meta?.path) return false;
  try {
    const file = await readTextFile(meta.path, encoding);
    markReloaded(id, file);
    await applyDocLanguage(id);
    return true;
  } catch (error) {
    reportFileError(error, meta.path);
    return false;
  }
}

async function confirmDiscard(meta: DocMeta): Promise<boolean> {
  const answer = await ask(
    t('Neu laden und Änderungen verwerfen?'),
    t('{name} hat ungespeicherte Änderungen, die dabei verloren gehen.', { name: meta.name }),
    [
      { id: 'reload', label: t('Neu laden'), tone: 'danger' },
      { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
    ],
  );
  return answer === 'reload';
}

let diskCheckRunning = false;

/**
 * Compares every open file against what is on disk. Run on window focus.
 *
 * Three outcomes, and none of them is a dialog: a changed file with no local
 * edits reloads itself, a changed file with local edits gets a flag and one
 * toast, and a file that is simply gone is kept alive by forcing the dirty flag
 * on. Prompting here would mean a stack of modals after every alt-tab.
 */
export async function checkDiskChanges(): Promise<void> {
  if (diskCheckRunning) return;
  diskCheckRunning = true;
  try {
    for (const doc of [...allDocs()]) {
      const meta = doc.meta;
      if (!meta.path || !meta.stamp) continue;

      // `undefined` is "could not look", `null` is "is not there any more".
      // Collapsing the two would turn a locked file into a deleted one.
      const stamp = await fileStatus(meta.path).catch(() => undefined);
      if (stamp === undefined) continue;

      if (stamp === null) {
        forgetSavedText(meta.id);
        toast(
          'error',
          t(
            '{name} ist vom Datenträger verschwunden. Der Tab bleibt als ungespeicherte Datei offen.',
            {
              name: meta.name,
            },
          ),
        );
        continue;
      }

      if (stamp.readOnly !== meta.readOnly) patchMeta(meta.id, { readOnly: stamp.readOnly });
      if (stamp.mtimeMs === meta.stamp.mtimeMs && stamp.size === meta.stamp.size) continue;

      if (!meta.dirty) {
        await reloadFromDisk(meta.id);
        continue;
      }
      // Already flagged and already mentioned: alt-tabbing twice is not consent
      // to be told twice.
      if (meta.staleOnDisk) continue;
      patchMeta(meta.id, { staleOnDisk: true });
      toast(
        'error',
        t('{name} wurde extern geändert und hat hier ungespeicherte Änderungen.', {
          name: meta.name,
        }),
        {
          label: t('Neu laden'),
          run: () => {
            void reloadDoc(meta.id);
          },
        },
      );
    }
  } finally {
    diskCheckRunning = false;
  }
}

/* ── Encoding and line endings ─────────────────────────── */

/**
 * Reads the file again with a different encoding.
 *
 * For the case where detection guessed wrong and the text came out as
 * question marks. The bytes on disk are untouched; only the decoding changes.
 */
export async function reopenWithEncoding(id: DocId, encoding: string): Promise<void> {
  const meta = getMeta(id);
  if (!meta?.path) return;
  if (meta.dirty && !(await confirmDiscard(meta))) return;
  await reloadFromDisk(id, encoding);
}

async function promptReopenEncoding(id: DocId): Promise<void> {
  const meta = getMeta(id);
  if (!meta?.path) return;
  const answer = await ask(meta.name, t('Mit welcher Kodierung neu öffnen?'), [
    ...COMMON_ENCODINGS.map((label) => ({ id: label, label: encodingName(label) })),
    { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' as const },
  ]);
  if (answer !== 'cancel') await reopenWithEncoding(id, answer);
}

/**
 * Changes how the document will be *written*, without re-reading it.
 *
 * The other half of the encoding menu: this one is "save this as Windows-1252",
 * not "I opened it wrong".
 */
export function setDocEncoding(id: DocId, encoding: string): void {
  const meta = getMeta(id);
  if (!meta || meta.encoding === encoding) return;
  patchMeta(id, { encoding });
  toast(
    'info',
    t('Wird beim nächsten Speichern als {encoding} geschrieben.', {
      encoding: encodingName(encoding),
    }),
  );
}

/** UTF-8 with or without a byte order mark; the encoding itself is unchanged. */
export function setDocBom(id: DocId, bom: boolean): void {
  const meta = getMeta(id);
  if (!meta || meta.bom === bom) return;
  patchMeta(id, { bom });
}

export function setDocEol(id: DocId, eol: Eol): void {
  const meta = getMeta(id);
  if (!meta || meta.eol === eol) return;
  // Picking one settles the mixed-endings question, which is what the user just
  // did by picking one.
  patchMeta(id, { eol, mixedEol: false });
  toast('info', t('Zeilenenden ab jetzt: {eol}', { eol: EOL_LABELS[eol] }));
}

/* ── Background work ───────────────────────────────────── */

/**
 * Starts the disk check on focus and the autosave timer. Called once from
 * `main.tsx`; returns the teardown.
 */
export function startFileWatchers(): () => void {
  const onFocus = () => {
    void checkDiskChanges();
  };
  window.addEventListener('focus', onFocus);

  let timer = 0;
  const arm = () => {
    window.clearInterval(timer);
    timer = 0;
    const seconds = getSettings().autosaveSeconds;
    if (seconds > 0) {
      timer = window.setInterval(() => {
        void autosave();
      }, seconds * 1_000);
    }
  };
  arm();
  const stopSettings = subscribeSettings(arm);

  return () => {
    window.removeEventListener('focus', onFocus);
    window.clearInterval(timer);
    stopSettings();
  };
}

/**
 * Writes out every dirty document that can be written without a question.
 *
 * Everything else is skipped on purpose: an untitled buffer would need a
 * dialog, a stale one would need a decision, a read-only or binary one would
 * need permission. Autosave is allowed to be quiet, not to be presumptuous.
 */
async function autosave(): Promise<void> {
  for (const doc of [...allDocs()]) {
    const meta = doc.meta;
    if (!meta.path || !meta.dirty) continue;
    if (meta.staleOnDisk || meta.readOnly || meta.binary) continue;
    await save(meta.id, { saveAs: false, silent: true });
  }
}

/* ── Errors ────────────────────────────────────────────── */

/** A sentence a person can act on, from the `kind` Rust sent. */
export function describeApiError(error: ApiError, fallbackPath: string | null): string {
  const name = baseName(error.path ?? fallbackPath ?? '');
  switch (error.kind) {
    case 'notFound':
      return t('{name} wurde nicht gefunden.', { name });
    case 'permission':
      return t('Keine Berechtigung für {name}.', { name });
    case 'changed':
      return t('{name} hat sich auf dem Datenträger geändert.', { name });
    case 'tooLarge':
      return t('{name} ist zu groß, um sie hier zu öffnen.', { name });
    case 'isDirectory':
      return t('{name} ist ein Ordner, keine Datei.', { name });
    case 'notAFile':
      return t('{name} ist keine gewöhnliche Datei.', { name });
    case 'unmappable':
      return t('{name}: Die Kodierung kann nicht alle Zeichen im Text darstellen.', { name });
    case 'encoding':
      return t('{name} ließ sich nicht dekodieren.', { name });
    case 'invalidRegex':
      return t('Der Suchausdruck ist kein gültiger regulärer Ausdruck.');
    case 'other':
      return name
        ? t('{name}: {message}', { name, message: error.message })
        : t('Fehler: {message}', { message: error.message });
  }
}

function reportFileError(error: unknown, path: string | null): void {
  toast('error', describeApiError(asApiError(error), path));
  playError();
}

/* ── Path odds and ends ────────────────────────────────── */

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Rust owns the separator, but a failed round-trip must not fail a save. */
async function fileNameOf(path: string): Promise<string> {
  try {
    return (await pathInfo(path)).name;
  } catch {
    return baseName(path);
  }
}

async function parentOf(path: string): Promise<string | null> {
  try {
    return (await pathInfo(path)).parent;
  } catch {
    return null;
  }
}
