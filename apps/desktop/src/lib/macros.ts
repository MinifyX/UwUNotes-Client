/**
 * Macros: record a bit of editing, then have it done again.
 *
 * A macro is a list of *semantic* steps — characters that were typed, named
 * editor commands, app commands, a search — and never a list of transactions.
 * `editor/recording.ts` explains why at length; the short version is that a
 * transaction knows where it happened, so replaying one always edits the place
 * the caret used to be. Steps are replayed against wherever the caret is now,
 * which is the entire reason a macro can walk down a file.
 *
 * This module owns the list, the storage and the playback rules. It does not
 * capture anything itself (the editor extension does) and it draws nothing
 * (`components/MacroDialog.tsx` does).
 *
 * ## Playback, in three promises
 *
 * 1. **One undo step per run.** However long the macro and however many
 *    repetitions, one Ctrl+Z puts the document back. See {@link regroup}.
 * 2. **It stops when a step fails.** A search that finds nothing, a command
 *    that declines — the run ends there and says why. A macro that half ran
 *    and said nothing is worse than one that stopped.
 * 3. **It cannot hang the window.** Every loop has a hard ceiling, and
 *    "until the end of the file" also needs the caret to keep moving forwards.
 *
 * A run is synchronous from first step to last. That is deliberate: yielding
 * between steps would let a file watcher reload the document in the middle of a
 * macro, and there is no sensible thing to do with the second half of a macro
 * that is now pointed at a different file.
 */

import { useSyncExternalStore } from 'react';
import { isolateHistory } from '@codemirror/commands';
import type { SearchQuery } from '@codemirror/search';
import {
  EditorSelection,
  Transaction,
  type ChangeSet,
  type EditorState,
  type Text,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { editorCommand, holdHistory, setRecordingSink } from '../editor/recording';
import { allCommands, runCommand } from './commands';
import { compileSearch } from './find';
import { t } from './i18n';
import { normalizeMacroShortcut } from './shortcuts';
import { toast } from './toast';
import { activeView } from './views';

export type MacroStep =
  /** Literal characters, exactly as they were typed. */
  | { kind: 'input'; text: string }
  /** A command from `editor/recording.ts`'s table, by name. */
  | { kind: 'editor'; name: string }
  /** An app command from `lib/commands.ts`, by id. */
  | { kind: 'command'; id: string }
  /** Move the selection to the next match, or stop the run if there is none. */
  | {
      kind: 'find';
      query: string;
      regex: boolean;
      caseSensitive: boolean;
      wholeWord: boolean;
      back: boolean;
    };

export type Macro = {
  id: string;
  name: string;
  steps: MacroStep[];
  /** `Ctrl+Shift+KeyM`, or nothing. The format is parsed in `lib/shortcuts.ts`. */
  shortcut: string | null;
};

/**
 * Ceilings, all of them the same kind of promise: nothing a user can do to a
 * macro — or to `uwunotes.macros` with a text editor — can make the window
 * stop answering.
 */
const REPEAT_CAP = 10_000;
const MAX_STEPS = 10_000;
const MAX_MACROS = 200;
const MAX_NAME = 80;

const KEY = 'uwunotes.macros';

/* ── State ─────────────────────────────────────────────── */

let macros: Macro[] = loadMacros();
/** The run being recorded right now, or `null` when nothing is recording. */
let recordingSteps: MacroStep[] | null = null;
/** The last finished recording, until it is saved under a name or replaced. */
let lastRecording: MacroStep[] | null = null;
let playing = false;

const listeners = new Set<() => void>();

export type MacroState = {
  macros: Macro[];
  recording: boolean;
  /** Steps in the recording that is running, or in the last finished one. */
  stepCount: number;
  playing: boolean;
};

// Built once per change rather than per read: `useSyncExternalStore` compares
// snapshots by identity, and a fresh object every time is an infinite render.
let snapshot: MacroState = buildSnapshot();

function buildSnapshot(): MacroState {
  return {
    // The list itself, not a copy: every change to it replaces the array, and
    // this runs on every keystroke of a recording.
    macros,
    recording: recordingSteps !== null,
    stepCount: (recordingSteps ?? lastRecording)?.length ?? 0,
    playing,
  };
}

function announce() {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getMacroState(): MacroState {
  return snapshot;
}

export function useMacros(): MacroState {
  return useSyncExternalStore(subscribe, getMacroState);
}

/** For the places outside React that only need the list — `lib/commands.ts`. */
export function savedMacros(): Macro[] {
  return [...macros];
}

export function macroById(id: string): Macro | undefined {
  return macros.find((macro) => macro.id === id);
}

/** The macro bound to a key, for `lib/shortcuts.ts` to dispatch. */
export function macroWithShortcut(shortcut: string): Macro | undefined {
  return macros.find((macro) => macro.shortcut === shortcut);
}

export function hasLastRecording(): boolean {
  return lastRecording !== null;
}

export function isRecording(): boolean {
  return recordingSteps !== null;
}

/* ── Storage ───────────────────────────────────────────── */

/**
 * Everything that comes back out of storage is treated as hostile, the same
 * way `lib/settings.ts` treats its file: it is JSON on the user's disk, a
 * hand-edit is a supported way to get a macro out of one machine and into
 * another, and a typo in it must cost a macro rather than the editor.
 */
function loadMacros(): Macro[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    return sanitizeMacros(JSON.parse(raw));
  } catch {
    return [];
  }
}

function sanitizeMacros(raw: unknown): Macro[] {
  if (!Array.isArray(raw)) return [];
  const clean: Macro[] = [];
  const takenIds = new Set<string>();
  const takenShortcuts = new Set<string>();

  for (const entry of raw.slice(0, MAX_MACROS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const id = typeof record.id === 'string' ? record.id.slice(0, 64).trim() : '';
    if (!id || takenIds.has(id)) continue;
    const steps = sanitizeSteps(record.steps);
    // A macro with no steps is not a macro; it is a name that does nothing.
    if (steps.length === 0) continue;

    const name = typeof record.name === 'string' ? record.name.slice(0, MAX_NAME).trim() : '';
    const wanted =
      typeof record.shortcut === 'string' ? normalizeMacroShortcut(record.shortcut) : null;
    // Two macros on one key would mean the second is unreachable and nobody
    // could tell why, so the first one written wins.
    const shortcut = wanted && !takenShortcuts.has(wanted) ? wanted : null;
    if (shortcut) takenShortcuts.add(shortcut);

    takenIds.add(id);
    clean.push({ id, name, steps, shortcut });
  }
  return clean;
}

/**
 * What to show for a macro.
 *
 * A name is user data, so it is stored exactly as it was typed and never
 * translated — but an empty one has to read as something, and this runs when
 * the list is drawn rather than when it is loaded. Nothing in this module may
 * call {@link t} at import time: the settings it reads are still being built.
 */
export function macroLabel(macro: Macro): string {
  return macro.name || t('Makro ohne Namen');
}

function sanitizeSteps(raw: unknown): MacroStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: MacroStep[] = [];
  for (const entry of raw.slice(0, MAX_STEPS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const { kind } = record;

    if (kind === 'input' && typeof record.text === 'string' && record.text) {
      steps.push({ kind: 'input', text: record.text });
    } else if (kind === 'editor' && typeof record.name === 'string' && record.name) {
      // An unknown name is dropped here rather than at playback, so a macro
      // recorded by a newer version degrades instead of stopping every run.
      if (editorCommand(record.name)) steps.push({ kind: 'editor', name: record.name });
    } else if (kind === 'command' && typeof record.id === 'string' && record.id) {
      steps.push({ kind: 'command', id: record.id });
    } else if (kind === 'find' && typeof record.query === 'string' && record.query) {
      steps.push({
        kind: 'find',
        query: record.query,
        regex: record.regex === true,
        caseSensitive: record.caseSensitive === true,
        wholeWord: record.wholeWord === true,
        back: record.back === true,
      });
    }
  }
  return steps;
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(macros));
  } catch {
    // A full or locked-down store loses the macros on restart. They still work
    // for this run, which is better than refusing to record one.
  }
}

function newMacroId(): string {
  let id = '';
  do {
    id = `macro-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  } while (macros.some((macro) => macro.id === id));
  return id;
}

/* ── Recording ─────────────────────────────────────────── */

export function startRecording(): void {
  if (playing) {
    toast('info', t('Während einer Wiedergabe kann nichts aufgezeichnet werden.'));
    return;
  }
  if (recordingSteps) return;
  if (!activeView()) {
    toast('info', t('Zum Aufzeichnen zuerst eine Datei öffnen.'));
    return;
  }
  recordingSteps = [];
  setRecordingSink(pushStep);
  announce();
  toast('info', t('Aufzeichnung läuft.'));
}

export function stopRecording(): void {
  const steps = recordingSteps;
  if (!steps) return;
  recordingSteps = null;
  setRecordingSink(null);
  // An empty recording keeps the previous one: somebody who starts and stops by
  // accident should not lose the macro they were about to save.
  if (steps.length > 0) lastRecording = steps;
  announce();

  if (steps.length > 0) {
    toast('success', t('Aufzeichnung beendet: {count} Schritte.', { count: steps.length }));
  } else {
    toast('info', t('Aufzeichnung beendet, nichts aufgezeichnet.'));
  }
}

export function cancelRecording(): void {
  if (!recordingSteps) return;
  recordingSteps = null;
  setRecordingSink(null);
  announce();
  toast('info', t('Aufzeichnung verworfen.'));
}

/**
 * One captured step.
 *
 * Consecutive typing is merged, so "hello" is one step and not five. It keeps
 * the step list roughly the size of the edit it describes, and it makes the
 * count in the dialog mean something to a person.
 */
function pushStep(step: MacroStep): void {
  const steps = recordingSteps;
  // Playback dispatches through the same editor the recorder is watching, so
  // without this a replay during a recording would record itself.
  if (!steps || playing) return;
  if (steps.length >= MAX_STEPS) {
    // Ending it is the honest move. Quietly dropping the rest would hand back a
    // macro that does most of the job, which is the worst kind of macro.
    stopRecording();
    toast(
      'info',
      t('Aufzeichnung bei {count} Schritten beendet — Obergrenze.', {
        count: MAX_STEPS,
      }),
    );
    return;
  }

  const last = steps[steps.length - 1];
  if (step.kind === 'input' && last?.kind === 'input') {
    steps[steps.length - 1] = { kind: 'input', text: last.text + step.text };
  } else {
    steps.push(step);
  }
  announce();
}

/**
 * A search the user just ran, as a step.
 *
 * Exported for `lib/find.ts` to call while the find bar is being driven during
 * a recording; nothing else produces a `find` step. Playback has supported them
 * from the start, which is the half that is hard to add later.
 */
export function recordFind(options: {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  back: boolean;
}): void {
  if (!options.query) return;
  pushStep({ kind: 'find', ...options });
}

/** An app command the user ran from the palette or a key while recording. */
export function recordCommand(id: string): void {
  pushStep({ kind: 'command', id });
}

/* ── Saving what was recorded ──────────────────────────── */

/** Returns the id of the new macro, or an empty string when there was nothing. */
export function saveLastRecording(name: string): string {
  const steps = lastRecording;
  if (!steps || steps.length === 0) {
    toast('info', t('Es gibt keine Aufzeichnung zum Speichern.'));
    return '';
  }
  if (macros.length >= MAX_MACROS) {
    toast('error', t('Mehr als {count} Makros verwaltet UwUNotes nicht.', { count: MAX_MACROS }));
    return '';
  }

  const macro: Macro = {
    id: newMacroId(),
    name: name.trim().slice(0, MAX_NAME),
    steps: [...steps],
    shortcut: null,
  };
  macros = [...macros, macro];
  // The recording stays available: saving it under a name is not the same as
  // being done with it, and "save, then play it once more" is a normal minute.
  persist();
  announce();
  toast('success', t('Makro „{name}“ gespeichert.', { name: macroLabel(macro) }));
  return macro.id;
}

export function renameMacro(id: string, name: string): void {
  const trimmed = name.trim().slice(0, MAX_NAME);
  if (!trimmed) return;
  macros = macros.map((macro) => (macro.id === id ? { ...macro, name: trimmed } : macro));
  persist();
  announce();
}

export function deleteMacro(id: string): void {
  const next = macros.filter((macro) => macro.id !== id);
  if (next.length === macros.length) return;
  macros = next;
  persist();
  announce();
}

/**
 * Binds a key to a macro, or clears it with `null`.
 *
 * Whatever held that key before loses it. The alternative — refusing the new
 * binding — leaves the user staring at a key that does something else and no
 * way to find out what.
 */
export function setMacroShortcut(id: string, shortcut: string | null): void {
  const wanted = shortcut === null ? null : normalizeMacroShortcut(shortcut);
  if (shortcut !== null && !wanted) {
    toast('info', t('Ein Makro-Kürzel braucht Strg und eine Taste.'));
    return;
  }
  macros = macros.map((macro) => {
    if (macro.id === id) return { ...macro, shortcut: wanted };
    if (wanted && macro.shortcut === wanted) return { ...macro, shortcut: null };
    return macro;
  });
  persist();
  announce();
}

/* ── Playing ───────────────────────────────────────────── */

export async function playLast(times = 1): Promise<void> {
  const steps = lastRecording;
  if (!steps) {
    toast('info', t('Es gibt noch keine Aufzeichnung.'));
    return;
  }
  run(steps, times, false);
}

export async function playMacro(id: string, times = 1): Promise<void> {
  const macro = macroById(id);
  if (!macro) {
    toast('error', t('Dieses Makro gibt es nicht mehr.'));
    return;
  }
  run(macro.steps, times, false);
}

/**
 * Repeats until the caret stops moving forwards, the document ends, or a step
 * fails — whichever comes first, and in any case no more than {@link REPEAT_CAP}
 * times.
 */
export async function playUntilEndOfFile(id?: string): Promise<void> {
  const steps = id === undefined ? lastRecording : macroById(id)?.steps;
  if (!steps) {
    toast('info', t('Es gibt noch keine Aufzeichnung.'));
    return;
  }
  run(steps, REPEAT_CAP, true);
}

function run(steps: readonly MacroStep[], times: number, untilEnd: boolean): void {
  if (playing) {
    toast('info', t('Es läuft bereits eine Wiedergabe.'));
    return;
  }
  if (steps.length === 0) {
    toast('info', t('Dieses Makro hat keine Schritte.'));
    return;
  }
  const view = activeView();
  if (!view) {
    toast('info', t('Zum Abspielen zuerst eine Datei öffnen.'));
    return;
  }

  playing = true;
  announce();

  const release = holdHistory(view);
  const startDoc = view.state.doc;
  const startSelection = view.state.selection;
  const limit = Math.max(1, Math.min(Math.round(times) || 1, REPEAT_CAP));

  let runs = 0;
  let stopped: string | null = null;
  // How far forward the caret has ever got. "Until the end of the file" ends
  // when a repetition fails to beat it, which is what saves a macro that has
  // nothing left to find from spinning to the cap.
  let furthest = -1;

  try {
    while (runs < limit) {
      stopped = playOnce(view, steps);
      if (stopped) break;
      runs += 1;
      if (!untilEnd) continue;
      const head = view.state.selection.main.head;
      if (head <= furthest) break;
      furthest = head;
      if (head >= view.state.doc.length) break;
    }
  } finally {
    playing = false;
    regroup(view, startDoc, startSelection, release());
    announce();
  }

  if (stopped) {
    toast('error', t('Makro angehalten: {reason}', { reason: stopped }));
  } else if (untilEnd && runs >= limit) {
    toast('info', t('Makro nach {count} Durchläufen angehalten — Obergrenze.', { count: runs }));
  } else if (runs > 1) {
    toast('success', t('Makro {count}× abgespielt.', { count: runs }));
  }
}

/** One pass over the steps. Returns why it stopped, or `null` when it did not. */
function playOnce(view: EditorView, steps: readonly MacroStep[]): string | null {
  for (const step of steps) {
    const reason = playStep(view, step);
    if (reason) return reason;
  }
  return null;
}

function playStep(view: EditorView, step: MacroStep): string | null {
  switch (step.kind) {
    case 'input': {
      if (view.state.readOnly) return t('Das Dokument ist schreibgeschützt.');
      const change = view.state.changeByRange((range) => ({
        changes: { from: range.from, to: range.to, insert: step.text },
        range: EditorSelection.cursor(range.from + step.text.length),
      }));
      view.dispatch({ ...change, userEvent: 'input.type', scrollIntoView: true });
      return null;
    }
    case 'editor': {
      const command = editorCommand(step.name);
      if (!command) return t('Unbekannter Editorbefehl: {name}', { name: step.name });
      // A command returns false when it had nothing to do — the caret is
      // already at the top, there is nothing left to delete. In a macro that is
      // the end of the run, and in "until the end of the file" it is the exit.
      return command(view) ? null : t('„{name}“ konnte hier nichts tun.', { name: step.name });
    }
    case 'command': {
      const command = allCommands().find((entry) => entry.id === step.id);
      if (!command) return t('Unbekannter Befehl: {id}', { id: step.id });
      if (command.enabled && !command.enabled()) {
        return t('„{title}“ ist gerade nicht verfügbar.', { title: command.title() });
      }
      // Fire and forget, because `runCommand` is allowed to be asynchronous.
      // An asynchronous command's own edits land after this run has closed its
      // undo group, so they get an undo step of their own — which is the honest
      // outcome for "save the file" sitting in the middle of a macro.
      runCommand(step.id);
      return null;
    }
    case 'find': {
      const { query, error } = compileSearch({
        query: step.query,
        regex: step.regex,
        caseSensitive: step.caseSensitive,
        wholeWord: step.wholeWord,
      });
      if (!query) return error ?? t('Der Suchausdruck lässt sich nicht verwenden.');
      const hit = matchFrom(view.state, query, step.back);
      if (!hit) return t('„{query}“ kommt hier nicht mehr vor.', { query: step.query });
      view.dispatch({ selection: { anchor: hit.from, head: hit.to }, scrollIntoView: true });
      return null;
    }
  }
}

/**
 * The next match after the selection, or the last one before it.
 *
 * Deliberately does not wrap around the end of the document, unlike the find
 * bar: a wrapping search inside a repeat is a macro that runs to the ceiling
 * every time, editing the top of the file over and over.
 */
function matchFrom(
  state: EditorState,
  query: SearchQuery,
  back: boolean,
): { from: number; to: number } | null {
  const selection = state.selection.main;
  if (back) {
    const cursor = query.getCursor(state, 0, selection.from);
    let found: { from: number; to: number } | null = null;
    for (;;) {
      const step = cursor.next();
      if (step.done) return found;
      found = step.value;
    }
  }
  const step = query.getCursor(state, selection.to, state.doc.length).next();
  return step.done ? null : step.value;
}

/**
 * Puts the whole run into the undo history as one entry.
 *
 * Two ways were available. Annotating each step's transaction so the history
 * *joins* them is the cheap one, and it does not work: CodeMirror only joins
 * adjacent changes of a compatible `userEvent` within half a second, and a
 * macro is a deliberate mixture of moving, typing and deleting. So this is the
 * other way — collect the run's changes (`editor/recording.ts` holds them out
 * of the history while it runs), then undo it in one silent transaction and
 * redo it in one that the history can see.
 *
 * Both happen inside the same synchronous block, so nothing is drawn in
 * between and the user sees one edit. The cost is one extra pass over the
 * changes; the gain is that Ctrl+Z means what everybody expects it to mean.
 */
function regroup(
  view: EditorView,
  startDoc: Text,
  startSelection: EditorSelection,
  changes: ChangeSet | null,
): void {
  if (!changes || changes.empty) return;
  // The revert below is destructive if these changes are not exactly what
  // happened. A synchronous run makes that impossible; this is the assertion
  // that keeps it impossible.
  if (!changes.apply(startDoc).eq(view.state.doc)) return;

  const endSelection = view.state.selection;
  view.dispatch({
    changes: changes.invert(startDoc),
    selection: startSelection,
    annotations: Transaction.addToHistory.of(false),
  });
  view.dispatch({
    changes,
    selection: endSelection,
    userEvent: 'macro.play',
    // "full": the run neither swallows the edit before it nor gets swallowed by
    // the next keystroke after it.
    annotations: isolateHistory.of('full'),
    scrollIntoView: true,
  });
}
