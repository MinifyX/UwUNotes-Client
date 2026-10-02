/**
 * Zeitreise: when a version is taken, and what the timeline can do with one.
 *
 * Rust keeps the versions (`uwunotes-history`): compressed, deduplicated,
 * thinned out over time, under a size cap. This module decides the moments:
 *
 * - **every successful save** — `lib/files.ts` calls {@link afterSave};
 * - **before a buffer is thrown away** — a reload from disk, a file changed
 *   by another program, a restore from this very timeline;
 * - **before "replace in files"** rewrites files, open or not, and before a
 *   save overwrites another program's change ({@link snapshotFilesOnDisk}),
 *   read from disk on the Rust side;
 * - **every few minutes while somebody types**, for dirty documents and for
 *   notes that were never saved anywhere ({@link startHistoryTimer}).
 *
 * Cheap on purpose. A CodeMirror `Text` is immutable, so "has this changed
 * since the last version?" is an identity check against the `Text` that was
 * last sent, and the IPC call is skipped entirely when it has not. Rust
 * deduplicates again by hash, which covers what identity cannot see — a text
 * typed back to exactly what it was.
 *
 * A history belongs to a file by its path, or to an untitled note by its
 * document id; when a note is saved for the first time, its versions move to
 * the file.
 *
 * What this module deliberately does not do: ask a playful question. Every
 * confirmation here can cost text, so every one is plain (KONZEPT, Tonfall).
 */

import type { ChangeSpec, Text } from '@codemirror/state';
import { useSyncExternalStore } from 'react';
import {
  asApiError,
  historyClear,
  historyDelete,
  historyList,
  historyMaintain,
  historyMove,
  historyRead,
  historySnapshot,
  historySnapshotFiles,
  type HistoryKey,
  type HistoryReason,
  type HistorySnapshot,
  type HistoryVersion,
} from './api';
import { setSidebarView } from './chrome';
import type { Command } from './commands';
import { allDocs, getDoc, getMeta, openUntitled, setDocState, type DocId } from './documents';
import { locale, N_, t, translate, type Language } from './i18n';
import { ask } from './prompt';
import { getSettings } from './settings';
import { toast } from './toast';
import { viewFor } from './views';
import { activateDoc, activeDocId, getPane, paneOf, showDocNext } from './workspace';

/* ── Keys ──────────────────────────────────────────────── */

/** A file's history by its path; a never-saved buffer's by its document id. */
export function historyKeyOf(meta: { id: DocId; path: string | null }): HistoryKey {
  return meta.path ? { kind: 'path', path: meta.path } : { kind: 'note', id: meta.id };
}

function keyString(key: HistoryKey): string {
  return key.kind === 'path' ? `path:${key.path}` : `note:${key.id}`;
}

/* ── Who wants to know ─────────────────────────────────── */

/**
 * Bumped whenever a history changed, so the timeline reloads its list. The
 * text itself never goes through here — a timeline that re-rendered on every
 * keystroke would be the one thing in the window that did.
 */
let revision = 0;
const listeners = new Set<() => void>();

function announce() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHistoryRevision(): number {
  return useSyncExternalStore(subscribeHistory, () => revision);
}

/* ── Taking a version ──────────────────────────────────── */

/**
 * Past this many UTF-16 units the text is over Rust's five megabytes anyway,
 * and sending it across the bridge only to be told so is the expensive part.
 */
const MAX_SNAPSHOT_UNITS = 5 * 1024 * 1024;

/** The `Text` each history last received, by {@link keyString}. */
const lastSent = new Map<string, Text>();

function retentionDays(): number {
  return getSettings().historyRetentionDays;
}

/**
 * Sends one version to Rust. `force` is for the restore path, which keeps the
 * text it is about to replace even with the feature switched off: that one
 * version is what makes the restore itself undoable from the timeline.
 */
async function send(
  key: HistoryKey,
  text: string,
  reason: HistoryReason,
  force = false,
): Promise<HistorySnapshot | null> {
  if (!force && !getSettings().history) return null;
  if (text.length > MAX_SNAPSHOT_UNITS) return { status: 'skipped' };
  try {
    const result = await historySnapshot(key, text, reason, retentionDays());
    if (result.status === 'created') announce();
    return result;
  } catch (error) {
    // A version that could not be written is a version missing from the
    // timeline. Interrupting a save or a reload over it would be worse.
    console.warn('Zeitreise: no version kept', asApiError(error).message);
    return null;
  }
}

/**
 * Keeps what a document shows right now as a version.
 *
 * The text is taken synchronously, before the first `await`, so a caller that
 * is about to replace the buffer can fire this and carry on: what gets kept is
 * the text as it was at the call, whatever happens next.
 */
export async function snapshotDoc(
  id: DocId,
  reason: HistoryReason,
  force = false,
): Promise<HistorySnapshot['status'] | null> {
  const doc = getDoc(id);
  if (!doc) return null;
  const key = historyKeyOf(doc.meta);
  const name = keyString(key);
  const text = doc.state.doc;
  const previous = lastSent.get(name);
  // Identity first, which is free; `eq` second, which compares lengths before
  // it walks anything. A forced version always asks Rust, which knows whether
  // the newest version on disk really is this text.
  if (!force && previous && (previous === text || previous.eq(text))) return 'unchanged';
  lastSent.set(name, text);
  const result = await send(key, text.toString(), reason, force);
  if (!result && lastSent.get(name) === text) lastSent.delete(name);
  return result?.status ?? null;
}

/** When each history last got a version from an autosave, by {@link keyString}. */
const lastAutosave = new Map<string, number>();

/**
 * After a successful write. `previousPath` is the document's path before the
 * save: `null` means a note just got a file, and its versions move along
 * before the saved text joins them, so the order on the timeline stays true.
 *
 * An autosave (`silent`) keeps a version at most every few minutes, like the
 * typing timer does. Autosave every thirty seconds would otherwise fill a
 * history's hundred places within the hour and push yesterday out of it.
 */
export async function afterSave(
  id: DocId,
  previousPath: string | null,
  text: string,
  silent = false,
) {
  const meta = getMeta(id);
  if (!meta?.path) return;
  const key: HistoryKey = { kind: 'path', path: meta.path };
  if (previousPath === null) {
    const note: HistoryKey = { kind: 'note', id };
    lastSent.delete(keyString(note));
    // Even with the feature off: versions that already exist belong to the
    // file now, and leaving them under a document id strands them.
    await historyMove(note, key, retentionDays()).catch(() => undefined);
    announce();
  }
  const name = keyString(key);
  const now = Date.now();
  if (silent && now - (lastAutosave.get(name) ?? 0) < AUTO_INTERVAL_MS) return;
  if (silent) lastAutosave.set(name, now);
  const saved = getDoc(id)?.savedDoc;
  const result = await send(key, text, 'save');
  if (result && saved) lastSent.set(keyString(key), saved);
}

/** A file was renamed on disk: its versions follow it. */
export async function moveHistoryForRename(from: string, to: string) {
  lastSent.delete(keyString({ kind: 'path', path: from }));
  await historyMove(
    { kind: 'path', path: from },
    { kind: 'path', path: to },
    retentionDays(),
  ).catch(() => undefined);
  announce();
}

/**
 * Before something rewrites `paths` on disk — "replace in files", or a save
 * that overwrites another program's change: what is there now becomes a
 * version, read by Rust so a closed file costs no trip through the page. Open
 * files get the same treatment, because the rewrite replaces their disk text,
 * not their buffer.
 */
export async function snapshotFilesOnDisk(
  paths: string[],
  reason: 'before-replace' | 'external-change',
): Promise<void> {
  if (!getSettings().history || paths.length === 0) return;
  // The disk text becomes the newest version of each file, so what the page
  // last sent for them no longer is.
  for (const path of paths) lastSent.delete(keyString({ kind: 'path', path }));
  try {
    const created = await historySnapshotFiles(paths, reason, retentionDays());
    if (created > 0) announce();
  } catch (error) {
    console.warn('Zeitreise: files not kept before replacing', asApiError(error).message);
  }
}

/* ── While somebody types ──────────────────────────────── */

/** How often the timer looks. Cheap: an identity check per open document. */
const TICK_MS = 15_000;
/** A pause this long counts as "stopped typing". */
export const IDLE_MS = 30_000;
/** At most one automatic version per document this often… */
export const AUTO_INTERVAL_MS = 5 * 60_000;
/** …and at least one this often, for somebody who never pauses. */
export const MAX_WAIT_MS = 15 * 60_000;
/** The first maintenance pass, once the start-up rush is over. */
const MAINTAIN_DELAY_MS = 90_000;

/**
 * Whether a dirty document is due an automatic version. `changedAt` is when
 * its text was last seen to change; `since` when it last got a version, or
 * when it first changed after one.
 */
export function autoSnapshotDue(changedAt: number, since: number, now: number): boolean {
  if (now - since >= MAX_WAIT_MS) return true;
  return now - changedAt >= IDLE_MS && now - since >= AUTO_INTERVAL_MS;
}

type Watch = { text: Text; changedAt: number; since: number };

/**
 * Starts the automatic versions and one maintenance pass. Called once from
 * `startFileWatchers()`; returns the teardown.
 */
export function startHistoryTimer(): () => void {
  const watched = new Map<DocId, Watch>();

  const tick = () => {
    const now = Date.now();
    const alive = new Set<DocId>();
    for (const doc of allDocs()) {
      const id = doc.meta.id;
      alive.add(id);
      const text = doc.state.doc;
      const seen = watched.get(id);
      if (!seen) {
        watched.set(id, { text, changedAt: now, since: now });
        continue;
      }
      if (!doc.meta.dirty) {
        // Clean text is on disk and was kept when it was saved. The clock for
        // the next automatic version starts when it stops being clean.
        watched.set(id, { text, changedAt: now, since: now });
        continue;
      }
      if (seen.text !== text) {
        seen.text = text;
        seen.changedAt = now;
      }
      if (!getSettings().history) continue;
      if (!autoSnapshotDue(seen.changedAt, seen.since, now)) continue;
      seen.since = now;
      void snapshotDoc(id, 'auto');
    }
    for (const id of watched.keys()) if (!alive.has(id)) watched.delete(id);
  };

  const interval = window.setInterval(tick, TICK_MS);
  const maintenance = window.setTimeout(() => {
    void historyMaintain(retentionDays())
      .then(announce)
      .catch(() => undefined);
  }, MAINTAIN_DELAY_MS);

  return () => {
    window.clearInterval(interval);
    window.clearTimeout(maintenance);
  };
}

/* ── The timeline's actions ────────────────────────────── */

export async function listVersions(id: DocId): Promise<HistoryVersion[]> {
  const meta = getMeta(id);
  if (!meta) return [];
  try {
    return await historyList(historyKeyOf(meta));
  } catch (error) {
    console.warn('Zeitreise: list failed', asApiError(error).message);
    return [];
  }
}

/** The text of one version, or `null` with the reason already shown. */
export async function readVersion(id: DocId, version: HistoryVersion): Promise<string | null> {
  const meta = getMeta(id);
  if (!meta) return null;
  try {
    return await historyRead(historyKeyOf(meta), version.id);
  } catch (error) {
    toast(
      'error',
      t('Diese Version ließ sich nicht lesen: {message}', { message: asApiError(error).message }),
    );
    return null;
  }
}

/**
 * The smallest single edit that turns `from` into `to`: what the two share at
 * the start and at the end stays put. A restore that replaced the whole text
 * would throw the caret to the top and make Ctrl+Z select everything.
 */
export function minimalChange(from: string, to: string): ChangeSpec | null {
  if (from === to) return null;
  let start = 0;
  const shorter = Math.min(from.length, to.length);
  while (start < shorter && from.charCodeAt(start) === to.charCodeAt(start)) start += 1;
  let end = 0;
  while (
    end < shorter - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  ) {
    end += 1;
  }
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/**
 * Puts a version back into its document, as an ordinary edit.
 *
 * The current text is kept first, with reason `restore`, so going back is
 * never one-way: Ctrl+Z undoes the restore while the tab is open, and the
 * timeline still has the text after it is closed.
 */
export async function restoreVersion(id: DocId, version: HistoryVersion): Promise<boolean> {
  const text = await readVersion(id, version);
  if (text === null) return false;
  await snapshotDoc(id, 'restore', true);

  const doc = getDoc(id);
  if (!doc) return false;
  const changes = minimalChange(doc.state.doc.toString(), text);
  if (!changes) {
    toast('info', t('Der Text ist schon auf diesem Stand.'));
    return false;
  }
  const pane = paneOf(id);
  const view = pane && getPane(pane)?.active === id ? viewFor(pane) : undefined;
  if (view && view.state === doc.state) {
    view.dispatch({ changes, userEvent: 'input.restore', scrollIntoView: true });
    setDocState(id, view.state);
  } else {
    setDocState(id, doc.state.update({ changes, userEvent: 'input.restore' }).state);
  }
  toast('success', t('Version wiederhergestellt. Rückgängig holt den vorherigen Text zurück.'));
  return true;
}

/** A version in a tab of its own, as a new untitled buffer. */
export async function openVersionAsTab(id: DocId, version: HistoryVersion): Promise<void> {
  const text = await readVersion(id, version);
  if (text !== null) showDocNext(openUntitled(text));
}

export async function copyVersion(id: DocId, version: HistoryVersion): Promise<void> {
  const text = await readVersion(id, version);
  if (text === null) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('success', t('Version in die Zwischenablage kopiert.'));
  } catch {
    toast('error', t('Die Zwischenablage ist nicht erreichbar.'));
  }
}

export async function deleteVersion(id: DocId, version: HistoryVersion): Promise<boolean> {
  const meta = getMeta(id);
  if (!meta) return false;
  const answer = await ask(
    t('Diese Version löschen?'),
    t('Die Version wird endgültig aus der Zeitreise entfernt.'),
    [
      { id: 'delete', label: t('Löschen'), tone: 'danger' },
      { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
    ],
  );
  if (answer !== 'delete') return false;
  try {
    await historyDelete(historyKeyOf(meta), version.id);
  } catch (error) {
    toast('error', t('Fehler: {message}', { message: asApiError(error).message }));
    return false;
  }
  announce();
  return true;
}

/** "Verlauf dieser Datei löschen": every version, after a plain question. */
export async function clearHistory(id: DocId): Promise<boolean> {
  const meta = getMeta(id);
  if (!meta) return false;
  const key = historyKeyOf(meta);
  const answer = await ask(
    t('Verlauf dieser Datei löschen?'),
    t(
      'Alle gesicherten Versionen von {name} werden gelöscht. Das lässt sich nicht rückgängig machen.',
      { name: meta.name },
    ),
    [
      { id: 'delete', label: t('Löschen'), tone: 'danger' },
      { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
    ],
  );
  if (answer !== 'delete') return false;
  try {
    await historyClear(key);
  } catch (error) {
    toast('error', t('Fehler: {message}', { message: asApiError(error).message }));
    return false;
  }
  lastSent.delete(keyString(key));
  announce();
  return true;
}

/** "Version jetzt sichern", with an answer either way. */
export async function snapshotNow(id: DocId): Promise<void> {
  if (!getSettings().history) {
    toast('info', t('Die Zeitreise ist in den Einstellungen ausgeschaltet.'));
    return;
  }
  // Not through `snapshotDoc`: its shortcut would answer "unchanged" for text
  // that was sent but never confirmed, and this one asks Rust every time.
  const doc = getDoc(id);
  if (!doc) return;
  const key = historyKeyOf(doc.meta);
  const text = doc.state.doc;
  const result = await send(key, text.toString(), 'auto');
  if (!result) {
    toast('error', t('Die Version ließ sich nicht sichern.'));
    return;
  }
  lastSent.set(keyString(key), text);
  if (result.status === 'created') {
    toast(
      'success',
      getSettings().tone === 'playful' ? t('Version gesichert ✨') : t('Version gesichert'),
    );
  } else if (result.status === 'unchanged') {
    toast('info', t('Genau dieser Stand ist schon gesichert.'));
  } else {
    toast('info', t('Zu groß für die Zeitreise: Dateien über 5 MB bekommen keine Versionen.'));
  }
}

/* ── Which version the diff shows ──────────────────────── */

export type HistoryDiffTarget = { docId: DocId; version: HistoryVersion };

let diffTarget: HistoryDiffTarget | null = null;
const diffListeners = new Set<() => void>();

function setDiff(next: HistoryDiffTarget | null) {
  diffTarget = next;
  for (const listener of diffListeners) listener();
}

export function openHistoryDiff(docId: DocId, version: HistoryVersion): void {
  setDiff({ docId, version });
}

export function closeHistoryDiff(): void {
  if (diffTarget) setDiff(null);
}

export function useHistoryDiff(): HistoryDiffTarget | null {
  return useSyncExternalStore(
    (listener) => {
      diffListeners.add(listener);
      return () => diffListeners.delete(listener);
    },
    () => diffTarget,
  );
}

/* ── Words for the timeline ────────────────────────────── */

export const REASON_LABELS: Record<HistoryReason, string> = {
  save: N_('Gespeichert'),
  auto: N_('Automatisch'),
  'before-reload': N_('Vor dem Neuladen'),
  'before-replace': N_('Vor dem Ersetzen'),
  restore: N_('Vor dem Wiederherstellen'),
  'external-change': N_('Vor externer Änderung'),
};

/** "vor 3 Minuten" / "3 minutes ago", from the platform rather than the catalogue. */
export function relativeTime(time: number, now: number, lang: Language): string {
  const format = new Intl.RelativeTimeFormat(locale(lang), { numeric: 'auto' });
  const seconds = Math.round((time - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 5],
    ['month', 12],
  ];
  let value = seconds;
  // Under ten seconds is "now": a timeline that counts "vor 7 Sekunden" up
  // while you watch is a stopwatch, not a timeline.
  if (Math.abs(value) < 10) return format.format(0, 'second');
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(value, unit);
    value = Math.round(value / size);
  }
  return format.format(value, 'year');
}

/** Midnight, local time, as a number: what the timeline groups by. */
export function dayOf(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const TODAY = N_('Heute');
const YESTERDAY = N_('Gestern');

export function dayLabel(time: number, now: number, lang: Language): string {
  const day = dayOf(time);
  const today = dayOf(now);
  if (day === today) return translate(lang, TODAY);
  if (day === dayOf(today - 12 * 3_600_000)) return translate(lang, YESTERDAY);
  const sameYear = new Date(day).getFullYear() === new Date(today).getFullYear();
  return new Date(day).toLocaleDateString(locale(lang), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  });
}

/* ── Commands ──────────────────────────────────────────── */

/** The timeline shows the active document, so this one becomes active first. */
export function showHistoryOf(id: DocId): void {
  activateDoc(id);
  setSidebarView('history');
}

/** For `lib/commands.ts`: the palette, the menus and the keyboard. */
export function historyCommands(): Command[] {
  const group = () => t('Zeitreise');
  const hasDoc = () => activeDocId() !== null;
  return [
    {
      id: 'history.show',
      title: () => t('Zeitreise zeigen'),
      group,
      run: () => setSidebarView('history'),
    },
    {
      id: 'history.snapshot',
      title: () => t('Version jetzt sichern'),
      group,
      enabled: hasDoc,
      run: async () => {
        const id = activeDocId();
        if (id) await snapshotNow(id);
      },
    },
    {
      id: 'history.clear',
      title: () => t('Verlauf dieser Datei löschen…'),
      group,
      enabled: hasDoc,
      run: async () => {
        const id = activeDocId();
        if (id) await clearHistory(id);
      },
    },
  ];
}
