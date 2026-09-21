/**
 * The top of the window, in three rows.
 *
 * 1. **The brand row**: Nyu and the word mark, and nothing else — except the
 *    three window buttons in the corner, which have to live somewhere because
 *    `decorations: false` in `tauri.conf.json` means there is no system frame.
 *    This row *is* the frame: the whole stretch carries
 *    `data-tauri-drag-region`, so it moves the window when dragged and
 *    maximises it on a double-click, like any other title bar.
 * 2. **The menu row**: Datei, Suchen, Ansicht, Codierung, Sprache,
 *    Einstellungen, Werkzeuge. See `MenuBar.tsx` and `lib/menus.ts`.
 * 3. **The icon row**: the ten things reached for most, as icons only, each
 *    with its name and shortcut in the tooltip.
 *
 * Every button runs a command rather than calling into the file layer, so the
 * icon, the menu entry, the shortcut and the palette entry are one code path
 * and cannot drift apart.
 *
 * The window buttons are Windows' own size — 46 px wide, the full height of the
 * row — because that is what the corner of every other window on the machine
 * feels like, and close turns brand pink on hover, as in UwUMail and UwUSSH.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { allCommands, runCommand } from '../lib/commands';
import { useCompare } from '../lib/compare';
import { documentsVersion, subscribeDocuments } from '../lib/documents';
import { N_, t, useLanguage } from '../lib/i18n';
import { MENUS } from '../lib/menus';
import { shortcutLabel } from '../lib/shortcuts';
import { useWorkspace } from '../lib/workspace';
import { Icon, type IconName } from './Icon';
import { MenuBar } from './MenuBar';
import { Nyu } from './nyu/Nyu';

/**
 * The icon row, in groups, in the order the hand reaches for them. `N_()`
 * because the labels are decided here, before a language is, and translated
 * where they are drawn.
 */
const TOOLBAR: { command: string; icon: IconName; label: string }[][] = [
  [
    { command: 'file.new', icon: 'filePlus', label: N_('Neu') },
    { command: 'file.open', icon: 'folderOpen', label: N_('Öffnen') },
    { command: 'file.save', icon: 'save', label: N_('Speichern') },
    { command: 'file.saveAll', icon: 'saveAll', label: N_('Alle Dateien speichern') },
    { command: 'file.close', icon: 'fileClose', label: N_('Schließen') },
    { command: 'file.closeAll', icon: 'closeAll', label: N_('Alle schließen') },
  ],
  [{ command: 'file.print', icon: 'print', label: N_('Drucken') }],
  [
    { command: 'find.find', icon: 'search', label: N_('Suchen') },
    { command: 'find.replace', icon: 'replace', label: N_('Ersetzen') },
  ],
  [{ command: 'view.compare', icon: 'diff', label: N_('Diff-Ansicht: zwei Dateien vergleichen') }],
];

/** `Speichern (Strg+S)`, or just the name when nothing is bound. */
function hint(label: string, command: string): string {
  const keys = shortcutLabel(command);
  return keys ? t('{action} ({keys})', { action: label, keys }) : label;
}

export function TitleBar() {
  useLanguage();
  // Neither is read directly; both decide which icons are greyed out.
  useWorkspace();
  useSyncExternalStore(subscribeDocuments, documentsVersion);
  const compare = useCompare();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const window = getCurrentWindow();
    let gone = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void window
        .isMaximized()
        .then((value) => {
          if (!gone) setMaximized(value);
        })
        .catch(() => undefined);
    };
    sync();
    void window
      .onResized(sync)
      .then((stop) => {
        // The listener can land after the component is gone; drop it straight
        // away rather than leaving it to fire into nothing.
        if (gone) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  const commands = allCommands();
  const enabled = (id: string) => {
    const found = commands.find((entry) => entry.id === id);
    return found ? !found.enabled || found.enabled() : false;
  };

  return (
    <header className="appheader">
      <div className="titlebar" data-tauri-drag-region>
        <span className="titlebar-brand" data-tauri-drag-region>
          <Nyu size={22} blink={false} title="UwUNotes" />
          <span className="titlebar-wordmark" data-tauri-drag-region>
            <span>UwU</span>Notes
          </span>
        </span>

        <span className="titlebar-spacer" data-tauri-drag-region />

        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            onClick={() => void getCurrentWindow().minimize()}
            aria-label={t('Minimieren')}
            title={t('Minimieren')}
          >
            <svg
              viewBox="0 0 10 10"
              aria-hidden
              focusable="false"
              stroke="currentColor"
              fill="none"
            >
              <path d="M0 5.5h10" />
            </svg>
          </button>
          <button
            type="button"
            className="window-control"
            onClick={() => void getCurrentWindow().toggleMaximize()}
            aria-label={maximized ? t('Verkleinern') : t('Maximieren')}
            title={maximized ? t('Verkleinern') : t('Maximieren')}
          >
            <svg
              viewBox="0 0 10 10"
              aria-hidden
              focusable="false"
              stroke="currentColor"
              fill="none"
            >
              {maximized ? (
                <path d="M2.5 2.5V.5h7v7h-2 M.5 2.5h7v7h-7z" />
              ) : (
                <path d="M.5.5h9v9h-9z" />
              )}
            </svg>
          </button>
          <button
            type="button"
            className="window-control window-control-close"
            // `close()`, not `destroy()`: this has to go through the window's
            // close request so `App.tsx` can ask about unsaved files first.
            onClick={() => void getCurrentWindow().close()}
            aria-label={t('Schließen')}
            title={t('Schließen')}
          >
            <svg
              viewBox="0 0 10 10"
              aria-hidden
              focusable="false"
              stroke="currentColor"
              fill="none"
            >
              <path d="M.5.5l9 9 M9.5.5l-9 9" />
            </svg>
          </button>
        </div>
      </div>

      <MenuBar menus={MENUS} />

      <div className="toolbar" role="toolbar" aria-label={t('Werkzeugleiste')}>
        {TOOLBAR.map((group, index) => (
          <Fragment key={group[0]!.command}>
            {index > 0 ? <span className="toolbar-separator" aria-hidden /> : null}
            {group.map((action) => (
              <button
                key={action.command}
                type="button"
                className="toolbar-button"
                onClick={() => runCommand(action.command)}
                disabled={!enabled(action.command)}
                aria-label={t(action.label)}
                aria-pressed={action.command === 'view.compare' ? compare.active : undefined}
                title={hint(t(action.label), action.command)}
              >
                <Icon name={action.icon} size={17} />
              </button>
            ))}
          </Fragment>
        ))}
      </div>
    </header>
  );
}
