/**
 * The window's own title bar.
 *
 * `decorations: false` in `tauri.conf.json`, so there is no system frame: this
 * bar *is* the frame. Moving the window, minimising, maximising and closing all
 * happen here, and the empty stretch in the middle carries
 * `data-tauri-drag-region` so it behaves like a title bar when dragged.
 *
 * The window buttons are Windows' own size — 46 px wide, the full height of the
 * bar — because that is what the corner of every other window on the machine
 * feels like, and close turns brand pink on hover, as in UwUMail and UwUSSH.
 *
 * The toolbar buttons run commands rather than calling into the file layer, so
 * the button, the keyboard shortcut and the palette entry are the same code
 * path and cannot drift. The one thing this bar owns outright is the sidebar
 * toggle, and even that only reports a click upwards: `App.tsx` holds the state,
 * because the keyboard has to be able to change it too.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { runCommand } from '../lib/commands';
import { documentsVersion, getMeta, subscribeDocuments } from '../lib/documents';
import { N_, t, useLanguage } from '../lib/i18n';
import { shortcutLabel } from '../lib/shortcuts';
import { activeDocId, useWorkspace } from '../lib/workspace';
import { Icon, type IconName } from './Icon';
import { Nyu } from './nyu/Nyu';

type TitleBarProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
};

/**
 * The buttons, in the order the hand reaches for them.
 *
 * `N_()` because the labels are decided here, before a language is, and
 * translated below where they are drawn.
 */
const ACTIONS: { command: string; icon: IconName; label: string }[] = [
  { command: 'file.new', icon: 'plus', label: N_('Neue Datei') },
  { command: 'file.open', icon: 'folder', label: N_('Datei öffnen…') },
  { command: 'file.save', icon: 'save', label: N_('Speichern') },
  { command: 'find.find', icon: 'search', label: N_('Suchen') },
  { command: 'app.palette', icon: 'palette', label: N_('Befehlspalette') },
];

/** `Speichern (Strg+S)`, or just the name when nothing is bound. */
function hint(label: string, command: string): string {
  const keys = shortcutLabel(command);
  return keys ? t('{action} ({keys})', { action: label, keys }) : label;
}

export function TitleBar({ sidebarOpen, onToggleSidebar }: TitleBarProps) {
  useLanguage();
  useWorkspace();
  useSyncExternalStore(subscribeDocuments, documentsVersion);
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

  const docId = activeDocId();
  const meta = docId ? getMeta(docId) : undefined;
  const hasDoc = meta !== undefined;

  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-brand" data-tauri-drag-region>
        <Nyu size={20} blink={false} title="UwUNotes" />
        <span className="titlebar-wordmark" data-tauri-drag-region>
          <span>UwU</span>Notes
        </span>
      </span>

      <button
        type="button"
        className="titlebar-action"
        onClick={onToggleSidebar}
        aria-pressed={sidebarOpen}
        aria-label={t('Seitenleiste')}
        // Spelled out here rather than looked up: Ctrl+B is bound in `App.tsx`,
        // not in the shared table, because the state it toggles lives there too.
        title={t('{action} ({keys})', {
          action: t('Seitenleiste'),
          keys: `${t('Strg')}+B`,
        })}
      >
        <Icon name="sidebar" size={16} />
      </button>

      <span className="titlebar-tools">
        {ACTIONS.map((action) => (
          <button
            key={action.command}
            type="button"
            className="titlebar-action"
            onClick={() => runCommand(action.command)}
            disabled={action.command === 'file.save' && !hasDoc}
            aria-label={t(action.label)}
            title={hint(t(action.label), action.command)}
          >
            <Icon name={action.icon} size={16} />
          </button>
        ))}
      </span>

      {/* The file name sits in the draggable stretch: it is the window's title,
          and a title bar you cannot grab by its title is a strange thing. */}
      <span className="titlebar-file" data-tauri-drag-region>
        {meta ? (
          <>
            <span className="titlebar-file-name" data-tauri-drag-region>
              {meta.name}
            </span>
            {meta.dirty ? (
              <span className="titlebar-file-dirty" title={t('Ungespeicherte Änderungen')}>
                •
              </span>
            ) : null}
          </>
        ) : null}
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
          <svg viewBox="0 0 10 10" aria-hidden focusable="false" stroke="currentColor" fill="none">
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
          <svg viewBox="0 0 10 10" aria-hidden focusable="false" stroke="currentColor" fill="none">
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
          <svg viewBox="0 0 10 10" aria-hidden focusable="false" stroke="currentColor" fill="none">
            <path d="M.5.5l9 9 M9.5.5l-9 9" />
          </svg>
        </button>
      </div>
    </header>
  );
}
