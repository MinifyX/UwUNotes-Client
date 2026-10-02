/**
 * Zeitreise on the page's side: when a version is sent, what a restore does
 * to the text, and the words the timeline is made of.
 *
 * Rust is mocked at `lib/api.ts`, the one door, so these tests see exactly the
 * calls the app would make — and can count them, which is the point of the
 * "skip what has not changed" shortcut.
 */

import { undo } from '@codemirror/commands';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryVersion } from './api';

const api = vi.hoisted(() => ({
  historySnapshot: vi.fn(),
  historyMove: vi.fn(),
  historyRead: vi.fn(),
  historySnapshotFiles: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, ...api };
});

const { baseExtensions } = await import('../editor/setup');
const { getDoc, markSaved, openDoc, setBaseExtensions, setDocState } = await import('./documents');
const {
  afterSave,
  autoSnapshotDue,
  AUTO_INTERVAL_MS,
  dayLabel,
  historyKeyOf,
  IDLE_MS,
  MAX_WAIT_MS,
  minimalChange,
  relativeTime,
  restoreVersion,
  snapshotDoc,
  snapshotFilesOnDisk,
} = await import('./history');
const { DEFAULT_SETTINGS, resetSettings, sanitize, updateSettings } = await import('./settings');

setBaseExtensions(baseExtensions);

const version = (overrides: Partial<HistoryVersion> = {}): HistoryVersion => ({
  id: '0001790000000000-abcdefabcdef',
  time: 1_790_000_000_000,
  reason: 'save',
  size: 5,
  lines: 1,
  hash: 'a'.repeat(64),
  storedSize: 5,
  ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
  resetSettings();
  api.historySnapshot.mockImplementation(async () => ({
    status: 'created',
    version: version(),
  }));
  api.historyMove.mockResolvedValue(undefined);
  api.historySnapshotFiles.mockResolvedValue(1);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('taking versions', () => {
  it('sends a text once, and not again until it changes', async () => {
    const id = openDoc({ path: null, name: 'Neu 1', text: 'hello' });
    await snapshotDoc(id, 'auto');
    await snapshotDoc(id, 'auto');
    expect(api.historySnapshot).toHaveBeenCalledTimes(1);
    expect(api.historySnapshot.mock.calls[0]?.[0]).toEqual({ kind: 'note', id });

    const doc = getDoc(id)!;
    setDocState(id, doc.state.update({ changes: { from: 5, insert: '!' } }).state);
    await snapshotDoc(id, 'auto');
    expect(api.historySnapshot).toHaveBeenCalledTimes(2);
    expect(api.historySnapshot.mock.calls[1]?.[1]).toBe('hello!');
  });

  it('keeps the text from the moment of the call, not from after it', async () => {
    const id = openDoc({ path: '/notes/a.txt', name: 'a.txt', text: 'before' });
    const pending = snapshotDoc(id, 'before-reload');
    const doc = getDoc(id)!;
    setDocState(
      id,
      doc.state.update({ changes: { from: 0, to: doc.state.doc.length, insert: 'after' } }).state,
    );
    await pending;
    expect(api.historySnapshot.mock.calls[0]?.[1]).toBe('before');
    expect(api.historySnapshot.mock.calls[0]?.[2]).toBe('before-reload');
  });

  it('sends nothing with the feature switched off', async () => {
    updateSettings({ history: false });
    const id = openDoc({ path: null, name: 'Neu 1', text: 'quiet' });
    await snapshotDoc(id, 'auto');
    await snapshotFilesOnDisk(['/notes/a.txt'], 'before-replace');
    expect(api.historySnapshot).not.toHaveBeenCalled();
    expect(api.historySnapshotFiles).not.toHaveBeenCalled();
  });

  it('moves a note to its file before the saved text joins it', async () => {
    const id = openDoc({ path: null, name: 'Neu 1', text: 'draft' });
    const order: string[] = [];
    api.historyMove.mockImplementation(async () => {
      order.push('move');
    });
    api.historySnapshot.mockImplementation(async () => {
      order.push('snapshot');
      return { status: 'created', version: version() };
    });

    markSaved(id, '/notes/draft.txt', 'draft.txt', { mtimeMs: 1, size: 5, readOnly: false });
    await afterSave(id, null, 'draft');

    expect(order).toEqual(['move', 'snapshot']);
    expect(api.historyMove.mock.calls[0]?.slice(0, 2)).toEqual([
      { kind: 'note', id },
      { kind: 'path', path: '/notes/draft.txt' },
    ]);
    expect(api.historySnapshot.mock.calls[0]?.[2]).toBe('save');
  });

  it('an autosave keeps a version only every few minutes', async () => {
    const id = openDoc({ path: '/notes/auto.txt', name: 'auto.txt', text: 'x' });
    await afterSave(id, '/notes/auto.txt', 'one', true);
    await afterSave(id, '/notes/auto.txt', 'two', true);
    // A save the user asked for always counts.
    await afterSave(id, '/notes/auto.txt', 'three');
    expect(api.historySnapshot.mock.calls.map((call) => call[1])).toEqual(['one', 'three']);
  });

  it('a file that already had a path is not moved anywhere', async () => {
    const id = openDoc({ path: '/notes/a.txt', name: 'a.txt', text: 'x' });
    await afterSave(id, '/notes/a.txt', 'x');
    expect(api.historyMove).not.toHaveBeenCalled();
    expect(api.historySnapshot).toHaveBeenCalledTimes(1);
  });

  it('keys a file by path and a note by id', () => {
    expect(historyKeyOf({ id: 'doc-1', path: '/a' })).toEqual({ kind: 'path', path: '/a' });
    expect(historyKeyOf({ id: 'doc-1', path: null })).toEqual({ kind: 'note', id: 'doc-1' });
  });
});

describe('restoring', () => {
  it('applies the version as one undoable edit, after keeping the current text', async () => {
    const id = openDoc({ path: '/notes/a.txt', name: 'a.txt', text: 'one two three' });
    api.historyRead.mockResolvedValue('one 2 three');

    expect(await restoreVersion(id, version())).toBe(true);

    expect(api.historySnapshot.mock.calls[0]?.[1]).toBe('one two three');
    expect(api.historySnapshot.mock.calls[0]?.[2]).toBe('restore');
    const doc = getDoc(id)!;
    expect(doc.state.doc.toString()).toBe('one 2 three');

    let undone = doc.state;
    undo({
      state: undone,
      dispatch: (transaction) => {
        undone = transaction.state;
      },
    });
    expect(undone.doc.toString()).toBe('one two three');
  });

  it('keeps the current text even with the feature switched off', async () => {
    updateSettings({ history: false });
    const id = openDoc({ path: '/notes/a.txt', name: 'a.txt', text: 'now' });
    api.historyRead.mockResolvedValue('then');
    await restoreVersion(id, version());
    expect(api.historySnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('the smallest edit', () => {
  it('touches only what differs', () => {
    expect(minimalChange('abcXdef', 'abcYYdef')).toEqual({ from: 3, to: 4, insert: 'YY' });
    expect(minimalChange('same', 'same')).toBeNull();
    expect(minimalChange('', 'new')).toEqual({ from: 0, to: 0, insert: 'new' });
    expect(minimalChange('gone', '')).toEqual({ from: 0, to: 4, insert: '' });
  });

  it('does not let prefix and suffix overlap on repeated characters', () => {
    // "aaa" → "aa": the shared prefix is "aa", and the suffix must not count
    // the same characters a second time.
    const change = minimalChange('aaa', 'aa') as { from: number; to: number; insert: string };
    expect('aaa'.slice(0, change.from) + change.insert + 'aaa'.slice(change.to)).toBe('aa');
  });
});

describe('the timer', () => {
  const t0 = 1_000_000;

  it('waits for a pause and for the interval', () => {
    expect(autoSnapshotDue(t0, t0, t0 + IDLE_MS)).toBe(false);
    expect(autoSnapshotDue(t0 + AUTO_INTERVAL_MS, t0, t0 + AUTO_INTERVAL_MS + 1_000)).toBe(false);
    expect(autoSnapshotDue(t0 + AUTO_INTERVAL_MS, t0, t0 + AUTO_INTERVAL_MS + IDLE_MS)).toBe(true);
  });

  it('does not wait forever for somebody who never pauses', () => {
    expect(autoSnapshotDue(t0 + MAX_WAIT_MS, t0, t0 + MAX_WAIT_MS)).toBe(true);
  });
});

describe('words', () => {
  const now = new Date(2026, 9, 2, 15, 0).getTime();

  it('says how long ago, in the language asked for', () => {
    expect(relativeTime(now - 3 * 60_000, now, 'de')).toBe('vor 3 Minuten');
    expect(relativeTime(now - 3 * 60_000, now, 'en')).toBe('3 minutes ago');
    expect(relativeTime(now - 2_000, now, 'en')).toBe('now');
  });

  it('groups today and yesterday by name', () => {
    expect(dayLabel(now - 60_000, now, 'de')).toBe('Heute');
    expect(dayLabel(new Date(2026, 9, 1, 23, 0).getTime(), now, 'de')).toBe('Gestern');
    expect(dayLabel(new Date(2026, 8, 20, 12, 0).getTime(), now, 'de')).toContain('20');
  });
});

describe('settings', () => {
  it('defaults to on, thirty days', () => {
    expect(DEFAULT_SETTINGS.history).toBe(true);
    expect(DEFAULT_SETTINGS.historyRetentionDays).toBe(30);
  });

  it('falls back on nonsense', () => {
    const settings = sanitize({ history: 'yes', historyRetentionDays: 12 });
    expect(settings.history).toBe(true);
    expect(settings.historyRetentionDays).toBe(30);
    expect(sanitize({ history: false, historyRetentionDays: 365 })).toMatchObject({
      history: false,
      historyRetentionDays: 365,
    });
  });
});
