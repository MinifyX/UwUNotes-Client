/**
 * Files the system asks the editor to open: "Open with UwUNotes" in Finder, a
 * double-click on a file UwUNotes is the default app for, a file dropped on
 * the Dock icon. macOS only, for now — elsewhere nothing ever arrives.
 *
 * Rust keeps them until the page collects them (`src-tauri/src/opened.rs`),
 * because on a cold start they arrive before there is a page to tell. So this
 * collects once at start-up and again whenever Rust says there are new ones,
 * and always after the session is back: a file opened from Finder lands in a
 * new tab next to the restored ones instead of racing them.
 */

import { listen } from '@tauri-apps/api/event';
import { takeOpenedPaths } from './api';
import { openPaths } from './files';
import { restoreSession } from './session';

const EVENT = 'open-paths';

async function collect(): Promise<void> {
  await restoreSession().catch(() => undefined);
  const paths = await takeOpenedPaths().catch((): string[] => []);
  if (paths.length > 0) await openPaths(paths);
}

/** Called once from `App.tsx`; returns the teardown. */
export function startOpenRequests(): () => void {
  let gone = false;
  let unlisten: (() => void) | undefined;
  // Listening first and collecting second, so a file that arrives in between
  // is either in the first collection or announced to the listener.
  void listen(EVENT, () => void collect())
    .then((stop) => {
      if (gone) stop();
      else unlisten = stop;
    })
    .catch(() => undefined)
    .finally(() => {
      if (!gone) void collect();
    });
  return () => {
    gone = true;
    unlisten?.();
  };
}
