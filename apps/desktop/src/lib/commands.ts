/**
 * Everything the app can do, as one list.
 *
 * The command palette, the keyboard and any menu that ever gets built all run
 * the same entries, so a thing that works from one works from all three and the
 * "what is this bound to?" answer is written down once. Ids are stable strings
 * because `lib/shortcuts.ts` refers to them and a session file might one day
 * too; titles are functions because they are translated and the language can
 * change while the palette is open.
 *
 * Commands that open something — the palette itself, find, settings, about —
 * flip {@link openDialog} rather than calling into a component. The dialogs are
 * written by other agents and import *from* here; if this module imported them
 * back, the import graph would be a circle and the palette would be undefined
 * exactly when it is needed.
 */

import { useSyncExternalStore } from 'react';
import { redo, undo } from '@codemirror/commands';
import type { Eol } from './api';
import { ENCODINGS, EOLS, eolName } from './encodings';
import { allDocs, getMeta, patchMeta } from './documents';
import {
  closeAllSafely,
  closeDocSafely,
  hasClosedTabs,
  newFile,
  openFileDialog,
  openFolderDialog,
  reopenClosedTab,
  reopenWithEncoding,
  saveAll,
  saveDoc,
  setDocEncoding,
  setDocEol,
} from './files';
import { t } from './i18n';
import { nextPane, paneCount } from './layout';
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  getSettings,
  updateSettings,
} from './settings';
import { shortcutLabel } from './shortcuts';
import { toast } from './toast';
import { activeView, focusActiveView } from './views';
import {
  activeDocId,
  closePane,
  cyclePane,
  cycleTab,
  getWorkspace,
  moveTabToPane,
  splitActivePane,
  tabsIn,
} from './workspace';
import { applyDocLanguage } from '../editor/setup';
import { LANGUAGES } from '../editor/languages';

export type Command = {
  id: string;
  title: () => string;
  group: () => string;
  shortcut?: string;
  enabled?: () => boolean;
  run: () => void | Promise<void>;
};

/* ── The one bit of UI state that lives here ───────────── */

/**
 * Which overlay is open, if any.
 *
 * Exactly one at a time: a find bar behind a settings page behind a palette is
 * three Escape presses and no idea which one is listening.
 */
export type DialogName =
  'palette' | 'find' | 'replace' | 'projectSearch' | 'gotoLine' | 'settings' | 'about';

export type UiState = { readonly dialog: DialogName | null };

let ui: UiState = { dialog: null };
const uiListeners = new Set<() => void>();

function commitUi(next: UiState) {
  ui = next;
  for (const listener of uiListeners) listener();
}

function subscribeUi(listener: () => void): () => void {
  uiListeners.add(listener);
  return () => uiListeners.delete(listener);
}

export function getUiState(): UiState {
  return ui;
}

export function useUiState(): UiState {
  return useSyncExternalStore(subscribeUi, getUiState);
}

export function openDialog(name: DialogName): void {
  if (ui.dialog !== name) commitUi({ dialog: name });
}

export function closeDialog(): void {
  if (ui.dialog === null) return;
  commitUi({ dialog: null });
  // Whatever was open had the keyboard. Without this the next keystroke goes
  // into the void instead of into the file.
  focusActiveView();
}

export function toggleDialog(name: DialogName): void {
  if (ui.dialog === name) closeDialog();
  else openDialog(name);
}

/* ── Running ───────────────────────────────────────────── */

export function allCommands(): Command[] {
  return [
    ...fileCommands(),
    ...editCommands(),
    ...searchCommands(),
    ...viewCommands(),
    ...encodingCommands(),
    ...eolCommands(),
    ...languageCommands(),
    ...appCommands(),
  ];
}

export function runCommand(id: string): void {
  const command = allCommands().find((entry) => entry.id === id);
  if (!command) return;
  // A disabled command reached by shortcut is a no-op, not an error: Ctrl+W
  // with nothing open should do nothing quietly.
  if (command.enabled && !command.enabled()) return;
  void Promise.resolve(command.run()).catch((error: unknown) => {
    toast('error', t('Befehl fehlgeschlagen: {message}', { message: String(error) }));
  });
}

/**
 * Commands matching `query`, best first.
 *
 * A subsequence match rather than a substring one, so `spa` finds "Speichern
 * als…" — which is how everyone types into a palette once they trust it. The
 * score is the number of characters skipped, so a tight early match wins.
 */
export function matchCommands(query: string): Command[] {
  const available = allCommands().filter((command) => !command.enabled || command.enabled());
  const needle = query.trim().toLowerCase();
  if (!needle) return available;

  const scored: { command: Command; score: number }[] = [];
  for (const command of available) {
    const score = scoreMatch(`${command.group()} ${command.title()}`.toLowerCase(), needle);
    if (score !== null) scored.push({ command, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.map((entry) => entry.command);
}

function scoreMatch(haystack: string, needle: string): number | null {
  let from = 0;
  let previous = -1;
  let score = 0;
  for (const character of needle) {
    if (character === ' ') continue;
    const at = haystack.indexOf(character, from);
    if (at < 0) return null;
    // Gaps cost, and a first hit deep in the string costs its whole offset.
    score += previous < 0 ? at : at - previous - 1;
    previous = at;
    from = at + 1;
  }
  return score;
}

/* ── The list ──────────────────────────────────────────── */

function fileCommands(): Command[] {
  const group = () => t('Datei');
  const hasDoc = () => activeDocId() !== null;
  return [
    {
      id: 'file.new',
      title: () => t('Neue Datei'),
      group,
      shortcut: shortcutLabel('file.new'),
      run: newFile,
    },
    {
      id: 'file.open',
      title: () => t('Datei öffnen…'),
      group,
      shortcut: shortcutLabel('file.open'),
      run: openFileDialog,
    },
    {
      id: 'file.openFolder',
      title: () => t('Ordner öffnen…'),
      group,
      shortcut: shortcutLabel('file.openFolder'),
      run: openFolderDialog,
    },
    {
      id: 'file.save',
      title: () => t('Speichern'),
      group,
      shortcut: shortcutLabel('file.save'),
      enabled: hasDoc,
      run: async () => {
        const id = activeDocId();
        if (id) await saveDoc(id);
      },
    },
    {
      id: 'file.saveAs',
      title: () => t('Speichern unter…'),
      group,
      shortcut: shortcutLabel('file.saveAs'),
      enabled: hasDoc,
      run: async () => {
        const id = activeDocId();
        if (id) await saveDoc(id, true);
      },
    },
    {
      id: 'file.saveAll',
      title: () => t('Alles speichern'),
      group,
      enabled: () => allDocs().some((doc) => doc.meta.dirty),
      run: saveAll,
    },
    {
      id: 'file.close',
      title: () => t('Tab schließen'),
      group,
      shortcut: shortcutLabel('file.close'),
      enabled: hasDoc,
      run: async () => {
        const id = activeDocId();
        if (id) await closeDocSafely(id);
      },
    },
    {
      id: 'file.closeAll',
      title: () => t('Alle Tabs schließen'),
      group,
      shortcut: shortcutLabel('file.closeAll'),
      enabled: hasDoc,
      run: async () => {
        await closeAllSafely();
      },
    },
    {
      id: 'file.reopenClosed',
      title: () => t('Geschlossenen Tab wiederherstellen'),
      group,
      shortcut: shortcutLabel('file.reopenClosed'),
      enabled: hasClosedTabs,
      run: reopenClosedTab,
    },
  ];
}

function editCommands(): Command[] {
  const group = () => t('Bearbeiten');
  const hasView = () => activeView() !== undefined;
  return [
    {
      id: 'edit.undo',
      title: () => t('Rückgängig'),
      group,
      enabled: hasView,
      run: () => {
        const view = activeView();
        if (view) undo(view);
      },
    },
    {
      id: 'edit.redo',
      title: () => t('Wiederholen'),
      group,
      enabled: hasView,
      run: () => {
        const view = activeView();
        if (view) redo(view);
      },
    },
  ];
}

function searchCommands(): Command[] {
  const group = () => t('Suchen');
  const hasDoc = () => activeDocId() !== null;
  return [
    {
      id: 'find.find',
      title: () => t('Suchen'),
      group,
      shortcut: shortcutLabel('find.find'),
      enabled: hasDoc,
      run: () => openDialog('find'),
    },
    {
      id: 'find.replace',
      title: () => t('Ersetzen'),
      group,
      shortcut: shortcutLabel('find.replace'),
      enabled: hasDoc,
      run: () => openDialog('replace'),
    },
    {
      id: 'find.inFiles',
      title: () => t('In Dateien suchen'),
      group,
      shortcut: shortcutLabel('find.inFiles'),
      run: () => openDialog('projectSearch'),
    },
    {
      id: 'find.gotoLine',
      title: () => t('Gehe zu Zeile…'),
      group,
      shortcut: shortcutLabel('find.gotoLine'),
      enabled: hasDoc,
      run: () => openDialog('gotoLine'),
    },
  ];
}

function viewCommands(): Command[] {
  const group = () => t('Ansicht');
  const split = () => paneCount(getWorkspace().layout) > 1;
  const manyTabs = () => tabsIn(getWorkspace().activePane).length > 1;
  return [
    {
      id: 'tab.next',
      title: () => t('Nächster Tab'),
      group,
      shortcut: shortcutLabel('tab.next'),
      enabled: manyTabs,
      run: () => cycleTab(),
    },
    {
      id: 'tab.previous',
      title: () => t('Vorheriger Tab'),
      group,
      shortcut: shortcutLabel('tab.previous'),
      enabled: manyTabs,
      run: () => cycleTab(true),
    },
    {
      id: 'view.splitRight',
      title: () => t('Nach rechts teilen'),
      group,
      shortcut: shortcutLabel('view.splitRight'),
      run: () => splitActivePane('horizontal'),
    },
    {
      id: 'view.splitDown',
      title: () => t('Nach unten teilen'),
      group,
      shortcut: shortcutLabel('view.splitDown'),
      run: () => splitActivePane('vertical'),
    },
    {
      id: 'view.closePane',
      title: () => t('Bereich schließen'),
      group,
      shortcut: shortcutLabel('view.closePane'),
      enabled: split,
      run: () => closePane(getWorkspace().activePane),
    },
    {
      id: 'view.nextPane',
      title: () => t('Nächster Bereich'),
      group,
      shortcut: shortcutLabel('view.nextPane'),
      enabled: split,
      run: () => cyclePane(),
    },
    {
      id: 'view.moveTabToOtherPane',
      title: () => t('Tab in den anderen Bereich verschieben'),
      group,
      shortcut: shortcutLabel('view.moveTabToOtherPane'),
      enabled: () => split() && activeDocId() !== null,
      run: () => {
        const doc = activeDocId();
        const workspace = getWorkspace();
        const target = nextPane(workspace.layout, workspace.activePane);
        if (doc && target !== workspace.activePane) moveTabToPane(doc, target);
      },
    },
    {
      id: 'view.toggleWrap',
      title: () => t('Zeilenumbruch umschalten'),
      group,
      run: () => updateSettings({ wrap: getSettings().wrap === 'off' ? 'window' : 'off' }),
    },
    {
      id: 'view.toggleMinimap',
      title: () => t('Minimap umschalten'),
      group,
      run: () => updateSettings({ minimap: !getSettings().minimap }),
    },
    {
      id: 'view.toggleLineNumbers',
      title: () => t('Zeilennummern umschalten'),
      group,
      run: () => updateSettings({ lineNumbers: !getSettings().lineNumbers }),
    },
    {
      id: 'view.toggleWhitespace',
      title: () => t('Leerzeichen anzeigen'),
      group,
      run: () => updateSettings({ showWhitespace: !getSettings().showWhitespace }),
    },
    {
      id: 'view.zoomIn',
      title: () => t('Schrift vergrößern'),
      group,
      shortcut: shortcutLabel('view.zoomIn'),
      enabled: () => getSettings().fontSize < FONT_SIZE_MAX,
      run: () => updateSettings({ fontSize: getSettings().fontSize + 1 }),
    },
    {
      id: 'view.zoomOut',
      title: () => t('Schrift verkleinern'),
      group,
      shortcut: shortcutLabel('view.zoomOut'),
      enabled: () => getSettings().fontSize > FONT_SIZE_MIN,
      run: () => updateSettings({ fontSize: getSettings().fontSize - 1 }),
    },
    {
      id: 'view.zoomReset',
      title: () => t('Schriftgröße zurücksetzen'),
      group,
      shortcut: shortcutLabel('view.zoomReset'),
      run: () => updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize }),
    },
  ];
}

/**
 * Two commands per encoding, because they are genuinely two different wishes:
 * "this file was decoded wrong, read it again" and "write this file as
 * something else next time".
 */
function encodingCommands(): Command[] {
  const group = () => t('Bearbeiten');
  const commands: Command[] = [];
  for (const entry of ENCODINGS) {
    commands.push({
      id: `encoding.write.${entry.label}`,
      title: () => t('Speichern als {encoding}', { encoding: entry.name }),
      group,
      enabled: () => activeDocId() !== null,
      run: () => {
        const id = activeDocId();
        if (id) setDocEncoding(id, entry.label);
      },
    });
    commands.push({
      id: `encoding.reopen.${entry.label}`,
      title: () => t('Neu öffnen mit {encoding}', { encoding: entry.name }),
      group,
      // Only a file on disk can be read a second time.
      enabled: () => {
        const id = activeDocId();
        return id !== null && Boolean(getMeta(id)?.path);
      },
      run: async () => {
        const id = activeDocId();
        if (id) await reopenWithEncoding(id, entry.label);
      },
    });
  }
  commands.push({
    id: 'encoding.toggleBom',
    title: () => t('Byte-Order-Mark umschalten'),
    group,
    enabled: () => activeDocId() !== null,
    run: () => {
      const id = activeDocId();
      const meta = id ? getMeta(id) : undefined;
      if (id && meta) patchMeta(id, { bom: !meta.bom });
    },
  });
  return commands;
}

function eolCommands(): Command[] {
  const group = () => t('Bearbeiten');
  return EOLS.map((eol: Eol) => ({
    id: `eol.${eol}`,
    title: () => t('Zeilenenden: {eol}', { eol: eolName(eol) }),
    group,
    enabled: () => activeDocId() !== null,
    run: () => {
      const id = activeDocId();
      if (id) setDocEol(id, eol);
    },
  }));
}

function languageCommands(): Command[] {
  const group = () => t('Sprache');
  const hasDoc = () => activeDocId() !== null;

  const setLanguage = async (languageId: string | null) => {
    const id = activeDocId();
    if (!id) return;
    patchMeta(id, { languageOverride: languageId });
    await applyDocLanguage(id);
  };

  const commands: Command[] = [
    {
      id: 'language.auto',
      title: () => t('Sprache: automatisch erkennen'),
      group,
      enabled: hasDoc,
      run: () => setLanguage(null),
    },
  ];
  for (const language of LANGUAGES) {
    commands.push({
      id: `language.${language.id}`,
      title: () => t('Sprache: {name}', { name: language.name }),
      group,
      enabled: hasDoc,
      run: () => setLanguage(language.id),
    });
  }
  return commands;
}

function appCommands(): Command[] {
  const group = () => t('Einstellungen');
  return [
    {
      id: 'app.palette',
      title: () => t('Befehlspalette'),
      group,
      shortcut: shortcutLabel('app.palette'),
      run: () => toggleDialog('palette'),
    },
    {
      id: 'app.settings',
      title: () => t('Einstellungen'),
      group,
      shortcut: shortcutLabel('app.settings'),
      run: () => openDialog('settings'),
    },
    {
      id: 'app.about',
      title: () => t('Über UwUNotes'),
      group,
      run: () => openDialog('about'),
    },
  ];
}
