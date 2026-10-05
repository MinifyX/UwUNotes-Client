/**
 * What has to happen before the app goes away, whichever way it goes.
 *
 * Closing is not a decision about unsaved text: the session and every draft go
 * to disk, and the next start puts all of it back — unsaved notes included,
 * even with the restore setting off. The one question left is for the one case
 * where that promise cannot be kept: a draft or the session that did not reach
 * the disk. Then closing would cost text, and that is said plainly, never
 * decided silently.
 *
 * Two callers: the window's close request (`App.tsx` — the close button, ⌘Q
 * from the menu, Alt+F4) and, on macOS, a quit the system started — the Dock,
 * the app switcher, logging out — which Rust holds until this has run
 * (`src-tauri/src/quit.rs`).
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from './i18n';
import { ask } from './prompt';
import { persistSession, restoreSession } from './session';

/** Writes everything down. `true`: going away now loses nothing, or the person said go anyway. */
export async function readyToClose(): Promise<boolean> {
  // A window closed while its tabs are still coming back must not write a
  // session that lists only the ones that made it so far.
  await restoreSession().catch(() => undefined);
  const saved = await persistSession().catch(() => false);
  if (saved) return true;
  const answer = await ask(
    t('Ungespeicherte Texte nicht gesichert'),
    t(
      'Nicht alle ungespeicherten Texte ließen sich neben der Sitzung ablegen. Wenn du jetzt schließt, gehen sie verloren.',
    ),
    [
      { id: 'close', label: t('Trotzdem schließen'), tone: 'danger' },
      { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
    ],
  );
  return answer === 'close';
}

/**
 * Answers the system's quit requests (macOS only raises them). Returns the
 * teardown. The answer always goes back, even when saving threw: a quit left
 * waiting would hang a logout.
 */
export function installQuitGuard(): () => void {
  let gone = false;
  let unlisten: (() => void) | undefined;
  void listen('quit-requested', () => {
    void readyToClose()
      .catch(() => true)
      .then((proceed) => invoke('finish_quit', { proceed }))
      .catch(() => undefined);
  })
    .then((stop) => {
      if (gone) stop();
      else unlisten = stop;
    })
    .catch(() => undefined);
  return () => {
    gone = true;
    unlisten?.();
  };
}
