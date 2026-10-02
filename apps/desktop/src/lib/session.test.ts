/**
 * Hot exit: the window closes without asking, so the drafts are the promise.
 *
 * Three things are checked. A flush writes only the drafts whose text changed
 * (typing triggers one every second, and rewriting every open note each time
 * would be the cost of that). Overlapping flushes never interleave, because an
 * older draft landing after a newer one is lost text. And with "restore the
 * session" switched off, unsaved notes still come back — only the clean files
 * stay closed.
 *
 * The Rust side is mocked; its own tests cover what it does with the calls.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from './api';

const writeDraft = vi.fn<(docId: string, text: string) => Promise<void>>(async () => undefined);
const dropDraft = vi.fn<(docId: string) => Promise<void>>(async () => undefined);
const saveSession = vi.fn<(session: StoredSession, prune: boolean) => Promise<void>>(
  async () => undefined,
);
const loadSession = vi.fn<() => Promise<StoredSession | null>>(async () => null);
const readDraft = vi.fn<(docId: string) => Promise<string | null>>(async () => null);
const readTextFile = vi.fn(async () => {
  throw new Error('no disk in this test');
});

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    writeDraft,
    dropDraft,
    saveSession,
    loadSession,
    readDraft,
    readTextFile,
  };
});
vi.mock('./toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./toast')>();
  return { ...actual, toast: vi.fn(() => 0) };
});

afterEach(() => {
  vi.clearAllMocks();
});

async function fresh() {
  vi.resetModules();
  window.localStorage.clear();
  const session = await import('./session');
  const documents = await import('./documents');
  const workspace = await import('./workspace');
  const settings = await import('./settings');
  const toast = await import('./toast');
  workspace.resetWorkspace();
  return { session, documents, workspace, settings, toast: vi.mocked(toast.toast) };
}

/** Types into a document the way the editor does: a new state through the store. */
function type(documents: typeof import('./documents'), id: string, insert: string): void {
  const doc = documents.getDoc(id);
  if (!doc) throw new Error('no such document');
  documents.setDocState(
    id,
    doc.state.update({ changes: { from: doc.state.doc.length, insert } }).state,
  );
}

describe('the draft flush', () => {
  it('writes a draft once per change and drops a clean one once', async () => {
    const { session, documents, workspace } = await fresh();
    const note = documents.openUntitled();
    const clean = documents.openUntitled();
    workspace.showDoc(note);
    workspace.showDoc(clean);
    type(documents, note, 'Milch');

    expect(await session.persistSession()).toBe(true);
    expect(writeDraft).toHaveBeenCalledTimes(1);
    expect(writeDraft).toHaveBeenLastCalledWith(note, 'Milch');
    expect(dropDraft).toHaveBeenCalledTimes(1);

    // Nothing changed: no draft is touched again, only the session file.
    await session.persistSession();
    expect(writeDraft).toHaveBeenCalledTimes(1);
    expect(dropDraft).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledTimes(2);

    type(documents, note, ' und Brot');
    await session.persistSession();
    expect(writeDraft).toHaveBeenCalledTimes(2);
    expect(writeDraft).toHaveBeenLastCalledWith(note, 'Milch und Brot');
  });

  it('runs one flush at a time and folds the waiting calls into one', async () => {
    const { session, documents, workspace } = await fresh();
    const note = documents.openUntitled();
    workspace.showDoc(note);
    type(documents, note, 'a');

    let release: () => void = () => undefined;
    writeDraft.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const first = session.persistSession();
    type(documents, note, 'b');
    const second = session.persistSession();
    const third = session.persistSession();
    expect(second).toBe(third);

    // The first write is still on its way, so nothing else has started.
    await Promise.resolve();
    expect(writeDraft).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second, third]);
    expect(writeDraft).toHaveBeenCalledTimes(2);
    expect(writeDraft).toHaveBeenLastCalledWith(note, 'ab');
  });

  it('reports a draft that did not reach the disk', async () => {
    const { session, documents, workspace } = await fresh();
    const note = documents.openUntitled();
    workspace.showDoc(note);
    type(documents, note, 'wichtig');
    writeDraft.mockRejectedValueOnce(new Error('disk full'));

    expect(await session.persistSession()).toBe(false);
    // And tries again next time instead of believing it is on disk.
    expect(await session.persistSession()).toBe(true);
    expect(writeDraft).toHaveBeenCalledTimes(2);
  });
});

describe('restoring with the setting switched off', () => {
  const stored: StoredSession = {
    version: 1,
    documents: [
      {
        docId: 'doc-1-0',
        path: null,
        name: 'Einkaufsliste',
        encoding: 'UTF-8',
        bom: false,
        eol: 'lf',
        language: null,
        cursor: 0,
        scrollTop: 0,
        dirty: true,
        stamp: null,
        untitled: 4,
      },
      {
        docId: 'doc-2-0',
        path: '/home/nyu/clean.txt',
        name: 'clean.txt',
        encoding: 'UTF-8',
        bom: false,
        eol: 'lf',
        language: null,
        cursor: 0,
        scrollTop: 0,
        dirty: false,
        stamp: null,
      },
    ],
    layout: { kind: 'pane', id: 'pane-0' },
    panes: { 'pane-0': { tabs: ['doc-1-0', 'doc-2-0'], active: 'doc-2-0' } },
    activePane: 'pane-0',
    folder: '/home/nyu',
    recentFiles: [],
    recentFolders: [],
  };

  it('brings back the unsaved note and nothing else', async () => {
    const { session, documents, settings, toast } = await fresh();
    settings.updateSettings({ restoreSession: false });
    loadSession.mockResolvedValueOnce(stored);
    readDraft.mockResolvedValueOnce('Milch\nBrot');

    await session.restoreSession();

    const open = documents.allDocs().map((doc) => doc.meta);
    expect(open).toHaveLength(1);
    expect(open[0]?.name).toBe('Einkaufsliste');
    expect(open[0]?.untitled).toBe(4);
    expect(documents.docText('doc-1-0')).toBe('Milch\nBrot');
    expect(readTextFile).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);

    // The note accounts for every draft the session named, so the sweep may run.
    await session.persistSession();
    expect(saveSession).toHaveBeenLastCalledWith(expect.anything(), true);

    // And the next untitled tab does not reuse its number.
    expect(documents.nextUntitledNumber()).toBe(5);
  });
});

describe('a restore that is still going', () => {
  const note = (docId: string, name: string) => ({
    docId,
    path: null,
    name,
    encoding: 'UTF-8',
    bom: false,
    eol: 'lf' as const,
    language: null,
    cursor: 0,
    scrollTop: 0,
    dirty: true,
    stamp: null,
  });
  const stored: StoredSession = {
    version: 1,
    documents: [note('doc-1-0', 'Schnell'), note('doc-2-0', 'Langsam')],
    layout: { kind: 'pane', id: 'pane-0' },
    panes: { 'pane-0': { tabs: ['doc-1-0', 'doc-2-0'], active: 'doc-2-0' } },
    activePane: 'pane-0',
    folder: null,
    recentFiles: [],
    recentFolders: [],
  };

  it('holds every write back until all of its documents are there', async () => {
    const { session, documents } = await fresh();
    loadSession.mockResolvedValueOnce(stored);
    let release: (text: string) => void = () => undefined;
    readDraft
      .mockResolvedValueOnce('schnell da')
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));

    const restore = session.restoreSession();
    await vi.waitFor(() => expect(documents.getDoc('doc-1-0')).toBeDefined());

    // What the autosave would do on the first document's announcement.
    const early = session.persistSession();
    const alsoEarly = session.persistSession();
    await Promise.resolve();
    expect(saveSession).not.toHaveBeenCalled();
    expect(writeDraft).not.toHaveBeenCalled();

    release('langsam da');
    await restore;
    expect(await early).toBe(true);
    expect(await alsoEarly).toBe(true);

    // One write, after the restore, naming both documents.
    expect(saveSession).toHaveBeenCalledTimes(1);
    const [written, prune] = saveSession.mock.calls[0]!;
    expect(written.documents.map((entry) => entry.docId)).toEqual(['doc-1-0', 'doc-2-0']);
    expect(prune).toBe(true);
  });

  it('lets Nyu cheer only when nothing failed', async () => {
    const { session } = await fresh();
    const events = await import('./nyu-events');
    const heard = vi.fn();
    const stop = events.onNyu(heard);
    loadSession.mockResolvedValueOnce(stored);
    readDraft.mockResolvedValueOnce('da').mockRejectedValueOnce(new Error('locked'));

    await session.restoreSession();
    stop();

    expect(heard).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'session-restored' }));
  });

  it('lets Nyu cheer when everything came back', async () => {
    const { session } = await fresh();
    const events = await import('./nyu-events');
    const heard = vi.fn();
    const stop = events.onNyu(heard);
    loadSession.mockResolvedValueOnce(stored);
    readDraft.mockResolvedValueOnce('eins').mockResolvedValueOnce('zwei');

    await session.restoreSession();
    stop();

    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ kind: 'session-restored' }));
  });
});
