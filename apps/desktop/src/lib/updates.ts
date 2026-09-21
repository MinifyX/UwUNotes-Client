/**
 * Whether there is a newer UwUNotes, and getting it installed.
 *
 * One store outside React, like the other `lib/` modules, because the start-up
 * check fires from a timer rather than from a component. What it holds is a
 * single phase: nothing going on, a check running, a version on offer, that
 * version downloading, it installed, or something that went wrong.
 *
 * Two checks and no more. One a short while after the window opens, if
 * `autoCheckUpdates` is on, and one whenever the user presses "check now". No
 * interval: an editor that phones GitHub every six hours while somebody writes
 * a letter is doing something they did not ask for.
 *
 * **Only a check the user asked for may report a failure.** The Rust side
 * hands back `failed` for everything — no network, a 404, a feed full of
 * HTML — and the start-up check throws that away, because an editor that opens
 * with "the update server did not answer" is an editor complaining about the
 * wifi. A check somebody pressed a button for says what happened.
 *
 * This module does NOT decide the feed address or check a signature. Both are
 * `src-tauri/src/updates.rs` and the config beside it, deliberately out of the
 * page's reach.
 */

import { useSyncExternalStore } from 'react';
import {
  asApiError,
  checkForUpdate,
  installUpdate,
  type DownloadProgress,
  type UpdateCheck,
} from './api';
import { N_, t } from './i18n';
import { persistSession } from './session';
import { APP_VERSION, getSettings } from './settings';
import { toast } from './toast';

/**
 * Long enough that restoring the session, opening the files and the first git
 * poll are all over before anything touches the network.
 */
const FIRST_CHECK_AFTER_MS = 15_000;

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'available'; version: string; notes: string | null; installable: boolean }
  | {
      phase: 'downloading';
      version: string;
      notes: string | null;
      /** 0 to 1, or `null` while the size of the download is unknown. */
      progress: number | null;
    }
  /** Installed without the app being replaced underneath us — see below. */
  | { phase: 'ready'; version: string }
  | { phase: 'failed'; message: string };

/**
 * The label and the explanation for the switch in Settings → Verhalten.
 *
 * Exported rather than written there because `SettingsDialog.tsx` is not this
 * module's to edit. The second sentence is the honest one: an UwUNotes that
 * predates this file has no updater in it at all and will never offer anybody
 * anything, however this switch is set.
 */
export const AUTO_CHECK_LABEL = N_('Nach Updates suchen');
export const AUTO_CHECK_HINT = N_(
  'Sieht kurz nach dem Start auf GitHub nach, ob es eine neuere Version gibt. Ältere Installationen als diese hatten noch keine Updatefunktion und melden sich nie von selbst.',
);

let state: UpdateState = { phase: 'idle' };
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUpdateState(): UpdateState {
  return state;
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, getUpdateState);
}

/**
 * Asks once. `asked` is the difference between the start-up check and a button
 * press, and it is the only thing that decides whether a failure is shown.
 */
async function check(asked: boolean): Promise<void> {
  if (state.phase === 'checking' || state.phase === 'downloading') return;
  set({ phase: 'checking' });

  let answer: UpdateCheck;
  try {
    answer = await checkForUpdate();
  } catch (error) {
    // The command itself does not fail, so a rejection here is the IPC and not
    // the feed. Same treatment either way.
    answer = { status: 'failed', message: asApiError(error).message };
  }

  if (answer.status === 'available') {
    set({
      phase: 'available',
      version: answer.version,
      notes: answer.notes,
      // Older Rust sides said nothing and could always install.
      installable: answer.installable !== false,
    });
    return;
  }

  if (answer.status === 'failed' && asked) {
    set({
      phase: 'failed',
      message: t('Die Suche nach Updates hat keine Antwort bekommen.'),
    });
    return;
  }

  set({ phase: 'idle' });
  // Nothing to answer and nothing to decide, so a toast rather than the bar —
  // but somebody who pressed a button has to hear something back.
  if (asked) {
    toast('info', t('UwUNotes {version} ist die neueste Version.', { version: APP_VERSION }));
  }
}

/** "Jetzt suchen", from the command palette or the settings. */
export function checkForUpdateNow(): void {
  void check(true);
}

/**
 * Downloads the offered version and hands it to the installer.
 *
 * On Windows `installUpdate` does not come back: the setup starts and this
 * process ends, which means the close guard in `App.tsx` never asks anybody
 * anything and never writes the session. So the session — and with it every
 * draft holding text that was never saved to a file — goes to disk first.
 */
export async function installUpdateNow(): Promise<void> {
  const offered = state;
  if (offered.phase !== 'available') return;
  set({
    phase: 'downloading',
    version: offered.version,
    notes: offered.notes,
    progress: null,
  });

  try {
    await persistSession().catch(() => undefined);
    await installUpdate(onProgress);
    set({ phase: 'ready', version: offered.version });
  } catch (error) {
    set({
      phase: 'failed',
      message: t('Das Update ließ sich nicht installieren: {reason}', {
        reason: asApiError(error).message,
      }),
    });
  }
}

function onProgress(progress: DownloadProgress): void {
  if (state.phase !== 'downloading') return;
  const total = progress.total;
  set({
    ...state,
    progress: total !== null && total > 0 ? Math.min(1, progress.received / total) : null,
  });
}

/**
 * "Später", and the close button on a failure.
 *
 * Straight back to idle rather than to a remembered "not this version again":
 * there is one automatic check per run, so nothing brings the bar back on its
 * own, and somebody who presses "check now" afterwards is asking for it.
 *
 * A download in progress is not dismissable. It is already fetching a setup,
 * and hiding the bar would leave the app about to restart with nothing on
 * screen saying so.
 */
export function dismissUpdate(): void {
  if (state.phase === 'downloading') return;
  set({ phase: 'idle' });
}

/** The start-up check. Called once from `App.tsx`; returns the teardown. */
export function startUpdateCheck(): () => void {
  // The setting is read when the timer fires, not when it is armed, so turning
  // it off in the first few seconds of a run still stops the check.
  const timer = window.setTimeout(() => {
    if (getSettings().autoCheckUpdates) void check(false);
  }, FIRST_CHECK_AFTER_MS);

  return () => window.clearTimeout(timer);
}
