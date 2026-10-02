/**
 * The notebook: untitled notes that name themselves, and the note trash.
 *
 * Closing never asks "save or discard?" any more — not the window and not a
 * tab. The window keeps everything through the session and its drafts
 * (`lib/session.ts`); a single tab with unsaved changes hands its text to the
 * trash here, next to the session on disk, and the user gets it back from the
 * sidebar's notebook view, from the toast that says where it went, or with
 * Ctrl+Shift+T. Nobody has to decide between keeping and throwing away at the
 * moment they only wanted a tab gone.
 *
 * This module holds the page's copy of the trash listing (Rust has the
 * entries), the stack Ctrl+Shift+T pops, and the timer that renames an
 * untitled note after its first line. It never asks a question except before
 * emptying the whole trash — the one thing here that destroys text.
 *
 * It does NOT import `lib/files.ts`: files imports this to close tabs, and the
 * restore path below needs nothing from there but a file read.
 */

import type { EditorState } from '@codemirror/state';
import { useSyncExternalStore } from 'react';
import {
  deleteTrash,
  emptyTrash as emptyTrashOnDisk,
  listTrash,
  readTextFile,
  readTrash,
  trashNote,
  type TrashEntry,
  type TrashSummary,
} from './api';
import { createClosedStack } from './closed-tabs';
import {
  docText,
  findByPath,
  getDoc,
  getMeta,
  nextUntitledNumber,
  openDoc,
  openLoadedFile,
  patchMeta,
  setDocState,
  subscribeText,
  untitledName,
  type DocId,
} from './documents';
import { t } from './i18n';
import { noteTitle } from './note-title';
import { ask } from './prompt';
import { toast } from './toast';
import { activateDoc, showDocNext } from './workspace';
import { applyDocLanguage } from '../editor/setup';

/* ── The trash, as the page last saw it ────────────────── */

let trash: readonly TrashSummary[] = [];
const listeners = new Set<() => void>();

function setTrash(next: readonly TrashSummary[]) {
  trash = next;
  for (const listener of listeners) listener();
}

function subscribeTrash(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function trashEntries(): readonly TrashSummary[] {
  return trash;
}

export function useTrash(): readonly TrashSummary[] {
  return useSyncExternalStore(subscribeTrash, trashEntries);
}

/** Reads the listing from disk again. Rust sweeps old entries on every write. */
export async function refreshTrash(): Promise<void> {
  try {
    setTrash(await listTrash());
  } catch {
    // The view keeps what it had. An unreadable trash directory is not worth
    // a toast on every start; restoring an entry reports its own failure.
  }
}

function forgetEntry(id: string) {
  closedTabs.forgetTrash(id);
  if (trash.some((entry) => entry.id === id)) setTrash(trash.filter((entry) => entry.id !== id));
}

/* ── Closing into the trash ────────────────────────────── */

/**
 * What Ctrl+Shift+T brings back, in close order: clean files by path, and
 * tabs with unsaved changes by their trash entry.
 */
export const closedTabs = createClosedStack();

/**
 * Whether closing this tab has to put its text somewhere first.
 *
 * Unsaved changes, yes — except an untitled tab with nothing but whitespace in
 * it, which is not a note anybody will look for.
 */
export function needsTrash(id: DocId): boolean {
  const doc = getDoc(id);
  if (!doc?.meta.dirty) return false;
  if (doc.meta.path === null && doc.state.doc.toString().trim() === '') return false;
  return true;
}

/**
 * Writes a tab's unsaved text to the trash and remembers it for Ctrl+Shift+T.
 *
 * Rejects when the text did not reach the disk; the caller keeps the tab open
 * then, because the tab is the only copy left.
 */
export async function putInTrash(id: DocId): Promise<TrashSummary> {
  const meta = getMeta(id);
  if (!meta) throw new Error(`no document ${id}`);
  const summary = await trashNote({
    name: meta.name,
    path: meta.path,
    text: docText(id),
    encoding: meta.encoding,
    bom: meta.bom,
    eol: meta.eol,
    language: meta.languageOverride,
    untitled: meta.untitled,
  });
  closedTabs.push({ kind: 'trash', id: summary.id });
  // The new entry on top straight away; Rust may also have swept old ones,
  // which the next refresh picks up.
  setTrash([summary, ...trash.filter((entry) => entry.id !== summary.id)]);
  return summary;
}

/**
 * The toast after closing tabs into the trash, with the way back on it. Plain
 * words in both tones: it is about text that is no longer on screen.
 */
export function announceTrashed(entries: readonly TrashSummary[]): void {
  const [only] = entries;
  if (!only) return;
  const label = t('Wiederherstellen');
  if (entries.length === 1) {
    toast('info', t('„{name}“ liegt im Papierkorb', { name: only.name }), {
      label,
      run: () => void restoreTrashed(only.id),
    });
    return;
  }
  toast(
    'info',
    t('{count} ungespeicherte Notizen liegen im Papierkorb', { count: entries.length }),
    {
      label,
      // Oldest first, so the last one closed ends up as the active tab — the
      // same order Ctrl+Shift+T would have produced.
      run: () => {
        void (async () => {
          for (const entry of [...entries].reverse()) await restoreTrashed(entry.id);
        })();
      },
    },
  );
}

/* ── Bringing a note back ──────────────────────────────── */

/**
 * Opens a trash entry as a tab again and then removes it from the trash.
 *
 * In that order: if the delete fails the note is in the trash twice over —
 * once as a tab — which is untidy and loses nothing.
 */
export async function restoreTrashed(id: string): Promise<boolean> {
  let entry: TrashEntry | null;
  try {
    entry = await readTrash(id);
  } catch {
    toast('error', t('Die Notiz ließ sich nicht aus dem Papierkorb holen.'));
    return false;
  }
  if (!entry) {
    // Already gone — restored in another way, or swept for its age.
    forgetEntry(id);
    return false;
  }
  await openTrashed(entry);
  forgetEntry(id);
  await deleteTrash(id).catch(() => undefined);
  return true;
}

/**
 * A trashed note, as a tab with unsaved changes.
 *
 * One with a file that still reads opens that file, with the trashed text as
 * the edit on top — so Ctrl+Z goes back to what is on disk, and the dirty dot
 * is honest. One whose file is gone, or never existed, opens as text without a
 * disk copy behind it, exactly like a restored draft.
 */
async function openTrashed(entry: TrashEntry): Promise<DocId> {
  if (entry.path) {
    const open = findByPath(entry.path);
    const doc = open ? getDoc(open) : undefined;
    if (open && doc && !doc.meta.dirty) {
      setDocState(open, withText(doc.state, entry.text));
      activateDoc(open);
      return open;
    }
    // Open with edits of its own: those are not overwritten. The trashed text
    // comes back beside it as a note of its own instead.
    if (!open) {
      const file = await readTextFile(entry.path).catch(() => null);
      if (file) {
        const id = openLoadedFile(file, entry.name);
        const loaded = getDoc(id);
        if (loaded) setDocState(id, withText(loaded.state, entry.text));
        patchMeta(id, {
          encoding: entry.encoding,
          bom: entry.bom,
          eol: entry.eol,
          languageOverride: entry.language,
        });
        showDocNext(id);
        await applyDocLanguage(id);
        return id;
      }
      const id = openDoc({
        path: entry.path,
        name: entry.name,
        text: entry.text,
        encoding: entry.encoding,
        bom: entry.bom,
        eol: entry.eol,
        languageOverride: entry.language,
        dirty: true,
      });
      showDocNext(id);
      await applyDocLanguage(id);
      return id;
    }
  }

  // A fresh number rather than the stored one: the old `Neu 3` may well be
  // taken by now, and the name comes from the first line anyway.
  const untitled = nextUntitledNumber();
  const id = openDoc({
    path: null,
    name: noteTitle(entry.text) ?? untitledName(untitled),
    untitled,
    text: entry.text,
    encoding: entry.encoding,
    bom: entry.bom,
    eol: entry.eol,
    languageOverride: entry.language,
    dirty: true,
  });
  showDocNext(id);
  await applyDocLanguage(id);
  return id;
}

function withText(state: EditorState, text: string): EditorState {
  return state.update({ changes: { from: 0, to: state.doc.length, insert: text } }).state;
}

/* ── Deleting for good ─────────────────────────────────── */

export async function deleteTrashed(id: string): Promise<void> {
  try {
    await deleteTrash(id);
    forgetEntry(id);
  } catch {
    toast('error', t('Die Notiz ließ sich nicht löschen.'));
  }
}

/**
 * Empties the trash after a plain question. Destructive, so no joke and no
 * Nyu, and the safe answer is the last one, where Escape lands.
 */
export async function emptyTrashAsked(): Promise<void> {
  await refreshTrash();
  if (trash.length === 0) return;
  const answer = await ask(
    t('Papierkorb leeren?'),
    trash.length === 1
      ? t('Eine Notiz wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.')
      : t('{count} Notizen werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.', {
          count: trash.length,
        }),
    [
      { id: 'empty', label: t('Endgültig löschen'), tone: 'danger' },
      { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
    ],
  );
  if (answer !== 'empty') return;
  try {
    await emptyTrashOnDisk();
  } catch {
    toast('error', t('Der Papierkorb ließ sich nicht vollständig leeren.'));
  }
  for (const entry of trash) closedTabs.forgetTrash(entry.id);
  await refreshTrash();
}

/* ── Untitled notes name themselves ────────────────────── */

/** After the typing stops, not on every key: a tab label that flickers is noise. */
const TITLE_DELAY_MS = 600;

const titleTimers = new Map<DocId, number>();

function scheduleTitle(id: DocId) {
  if (getMeta(id)?.path !== null) return;
  window.clearTimeout(titleTimers.get(id));
  titleTimers.set(
    id,
    window.setTimeout(() => {
      titleTimers.delete(id);
      applyNoteTitle(id);
    }, TITLE_DELAY_MS),
  );
}

/**
 * Names an untitled note after its first line, or back to `Neu n` once that
 * line is gone. A document with a file keeps its file name.
 */
export function applyNoteTitle(id: DocId): void {
  const doc = getDoc(id);
  if (!doc || doc.meta.path !== null) return;
  const fallback = doc.meta.untitled === null ? doc.meta.name : untitledName(doc.meta.untitled);
  const name = noteTitle(doc.state.doc.sliceString(0, 4_000)) ?? fallback;
  if (name !== doc.meta.name) patchMeta(id, { name });
}

/** Starts the title timer and loads the trash listing. Returns the teardown. */
export function startNotebook(): () => void {
  const stop = subscribeText(scheduleTitle);
  void refreshTrash();
  return () => {
    stop();
    for (const timer of titleTimers.values()) window.clearTimeout(timer);
    titleTimers.clear();
  };
}
