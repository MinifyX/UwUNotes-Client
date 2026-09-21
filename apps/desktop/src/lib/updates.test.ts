/**
 * The one rule in `lib/updates.ts` that is easy to lose by accident.
 *
 * A check that got no answer is not news. The start-up check has to swallow it
 * whole — no bar, no toast, nothing — and only a check somebody pressed a
 * button for is allowed to say that it failed. That distinction lives in one
 * boolean argument and nothing downstream would notice it flipping, so it is
 * checked here along with the rest of the phases the bar can be in.
 *
 * `lib/updates.ts` keeps its state in module-level variables, so every test
 * takes a fresh module graph. The Rust side is mocked away entirely: what it
 * answers is its own business and its own tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadProgress, UpdateCheck } from './api';
import type { Toast } from './toast';

const checkForUpdate = vi.fn<() => Promise<UpdateCheck>>();
const installUpdate = vi.fn<(onProgress: (p: DownloadProgress) => void) => Promise<void>>();
const persistSession = vi.fn(async () => undefined);
const toast = vi.fn<(tone: Toast['tone'], text: string) => number>(() => 0);

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, checkForUpdate, installUpdate };
});
vi.mock('./session', () => ({ persistSession }));
vi.mock('./toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./toast')>();
  return { ...actual, toast };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

/** A module graph that has never seen another test. */
async function freshUpdates() {
  vi.resetModules();
  window.localStorage.clear();
  return import('./updates');
}

describe('a check nobody asked for', () => {
  it('says nothing at all when the feed could not be read', async () => {
    vi.useFakeTimers();
    checkForUpdate.mockResolvedValue({ status: 'failed', message: 'dns' });
    const updates = await freshUpdates();

    const stop = updates.startUpdateCheck();
    await vi.advanceTimersByTimeAsync(20_000);
    stop();

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(updates.getUpdateState()).toEqual({ phase: 'idle' });
    expect(toast).not.toHaveBeenCalled();
  });

  it('does not run at all with the setting off', async () => {
    vi.useFakeTimers();
    checkForUpdate.mockResolvedValue({ status: 'none' });
    const updates = await freshUpdates();
    const { updateSettings } = await import('./settings');
    updateSettings({ autoCheckUpdates: false });

    const stop = updates.startUpdateCheck();
    await vi.advanceTimersByTimeAsync(20_000);
    stop();

    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it('is dropped when the window closes before it fires', async () => {
    vi.useFakeTimers();
    checkForUpdate.mockResolvedValue({ status: 'none' });
    const updates = await freshUpdates();

    updates.startUpdateCheck()();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(checkForUpdate).not.toHaveBeenCalled();
  });
});

describe('a check somebody pressed a button for', () => {
  it('reports that it got no answer', async () => {
    checkForUpdate.mockResolvedValue({ status: 'failed', message: 'dns' });
    const updates = await freshUpdates();

    updates.checkForUpdateNow();
    await vi.waitFor(() => expect(updates.getUpdateState().phase).toBe('failed'));
  });

  it('names the version in hand when there is nothing newer', async () => {
    checkForUpdate.mockResolvedValue({ status: 'none' });
    const updates = await freshUpdates();
    const { APP_VERSION } = await import('./settings');

    updates.checkForUpdateNow();
    await vi.waitFor(() => expect(toast).toHaveBeenCalledTimes(1));

    expect(updates.getUpdateState()).toEqual({ phase: 'idle' });
    expect(toast.mock.calls[0]?.[1]).toContain(APP_VERSION);
  });
});

describe('an update on offer', () => {
  it('carries its version and notes into the bar', async () => {
    checkForUpdate.mockResolvedValue({
      status: 'available',
      installable: true,
      version: '0.2.0',
      notes: 'Ein Updater.',
    });
    const updates = await freshUpdates();

    updates.checkForUpdateNow();
    await vi.waitFor(() => expect(updates.getUpdateState().phase).toBe('available'));

    expect(updates.getUpdateState()).toEqual({
      phase: 'available',
      version: '0.2.0',
      notes: 'Ein Updater.',
      installable: true,
    });
  });

  it('writes the session before it hands anything to the installer', async () => {
    checkForUpdate.mockResolvedValue({
      status: 'available',
      version: '0.2.0',
      installable: true,
      notes: null,
    });
    // Windows never comes back from this call, so anything that has to survive
    // the restart has to be on disk before it is made.
    installUpdate.mockImplementation(async () => {
      expect(persistSession).toHaveBeenCalled();
    });
    const updates = await freshUpdates();

    updates.checkForUpdateNow();
    await vi.waitFor(() => expect(updates.getUpdateState().phase).toBe('available'));
    await updates.installUpdateNow();

    expect(persistSession).toHaveBeenCalledTimes(1);
    expect(updates.getUpdateState()).toEqual({ phase: 'ready', version: '0.2.0' });
  });

  it('leaves the progress unknown while the size is', async () => {
    checkForUpdate.mockResolvedValue({
      status: 'available',
      version: '0.2.0',
      installable: true,
      notes: null,
    });
    const seen: (number | null)[] = [];
    installUpdate.mockImplementation(async (onProgress) => {
      onProgress({ received: 4_096, total: null });
      seen.push(progressOf(updates));
      onProgress({ received: 512, total: 2_048 });
      seen.push(progressOf(updates));
    });
    const updates = await freshUpdates();

    updates.checkForUpdateNow();
    await vi.waitFor(() => expect(updates.getUpdateState().phase).toBe('available'));
    await updates.installUpdateNow();

    expect(seen).toEqual([null, 0.25]);
  });

  it('stays on screen while it is downloading, and goes away afterwards', async () => {
    checkForUpdate.mockResolvedValue({
      status: 'available',
      version: '0.2.0',
      installable: true,
      notes: null,
    });
    installUpdate.mockImplementation(async () => {
      // "Später" during a download would hide a bar that is about to restart
      // the app.
      updates.dismissUpdate();
      expect(updates.getUpdateState().phase).toBe('downloading');
    });
    const updates = await freshUpdates();

    updates.checkForUpdateNow();
    await vi.waitFor(() => expect(updates.getUpdateState().phase).toBe('available'));
    await updates.installUpdateNow();

    updates.dismissUpdate();
    expect(updates.getUpdateState()).toEqual({ phase: 'idle' });
  });

  it('says so in German when the install fails', async () => {
    checkForUpdate.mockResolvedValue({
      status: 'available',
      version: '0.2.0',
      installable: true,
      notes: null,
    });
    installUpdate.mockRejectedValue({ kind: 'other', message: 'signature', path: null });
    const updates = await freshUpdates();

    updates.checkForUpdateNow();
    await vi.waitFor(() => expect(updates.getUpdateState().phase).toBe('available'));
    await updates.installUpdateNow();

    const state = updates.getUpdateState();
    expect(state.phase).toBe('failed');
    expect(state.phase === 'failed' && state.message).toContain('signature');
  });
});

function progressOf(updates: typeof import('./updates')): number | null {
  const state = updates.getUpdateState();
  return state.phase === 'downloading' ? state.progress : null;
}
