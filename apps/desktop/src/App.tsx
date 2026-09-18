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
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useUiState } from './lib/commands';
import { documentsVersion, subscribeDocuments } from './lib/documents';
import { closeAllSafely, openPaths, startFileWatchers } from './lib/files';
import { startGitWatch } from './lib/git';
import { t, useLanguage } from './lib/i18n';
import { persistSession, restoreSession, startSessionAutosave } from './lib/session';
import { installShortcuts } from './lib/shortcuts';
import { useWorkspace, windowTitle } from './lib/workspace';
import { AboutDialog } from './components/AboutDialog';
import { CommandPalette } from './components/CommandPalette';
import { FindBar } from './components/FindBar';
import { GoToLine } from './components/GoToLine';
import { SearchPanel } from './components/SearchPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { SplitContainer } from './components/SplitContainer';
import { StatusBar } from './components/StatusBar';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { PromptHost } from './components/PromptHost';
import { Nyu } from './components/nyu/Nyu';
import { pickGreeting } from './components/nyu/greetings';

/** Whether the sidebar was showing last time. Per machine, not per session file. */
const SIDEBAR_KEY = 'uwunotes.sidebar';

function loadSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== 'closed';
  } catch {
    // Storage can be unavailable in a locked-down webview; showing it is the
    // friendlier default for someone who has never seen the window before.
    return true;
  }
}

export function App() {
  useLanguage();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen);
  const { dialog } = useUiState();
  const workspace = useWorkspace();
  const version = useSyncExternalStore(subscribeDocuments, documentsVersion);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? 'open' : 'closed');
      } catch {
        // The preference is lost on restart; the window is still correct now.
      }
      return next;
    });
  }, []);

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
  useEffect(() => startFileWatchers(), []);
  useEffect(() => startGitWatch(), []);

  /**
   * Ctrl+B, for the sidebar.
   *
   * Here rather than in `lib/shortcuts.ts`, because the state it toggles lives
   * here: a binding in the shared table would have to reach back into this
   * component through a global, which is a lot of machinery for one boolean.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      if (event.code !== 'KeyB') return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

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
   * The close guard.
   *
   * Tauri's close request is preventable, so the window stays up until every
   * dirty file has been answered for. `destroy()` rather than `close()` on the
   * way out, because `close()` would come straight back here and ask again.
   *
   * The session is written *before* the questions, not after: by the time
   * `closeAllSafely` resolves there are no documents left to write down, and a
   * session file recording an empty window is how "restore my tabs" quietly
   * stops working.
   */
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let gone = false;
    let unlisten: (() => void) | undefined;
    void appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await persistSession().catch(() => undefined);
        if (await closeAllSafely()) await appWindow.destroy();
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
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <TitleBar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />

      <div className="app-body">
        {sidebarOpen ? <Sidebar /> : null}
        <div className="app-editors">
          <SplitContainer />
          {/* A bar and a panel, never a dialog: both of these are about the text
              behind them, and a modal over that text hides the answer. `find`
              and `replace` are the same bar — it reads the dialog slot itself
              to decide whether the replace row is showing. */}
          {dialog === 'find' || dialog === 'replace' ? <FindBar /> : null}
          {dialog === 'projectSearch' ? <SearchPanel /> : null}
        </div>
      </div>

      <StatusBar />

      <Toasts />
      <PromptHost />

      {dialog === 'palette' ? <CommandPalette /> : null}
      {dialog === 'gotoLine' ? <GoToLine /> : null}
      {dialog === 'settings' ? <SettingsDialog /> : null}
      {dialog === 'about' ? <AboutDialog /> : null}
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
  return (
    <div className="startup" role="status" aria-label={t('UwUNotes wird geladen')}>
      <Nyu size={96} mood="sparkle" />
      {greeting ? <p className="startup-greeting">{greeting}</p> : null}
    </div>
  );
}
