/**
 * The open documents.
 *
 * A document is its metadata (where it came from, how to write it back) plus a
 * CodeMirror {@link EditorState}, which holds the text, the selection and the
 * undo history. The state lives here rather than in React, for two reasons:
 *
 * 1. **Typing must not re-render the app.** CodeMirror updates its own DOM. If
 *    every keystroke went through `useState`, the whole window would redraw to
 *    show a character that is already on screen.
 * 2. **A tab keeps its undo history.** Switching away and back hands the same
 *    `EditorState` to the pane's editor, so Ctrl+Z still reaches yesterday.
 *
 * React subscribes to {@link subscribeDocuments}, which fires when *metadata*
 * changes — a name, the dirty flag, an encoding — and not when text does. The
 * one exception is the dirty flag itself, which is recomputed on every edit;
 * see {@link setDocState}.
 */

import { EditorState, Text, type Extension } from '@codemirror/state';
import type { EncodingLabel, Eol, FileStamp, LoadedFile } from './api';
import { getSettings } from './settings';

export type DocId = string;

/** Everything about a document that is not its text. Serialises into the session. */
export type DocMeta = {
  id: DocId;
  /** `null` until the buffer is saved somewhere. */
  path: string | null;
  /** The file name, or `Neu 1` for a buffer that has none yet. */
  name: string;
  encoding: EncodingLabel;
  bom: boolean;
  eol: Eol;
  /** The file mixed line endings when it was read. Shown once, in the status bar. */
  mixedEol: boolean;
  /** A language the user picked by hand; `null` means "decide by file name". */
  languageOverride: string | null;
  /** Differs from the text on disk. */
  dirty: boolean;
  /** What was on disk when we last read or wrote it, for detecting outside edits. */
  stamp: FileStamp | null;
  /** The file could not be decoded cleanly — characters were replaced. */
  lossy: boolean;
  /** NUL bytes: almost certainly not text. Saving is blocked until confirmed. */
  binary: boolean;
  /** The file is read-only on disk; saving asks before clearing the flag. */
  readOnly: boolean;
  /** Set when the file changed on disk behind our back and we have not reloaded. */
  staleOnDisk: boolean;
};

export type Doc = {
  meta: DocMeta;
  state: EditorState;
  /** The text as it is on disk. The dirty flag is `state.doc` against this. */
  savedDoc: Text;
};

const docs = new Map<DocId, Doc>();
const listeners = new Set<() => void>();
/** Bumped on every metadata change, so `useSyncExternalStore` has a snapshot to compare. */
let version = 0;
let docCounter = 0;
let untitledCounter = 0;

function announce() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeDocuments(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function documentsVersion(): number {
  return version;
}

export function getDoc(id: DocId): Doc | undefined {
  return docs.get(id);
}

export function getMeta(id: DocId): DocMeta | undefined {
  return docs.get(id)?.meta;
}

export function allDocs(): Doc[] {
  return [...docs.values()];
}

export function newDocId(): DocId {
  docCounter += 1;
  return `doc-${docCounter}-${version}`;
}

/** `Neu 1`, `Neu 2`, … The German name is what `t()` translates in the tab. */
export function nextUntitledName(): string {
  untitledCounter += 1;
  return `Neu ${untitledCounter}`;
}

/**
 * The extensions every document's state starts with.
 *
 * Set once by `editor/setup.ts` at start-up, because the editor module imports
 * this one and not the other way round. Keeping the reference here means a
 * state can be built from a file without dragging the whole CodeMirror stack
 * into the session loader.
 */
let baseExtensions: () => Extension = () => [];

export function setBaseExtensions(factory: () => Extension) {
  baseExtensions = factory;
}

function stateFor(text: string): EditorState {
  return EditorState.create({ doc: text, extensions: baseExtensions() });
}

type OpenInit = {
  id?: DocId;
  path: string | null;
  name: string;
  text: string;
  encoding?: EncodingLabel;
  bom?: boolean;
  eol?: Eol;
  mixedEol?: boolean;
  languageOverride?: string | null;
  stamp?: FileStamp | null;
  lossy?: boolean;
  binary?: boolean;
  /** For a restored draft: the text differs from disk from the first moment. */
  dirty?: boolean;
};

/** Puts a document in the store and returns its id. */
export function openDoc(init: OpenInit): DocId {
  const settings = getSettings();
  const id = init.id ?? newDocId();
  const state = stateFor(init.text);
  const doc: Doc = {
    meta: {
      id,
      path: init.path,
      name: init.name,
      encoding: init.encoding ?? settings.defaultEncoding,
      bom: init.bom ?? false,
      eol: init.eol ?? settings.defaultEol,
      mixedEol: init.mixedEol ?? false,
      languageOverride: init.languageOverride ?? null,
      dirty: init.dirty ?? false,
      stamp: init.stamp ?? null,
      lossy: init.lossy ?? false,
      binary: init.binary ?? false,
      readOnly: init.stamp?.readOnly ?? false,
      staleOnDisk: false,
    },
    state,
    // A document that starts dirty (a restored draft) has no disk text to
    // compare against, so an empty document stands in: anything is different.
    savedDoc: init.dirty ? Text.empty : state.doc,
  };
  docs.set(id, doc);
  announce();
  return id;
}

/** A file that came back from {@link import('./api').readTextFile}. */
export function openLoadedFile(file: LoadedFile, name: string, id?: DocId): DocId {
  return openDoc({
    id,
    path: file.path,
    name,
    text: file.text,
    encoding: file.encoding,
    bom: file.bom,
    eol: file.eol,
    mixedEol: file.mixedEol,
    stamp: file.stamp,
    lossy: file.lossy,
    binary: file.binary,
  });
}

/** An empty buffer with no path, named `Neu n`. */
export function openUntitled(text = ''): DocId {
  return openDoc({ path: null, name: nextUntitledName(), text });
}

/**
 * Takes the state a pane's editor produced.
 *
 * The dirty flag is recomputed here rather than tracked, so undoing back to
 * the saved text clears the dot on the tab. `Text.eq` compares lengths first,
 * which is the common case while typing; only an edit that keeps the length
 * exactly the same costs a walk of the tree.
 *
 * Listeners are told only when something they can see changed — otherwise
 * typing would re-render the window, which is the thing this store exists to
 * avoid.
 */
export function setDocState(id: DocId, state: EditorState) {
  const doc = docs.get(id);
  if (!doc) return;
  doc.state = state;
  const dirty = !state.doc.eq(doc.savedDoc);
  if (dirty !== doc.meta.dirty) {
    doc.meta = { ...doc.meta, dirty };
    announce();
  }
}

/** Replaces the text, keeping the undo history — for reloading from disk. */
export function replaceDocText(id: DocId, text: string) {
  const doc = docs.get(id);
  if (!doc) return;
  doc.state = doc.state.update({
    changes: { from: 0, to: doc.state.doc.length, insert: text },
  }).state;
  announce();
}

export function patchMeta(id: DocId, patch: Partial<Omit<DocMeta, 'id'>>) {
  const doc = docs.get(id);
  if (!doc) return;
  doc.meta = { ...doc.meta, ...patch };
  announce();
}

/** After a successful write: this text is now what is on disk. */
export function markSaved(id: DocId, path: string, name: string, stamp: FileStamp) {
  const doc = docs.get(id);
  if (!doc) return;
  doc.savedDoc = doc.state.doc;
  doc.meta = {
    ...doc.meta,
    path,
    name,
    stamp,
    dirty: false,
    staleOnDisk: false,
    readOnly: stamp.readOnly,
  };
  announce();
}

/** After reloading from disk: same deal, but the text came the other way. */
export function markReloaded(id: DocId, file: LoadedFile) {
  const doc = docs.get(id);
  if (!doc) return;
  replaceDocText(id, file.text);
  doc.savedDoc = doc.state.doc;
  doc.meta = {
    ...doc.meta,
    encoding: file.encoding,
    bom: file.bom,
    eol: file.eol,
    mixedEol: file.mixedEol,
    stamp: file.stamp,
    lossy: file.lossy,
    dirty: false,
    staleOnDisk: false,
  };
  announce();
}

/**
 * Forces the dirty flag on by forgetting what was on disk.
 *
 * For a file that vanished underneath us. Setting `dirty` through
 * {@link patchMeta} would not survive, because {@link setDocState} recomputes
 * the flag against `savedDoc` on the next editor update and would quietly clear
 * it again — leaving a tab that closes without a word and takes the only
 * remaining copy of the text with it.
 */
export function forgetSavedText(id: DocId) {
  const doc = docs.get(id);
  if (!doc) return;
  doc.savedDoc = Text.empty;
  doc.meta = { ...doc.meta, dirty: true, stamp: null, staleOnDisk: false };
  announce();
}

export function closeDoc(id: DocId) {
  if (docs.delete(id)) announce();
}

/** The text as one string, for saving and for the draft file. */
export function docText(id: DocId): string {
  return docs.get(id)?.state.doc.toString() ?? '';
}

/** Is this file already open? Paths are compared as the OS gave them to us. */
export function findByPath(path: string): DocId | null {
  for (const doc of docs.values()) {
    if (doc.meta.path && samePath(doc.meta.path, path)) return doc.meta.id;
  }
  return null;
}

/**
 * Windows paths differ in case and in slash without meaning a different file;
 * on anything else they do not. `navigator.platform` is deprecated but still
 * the only thing available before the first `appInfo()` call returns.
 */
const CASE_INSENSITIVE = navigator.userAgent.includes('Windows');

export function samePath(a: string, b: string): boolean {
  const normalise = (path: string) => {
    const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
    return CASE_INSENSITIVE ? slashed.toLowerCase() : slashed;
  };
  return normalise(a) === normalise(b);
}

/** Any document with unsaved changes — the close guard asks about these. */
export function dirtyDocs(): DocMeta[] {
  return allDocs()
    .map((doc) => doc.meta)
    .filter((meta) => meta.dirty);
}

/**
 * Resets the store. Only for the session loader, which builds the whole set of
 * documents at once and must not inherit anything from a failed earlier try.
 */
export function clearDocuments() {
  docs.clear();
  untitledCounter = 0;
  announce();
}

/** Keeps `Neu n` from starting at 1 again after a session restore. */
export function seedUntitledCounter(highest: number) {
  untitledCounter = Math.max(untitledCounter, highest);
}
