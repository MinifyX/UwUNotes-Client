/**
 * The window: title bar, sidebar, splits, status bar, and everything that
 * floats over them.
 *
 * It owns almost no state. The documents are in `lib/documents.ts`, the layout
 * in `lib/workspace.ts`, the one open dialog in `lib/commands.ts`; this
 * component subscribes to those and arranges the result. The exceptions are the
 * two things that are genuinely about this window and nothing else: whether the
 * start-up screen is still up, and whether the sidebar is showing.
 *
 * It is also where the app meets the operating system — the window title, files
 * dropped onto the window, and the close request that has to be answered before
 * anything is destroyed. All three are Tauri's, all three are effects, and each
 * one calls the teardown it was handed.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useSidebarOpen } from './lib/chrome';
import { installWheelZoom } from './lib/zoom';
import { useUiState } from './lib/commands';
import { documentsVersion, subscribeDocuments } from './lib/documents';
import { openPaths, startFileWatchers } from './lib/files';
import { startOpenRequests } from './lib/open-requests';
import { startGitWatch } from './lib/git';
import { t, useLanguage } from './lib/i18n';
import { startNotebook } from './lib/notebook';
import { ask } from './lib/prompt';
import { persistSession, restoreSession, startSessionAutosave } from './lib/session';
import { startNyu } from './lib/nyu';
import { useNyuHat } from './lib/nyu-progress';
import { installShortcuts } from './lib/shortcuts';
import { startUpdateCheck } from './lib/updates';
import { useWorkspace, windowTitle } from './lib/workspace';
import { useSettings } from './lib/settings';
import { useZen } from './lib/zen';
import { AboutDialog } from './components/AboutDialog';
import { CompareBar } from './components/CompareBar';
import { HashDialog } from './components/HashDialog';
import { CommandPalette } from './components/CommandPalette';
import { FindBar } from './components/FindBar';
import { GoToLine } from './components/GoToLine';
import { MacroDialog } from './components/MacroDialog';
import { SearchPanel } from './components/SearchPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/sidebar/Sidebar';
import { SplitContainer } from './components/SplitContainer';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { UpdateHint } from './components/UpdateHint';
import { PromptHost } from './components/PromptHost';
import { Nyu } from './components/nyu/Nyu';
import { ZenEdge, ZenHint } from './components/Zen';
import { hatParts } from './components/nyu/hats';
import { NyuCameos } from './components/nyu/companion/NyuCameos';
import { NyuDialog } from './components/nyu/companion/NyuDialog';
import { pickGreeting } from './components/nyu/greetings';

export function App() {
  useLanguage();
  const [ready, setReady] = useState(false);
  // Zen mode does not close the sidebar, it just does not draw it — so
  // leaving zen finds the sidebar exactly as it was. See `lib/zen.ts`.
  const zen = useZen();
  const sidebarOpen = useSidebarOpen() && !zen;
  const { zenWidth } = useSettings();
  const { dialog } = useUiState();
  const workspace = useWorkspace();
  const version = useSyncExternalStore(subscribeDocuments, documentsVersion);

  // The tabs come back before anything is drawn, so the first real paint is the
  // window the user left rather than an empty one that fills in afterwards.
  useEffect(() => {
    let gone = false;
    void restoreSession()
      .catch(() => undefined)
      .finally(() => {
        if (!gone) setReady(true);
      });
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => installShortcuts(), []);
  useEffect(() => startSessionAutosave(), []);
  useEffect(() => startNotebook(), []);
  useEffect(() => startFileWatchers(), []);
  useEffect(() => startGitWatch(), []);
  useEffect(() => startUpdateCheck(), []);
  useEffect(() => startOpenRequests(), []);
  useEffect(() => installWheelZoom(), []);
  useEffect(() => startNyu(), []);

  // `version` and `workspace` are not read, only depended on: between them they
  // cover every change the title is built from — the active tab, the file name,
  // the dirty dot and the open folder.
  useEffect(() => {
    void getCurrentWindow()
      .setTitle(windowTitle())
      .catch(() => undefined);
  }, [workspace, version]);

  // Files dropped onto the window from the file manager.
  useEffect(() => {
    let gone = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return;
        void openPaths(event.payload.paths);
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
  }, []);

  /**
   * The close guard, which asks nothing.
   *
   * Closing the window is not a decision about unsaved text: the session and
   * every draft go to disk, the window goes away, and the next start puts all
   * of it back — unsaved notes included, even with the restore setting off.
   * Tauri's close request is preventable, so the window stays up exactly as
   * long as that write takes. `destroy()` rather than `close()` on the way out,
   * because `close()` would come straight back here.
   *
   * The one question left is for the one case where that promise cannot be
   * kept: a draft or the session that did not reach the disk. Then closing
   * would cost text, and that is said plainly, never decided silently.
   */
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let gone = false;
    let unlisten: (() => void) | undefined;
    void appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        // A window closed while its tabs are still coming back must not write
        // a session that lists only the ones that made it so far.
        await restoreSession().catch(() => undefined);
        const saved = await persistSession().catch(() => false);
        if (!saved) {
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
          if (answer !== 'close') return;
        }
        await appWindow.destroy();
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
  }, []);

  if (!ready) return <Startup />;

  return (
    <div
      className="app"
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
      data-zen={zen ? true : undefined}
      style={zen ? ({ '--zen-columns': zenWidth } as CSSProperties) : undefined}
    >
      {/* Before the title bar on purpose: `styles/focus.css` reveals the bar
          from the edge strip with a sibling selector. */}
      {zen ? <ZenEdge edge="top" /> : null}
      <TitleBar />

      <div className="app-body">
        {sidebarOpen ? <Sidebar /> : null}
        <div className="app-editors">
          <CompareBar />
          <SplitContainer />
          {/* A bar and a panel, never a dialog: both of these are about the text
              behind them, and a modal over that text hides the answer. `find`
              and `replace` are the same bar — it reads the dialog slot itself
              to decide whether the replace row is showing. */}
          {dialog === 'find' || dialog === 'replace' ? <FindBar /> : null}
          {dialog === 'projectSearch' ? <SearchPanel /> : null}
        </div>
      </div>

      {/* Between the text and the status bar, and nothing at all when there is
          no update to mention: a new version is worth a row of the window and
          never a dialog over the file somebody is writing. */}
      {zen ? null : <UpdateHint />}

      {zen ? <ZenEdge edge="bottom" /> : null}
      <StatusBar />
      {zen ? <ZenHint /> : null}

      <NyuCameos />
      <Toasts />
      <PromptHost />

      {dialog === 'palette' ? <CommandPalette /> : null}
      {dialog === 'gotoLine' ? <GoToLine /> : null}
      {dialog === 'macros' ? <MacroDialog /> : null}
      {dialog === 'settings' ? <SettingsDialog /> : null}
      {dialog === 'about' ? <AboutDialog /> : null}
      {dialog === 'hash' ? <HashDialog /> : null}
      {dialog === 'nyu' ? <NyuDialog /> : null}
    </div>
  );
}

/**
 * What is on screen while the last session comes back.
 *
 * Usually for a single frame. It exists for the case where it is not — a folder
 * on a slow network share, a dozen large files — where an empty window would
 * look like the app had failed to start.
 */
function Startup() {
  // Empty when the tone is set to neutral, which is that setting asking for the
  // cat without the chatter.
  const greeting = pickGreeting('startup');
  const hat = useNyuHat();
  return (
    <div className="startup" role="status" aria-label={t('UwUNotes wird geladen')}>
      <Nyu size={96} mood="sparkle" {...hatParts(hat)} />
      {greeting ? <p className="startup-greeting">{greeting}</p> : null}
    </div>
  );
}
