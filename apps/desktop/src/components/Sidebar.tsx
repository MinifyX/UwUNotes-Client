/**
 * The panel the file tree lives in.
 *
 * A folder is a convenience and not a project: the app is perfectly happy with
 * four loose files and no folder at all, which is why this component has a
 * second face — an invitation with the recent folders on it — rather than an
 * empty box with a disabled tree in it.
 *
 * Everything that touches the tree's own state (a new file, collapsing
 * everything, re-reading a folder) goes through {@link FileTreeHandle}: the
 * header belongs to the panel and the state belongs to the tree, and hoisting
 * the whole tree up here so that a button could reach it would be the wrong
 * half moving.
 *
 * Showing and hiding the panel is not its business — `TitleBar.tsx` has that
 * switch, and two of them would be two answers to the same question.
 */

import { useRef, useState } from 'react';
import { openFolder, openFolderDialog } from '../lib/files';
import { useGitBranch } from '../lib/git';
import { t } from '../lib/i18n';
import { setFolder, useWorkspace } from '../lib/workspace';
import { NyuScene } from './nyu/scenes';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { FileTree, type FileTreeHandle } from './FileTree';
import { Icon } from './Icon';

/** How long the overflow button refuses to reopen a menu it just closed. */
const REOPEN_GUARD_MS = 300;

/** The last segment of a path, whichever slash the platform uses. */
function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function Sidebar() {
  const { folder, recentFolders } = useWorkspace();
  const branch = useGitBranch();
  const tree = useRef<FileTreeHandle | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  /**
   * When the overflow menu last closed itself.
   *
   * The menu closes on the pointerdown that lands outside it, and the click
   * that follows the *same* pointerdown is the one that would open it again —
   * so without this, clicking the open menu's own button makes the menu look
   * stuck. Same reasoning, same number, as `StatusBar.tsx`.
   */
  const menuClosedAt = useRef(0);

  if (!folder) {
    return (
      <aside className="sidebar sidebar-empty" aria-label={t('Ordner')}>
        <NyuScene name="empty" className="sidebar-empty-scene" />
        <p className="sidebar-empty-text">
          {t('Kein Ordner geöffnet. Einzelne Dateien gehen trotzdem.')}
        </p>
        <button
          type="button"
          className="sidebar-open-button"
          onClick={() => void openFolderDialog()}
        >
          {t('Ordner öffnen…')}
        </button>

        {recentFolders.length > 0 && (
          <nav className="sidebar-recent" aria-label={t('Zuletzt geöffnete Ordner')}>
            <h2 className="sidebar-recent-title">{t('Zuletzt geöffnet')}</h2>
            <ul className="sidebar-recent-list">
              {recentFolders.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="sidebar-recent-item"
                    title={path}
                    onClick={() => openFolder(path)}
                  >
                    <span className="sidebar-recent-name">{folderName(path)}</span>
                    <span className="sidebar-recent-path">{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
    );
  }

  const menuItems: ContextMenuItem[] = [
    { id: 'refresh', label: t('Ordner neu einlesen'), run: () => tree.current?.refresh() },
    { id: 'switch', label: t('Anderen Ordner öffnen…'), run: () => void openFolderDialog() },
    { id: 'close', label: t('Ordner schließen'), run: () => setFolder(null) },
  ];

  return (
    <aside className="sidebar" aria-label={t('Ordner')}>
      <header className="sidebar-header">
        <h2 className="sidebar-title" title={folder}>
          {folderName(folder)}
        </h2>
        <div className="sidebar-actions">
          <button
            type="button"
            className="sidebar-action"
            title={t('Neue Datei')}
            onClick={() => tree.current?.newFile()}
          >
            <Icon name="plus" size={14} title={t('Neue Datei')} />
          </button>
          <button
            type="button"
            className="sidebar-action"
            title={t('Neuer Ordner')}
            onClick={() => tree.current?.newFolder()}
          >
            <Icon name="folder" size={14} title={t('Neuer Ordner')} />
          </button>
          <button
            type="button"
            className="sidebar-action"
            title={t('Alles zuklappen')}
            onClick={() => tree.current?.collapseAll()}
          >
            <Icon name="minus" size={14} title={t('Alles zuklappen')} />
          </button>
          <button
            type="button"
            className="sidebar-action"
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            title={t('Weitere Ordneraktionen')}
            onClick={(event) => {
              if (Date.now() - menuClosedAt.current < REOPEN_GUARD_MS) return;
              const box = event.currentTarget.getBoundingClientRect();
              setMenuAt({ x: box.left, y: box.bottom });
            }}
          >
            <Icon name="dots" size={14} title={t('Weitere Ordneraktionen')} />
          </button>
        </div>
      </header>

      {/* Keyed on the folder so switching projects starts a fresh tree rather
          than one carrying the old one's open folders and selection. */}
      <FileTree key={folder} ref={tree} root={folder} />

      <footer className="sidebar-footer">
        {branch ? (
          <span className="sidebar-branch" title={t('Aktueller Git-Branch')}>
            <Icon name="gitBranch" size={13} />
            <span className="sidebar-branch-name">{branch}</span>
          </span>
        ) : (
          <span className="sidebar-path" title={folder}>
            {folder}
          </span>
        )}
      </footer>

      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          label={t('Ordner')}
          items={menuItems}
          onClose={() => {
            menuClosedAt.current = Date.now();
            setMenuAt(null);
          }}
        />
      )}
    </aside>
  );
}
