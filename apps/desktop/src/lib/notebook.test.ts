/**
 * Closing a tab never asks, and never loses text.
 *
 * A tab with unsaved changes goes to the note trash before it closes; one
 * whose text cannot reach the trash stays open; a clean tab just closes.
 * Ctrl+Shift+T brings all of them back in the order they went. An untitled
 * note names itself after its first line.
 *
 * The trash itself is Rust's (and tested there); here it is a map.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrashEntry, TrashNote, TrashSummary } from './api';

const entries = new Map<string, TrashEntry>();
let minted = 0;

const trashNote = vi.fn(async (note: TrashNote): Promise<TrashSummary> => {
  minted += 1;
  const entry: TrashEntry = { ...note, id: `${minted}`, trashedAt: minted };
  entries.set(entry.id, entry);
  return {
    id: entry.id,
    trashedAt: entry.trashedAt,
    name: note.name,
    path: note.path,
    language: note.language,
    bytes: note.text.length,
    excerpt: note.text,
  };
});
const readTrash = vi.fn(async (id: string) => entries.get(id) ?? null);
const deleteTrash = vi.fn(async (id: string) => {
  entries.delete(id);
});
const listTrash = vi.fn(async () => [] as TrashSummary[]);
const historyMove = vi.fn(async () => undefined);

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    trashNote,
    readTrash,
    deleteTrash,
    listTrash,
    historyMove,
    dropDraft: vi.fn(async () => undefined),
    pathInfo: vi.fn(async (path: string) => ({
      path,
      name: path.split('/').pop() ?? path,
      parent: '/notes',
      exists: true,
      isDir: false,
    })),
    readTextFile: vi.fn(async (path: string) => ({
      path,
      text: 'on disk',
      encoding: 'UTF-8',
      bom: false,
      eol: 'lf' as const,
      mixedEol: false,
      stamp: { mtimeMs: 1, size: 7, readOnly: false },
      lossy: false,
      binary: false,
      encodingSource: 'guessed' as const,
    })),
  };
});
vi.mock('./toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./toast')>();
  return { ...actual, toast: vi.fn(() => 0) };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  entries.clear();
  minted = 0;
});

async function fresh() {
  vi.resetModules();
  window.localStorage.clear();
  const files = await import('./files');
  const notebook = await import('./notebook');
  const documents = await import('./documents');
  const workspace = await import('./workspace');
  const toast = await import('./toast');
  workspace.resetWorkspace();
  return { files, notebook, documents, workspace, toast: vi.mocked(toast.toast) };
}

function type(documents: typeof import('./documents'), id: string, insert: string): void {
  const doc = documents.getDoc(id);
  if (!doc) throw new Error('no such document');
  documents.setDocState(
    id,
    doc.state.update({ changes: { from: doc.state.doc.length, insert } }).state,
  );
}

describe('closing a tab', () => {
  it('puts unsaved text in the trash, closes, and offers it back', async () => {
    const { files, documents, workspace, toast } = await fresh();
    const note = documents.openUntitled();
    workspace.showDoc(note);
    type(documents, note, 'Einkaufsliste\nMilch');
    documents.patchMeta(note, { name: 'Einkaufsliste' });

    expect(await files.closeDocSafely(note)).toBe(true);

    expect(documents.getDoc(note)).toBeUndefined();
    expect(trashNote).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Einkaufsliste', text: 'Einkaufsliste\nMilch', path: null }),
    );
    expect(toast).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('Einkaufsliste'),
      expect.objectContaining({ run: expect.any(Function) }),
    );
  });

  it('keeps the tab open when the trash cannot take the text', async () => {
    const { files, documents, workspace, toast } = await fresh();
    const note = documents.openUntitled();
    workspace.showDoc(note);
    type(documents, note, 'nur hier');
    trashNote.mockRejectedValueOnce(new Error('disk full'));

    expect(await files.closeDocSafely(note)).toBe(false);
    expect(documents.getDoc(note)).toBeDefined();
    expect(toast).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('closes clean and blank tabs without the trash', async () => {
    const { files, documents, workspace } = await fresh();
    const empty = documents.openUntitled();
    const blank = documents.openUntitled();
    workspace.showDoc(empty);
    workspace.showDoc(blank);
    type(documents, blank, '   \n ');

    await files.closeDocsSafely([empty, blank]);
    expect(documents.allDocs()).toHaveLength(0);
    expect(trashNote).not.toHaveBeenCalled();
  });
});

describe('Ctrl+Shift+T', () => {
  it('brings back files and trashed notes in close order', async () => {
    const { files, documents, workspace } = await fresh();
    await files.openPaths(['/notes/a.txt']);
    const fileA = documents.findByPath('/notes/a.txt');
    const note = documents.openUntitled();
    workspace.showDoc(note);
    type(documents, note, 'Idee');
    if (!fileA) throw new Error('the file did not open');

    await files.closeDocsSafely([fileA, note]);
    expect(documents.allDocs()).toHaveLength(0);

    // Last closed first: the note, as an untitled tab with its text.
    await files.reopenClosedTab();
    const restored = documents.allDocs();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.meta.path).toBeNull();
    expect(restored[0]?.meta.dirty).toBe(true);
    expect(documents.docText(restored[0]?.meta.id ?? '')).toBe('Idee');
    expect(entries.size).toBe(0);

    await files.reopenClosedTab();
    expect(documents.findByPath('/notes/a.txt')).not.toBeNull();
  });

  it('brings an untitled note back under its old id, pin and bookmarks included', async () => {
    const { files, documents, workspace } = await fresh();
    const bookmarks = await import('./bookmarks');
    const note = documents.openUntitled();
    workspace.showDoc(note);
    type(documents, note, 'Idee\nzweite Zeile');
    documents.patchMeta(note, { pinned: true, color: 'green' });
    bookmarks.restoreBookmarks(note, [2]);

    await files.closeDocSafely(note);
    expect(trashNote).toHaveBeenCalledWith(
      expect.objectContaining({ docId: note, pinned: true, color: 'green', bookmarks: [2] }),
    );
    await files.reopenClosedTab();

    // The same id: its Zeitreise versions are filed under it and simply stay.
    expect(documents.docText(note)).toBe('Idee\nzweite Zeile');
    expect(documents.getMeta(note)?.pinned).toBe(true);
    expect(documents.getMeta(note)?.color).toBe('green');
    expect(bookmarks.bookmarksForSession(note)).toEqual([2]);
    expect(historyMove).not.toHaveBeenCalled();
  });

  it('moves the Zeitreise of a restored note whose old id is taken', async () => {
    const { files, documents, workspace } = await fresh();
    const note = documents.openUntitled();
    workspace.showDoc(note);
    type(documents, note, 'Idee');
    await files.closeDocSafely(note);
    // Whatever holds the id now, the restored note must not take it over.
    documents.openDoc({ id: note, path: null, name: 'Platzhalter', text: '' });

    await files.reopenClosedTab();

    const back = documents.allDocs().find((doc) => doc.meta.id !== note);
    expect(back).toBeDefined();
    expect(documents.docText(back?.meta.id ?? '')).toBe('Idee');
    expect(historyMove).toHaveBeenCalledWith(
      { kind: 'note', id: note },
      { kind: 'note', id: back?.meta.id },
      expect.any(Number),
    );
  });

  it('restores a trashed file edit on top of the file on disk', async () => {
    const { files, documents } = await fresh();
    await files.openPaths(['/notes/b.txt']);
    const id = documents.findByPath('/notes/b.txt');
    if (!id) throw new Error('the file did not open');
    type(documents, id, ' plus edit');

    await files.closeDocSafely(id);
    await files.reopenClosedTab();

    const back = documents.findByPath('/notes/b.txt');
    expect(back).not.toBeNull();
    expect(documents.getMeta(back ?? '')?.dirty).toBe(true);
    expect(documents.docText(back ?? '')).toBe('on disk plus edit');
  });
});

describe('untitled notes', () => {
  it('that start with text are unsaved and named, so closing keeps the text', async () => {
    const { documents } = await fresh();
    const note = documents.openUntitled('# Alte Fassung\nText von gestern');
    expect(documents.getMeta(note)?.dirty).toBe(true);
    expect(documents.getMeta(note)?.name).toBe('Alte Fassung');

    const empty = documents.openUntitled();
    expect(documents.getMeta(empty)?.dirty).toBe(false);
    expect(documents.getMeta(empty)?.name).toBe(`Neu ${documents.getMeta(empty)?.untitled}`);
  });

  it('name themselves after their first line, and fall back to Neu n', async () => {
    vi.useFakeTimers();
    const { notebook, documents } = await fresh();
    const stop = notebook.startNotebook();
    const note = documents.openUntitled();
    type(documents, note, '# Projektideen\n- eins');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(documents.getMeta(note)?.name).toBe('Projektideen');

    const doc = documents.getDoc(note);
    if (!doc) throw new Error('gone');
    documents.setDocState(
      note,
      doc.state.update({ changes: { from: 0, to: doc.state.doc.length } }).state,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(documents.getMeta(note)?.name).toBe(`Neu ${documents.getMeta(note)?.untitled}`);
    stop();
  });
});
