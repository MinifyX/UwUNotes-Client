/**
 * The top of the window, in three rows.
 *
 * 1. **The brand row**: the suite's `<TitleBar>` from `@uwusuite/design` —
 *    Nyu and the word mark on the left, the three window buttons in the
 *    corner, because `decorations: false` in `tauri.conf.json` means there is
 *    no system frame. The empty stretch carries `data-tauri-drag-region`, so it
 *    moves the window when dragged and maximises it on a double-click, like
 *    any other title bar.
 * 2. **The menu row**: Datei, Suchen, Ansicht, Codierung, Sprache,
 *    Einstellungen, Werkzeuge. See `MenuBar.tsx` and `lib/menus.ts`.
 * 3. **The icon row**: the ten things reached for most, as icons only, each
 *    with its name and shortcut in the tooltip.
 *
 * Every button runs a command rather than calling into the file layer, so the
 * icon, the menu entry, the shortcut and the palette entry are one code path
 * and cannot drift apart.
 *
 * On macOS the first two rows are not drawn at all (the package's title bar
 * renders nothing there): the window has the system's title bar with the
 * traffic lights (`tauri.macos.conf.json`) and the menus are in the menu bar at
 * the top of the screen (`lib/native-menu.ts`). Only the icon row is left.
 */

import {
  Icon,
  TitleBar as SuiteTitleBar,
  Wordmark,
  ICONS,
  type IconMeaning,
} from '@uwusuite/design';
import { useTauriWindow } from '@uwusuite/design/tauri';
import { Fragment, useSyncExternalStore, type MouseEvent } from 'react';
import { allCommands, runCommand } from '../lib/commands';
import { useCompare } from '../lib/compare';
import { documentsVersion, subscribeDocuments } from '../lib/documents';
import { N_, t, useLanguage } from '../lib/i18n';
import { MENUS } from '../lib/menus';
import { isMac } from '../lib/platform';
import { shortcutLabel } from '../lib/shortcuts';
import { useWorkspace } from '../lib/workspace';
import { MenuBar } from './MenuBar';
import { Nyu } from './nyu/Nyu';

/**
 * The icon row, in groups, in the order the hand reaches for them. `N_()`
 * because the labels are decided here, before a language is, and translated
 * where they are drawn.
 */
const TOOLBAR: { command: string; icon: IconMeaning; label: string }[][] = [
  [
    { command: 'file.new', icon: 'newFile', label: N_('Neu') },
    { command: 'file.open', icon: 'folderOpen', label: N_('Öffnen') },
    { command: 'file.save', icon: 'save', label: N_('Speichern') },
    { command: 'file.saveAll', icon: 'saveAll', label: N_('Alle Dateien speichern') },
    { command: 'file.close', icon: 'closeFile', label: N_('Schließen') },
    { command: 'file.closeAll', icon: 'closeAll', label: N_('Alle schließen') },
  ],
  [{ command: 'file.print', icon: 'print', label: N_('Drucken') }],
  [
    { command: 'find.find', icon: 'search', label: N_('Suchen') },
    { command: 'find.replace', icon: 'replace', label: N_('Ersetzen') },
  ],
  [
    {
      command: 'view.compare',
      icon: 'compare',
      label: N_('Diff-Ansicht: zwei Dateien vergleichen'),
    },
  ],
];

/** `Speichern (Strg+S)`, or just the name when nothing is bound. */
function hint(label: string, command: string): string {
  const keys = shortcutLabel(command);
  return keys ? t('{action} ({keys})', { action: label, keys }) : label;
}

/**
 * Tauri maximises on a double-click of a drag region by itself (its drag
 * script), and the package's title bar does it again in React — the two would
 * cancel out. The capture phase runs first and keeps the second one away; the
 * window buttons are not drag regions, so they are never touched by this.
 */
function leaveDoubleClickToTauri(event: MouseEvent) {
  if ((event.target as HTMLElement).hasAttribute('data-tauri-drag-region')) {
    event.stopPropagation();
  }
}

function WindowRow() {
  // Only mounted off the Mac, where the window has no frame of its own.
  const controls = useTauriWindow();
  return (
    <div className="appheader-titlebar" onDoubleClickCapture={leaveDoubleClickToTauri}>
      <SuiteTitleBar
        platform="windows"
        controls={controls}
        brand={
          <>
            <Nyu size={22} blink={false} title="" />
            <Wordmark product="Notes" />
          </>
        }
      />
    </div>
  );
}

export function TitleBar() {
  useLanguage();
  // Neither is read directly; both decide which icons are greyed out.
  useWorkspace();
  useSyncExternalStore(subscribeDocuments, documentsVersion);
  const compare = useCompare();
  const mac = isMac();

  const commands = allCommands();
  const enabled = (id: string) => {
    const found = commands.find((entry) => entry.id === id);
    return found ? !found.enabled || found.enabled() : false;
  };

  return (
    <header className="appheader" data-platform={mac ? 'mac' : undefined}>
      {mac ? null : <WindowRow />}

      {mac ? null : <MenuBar menus={MENUS} />}

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
                <Icon icon={ICONS[action.icon]} size="md" />
              </button>
            ))}
          </Fragment>
        ))}
      </div>
    </header>
  );
}
