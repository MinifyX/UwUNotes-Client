/**
 * What is in the menu row, as data.
 *
 * Almost every entry is a command from `lib/commands.ts`, looked up by id, so
 * its label, its shortcut and whether it is greyed out come from the one place
 * that also feeds the palette and the keyboard. The few entries that are not
 * commands — a recent file, a language under its letter — are built here
 * because they are lists, and a command per recent file would be a command
 * that vanishes when the list changes.
 *
 * Every list is a function, called when its menu opens: what is ticked, what
 * is greyed and which files are recent is always read at that moment.
 */

import { allCommands, runCommand, type Command } from './commands';
import { getCompare } from './compare';
import { getMeta, patchMeta } from './documents';
import { ENCODINGS, EOLS, eolName, encodingGroupName, type EncodingGroup } from './encodings';
import { openPaths, reopenWithEncoding, setDocEncoding, setDocEol } from './files';
import { sidebarOpen } from './chrome';
import { HASH_ALGORITHMS } from './hash-tool';
import { N_, t } from './i18n';
import { paneCount } from './layout';
import { getSettings } from './settings';
import { activeDocId, forgetRecents, getWorkspace } from './workspace';
import { LANGUAGES, PLAIN_TEXT, resolveLanguage } from '../editor/languages';
import { applyDocLanguage } from '../editor/setup';

export type MenuEntry =
  | {
      kind: 'item';
      id: string;
      label: string;
      shortcut?: string;
      /** A longer text for the tooltip — the full path of a recent file. */
      hint?: string;
      disabled?: boolean;
      /** A tick in the gutter; `undefined` means the entry is not a toggle. */
      checked?: boolean;
      run: () => void;
    }
  | { kind: 'separator'; id: string }
  | { kind: 'submenu'; id: string; label: string; disabled?: boolean; items: () => MenuEntry[] };

export type TopMenu = { id: string; label: () => string; items: () => MenuEntry[] };

/** How many recent files the Open submenu lists. The workspace keeps twenty. */
const RECENT_SHOWN = 15;

let separators = 0;
function separator(): MenuEntry {
  separators += 1;
  return { kind: 'separator', id: `separator-${separators}` };
}

/**
 * A command as a menu entry. `label` overrides the palette title where the
 * menu wants a shorter one ("Speichern unter…" rather than the palette's
 * group-qualified wording); `checked` turns it into a toggle.
 */
function command(
  id: string,
  options: { label?: string; checked?: boolean } = {},
  commands: Command[] = allCommands(),
): MenuEntry {
  const found = commands.find((entry) => entry.id === id);
  if (!found)
    return { kind: 'item', id, label: options.label ?? id, disabled: true, run: () => undefined };
  return {
    kind: 'item',
    id,
    label: options.label ?? found.title(),
    shortcut: found.shortcut,
    checked: options.checked,
    disabled: found.enabled ? !found.enabled() : false,
    run: () => runCommand(id),
  };
}

/* ── Datei ─────────────────────────────────────────────── */

function recentFiles(): MenuEntry[] {
  const recent = getWorkspace().recentFiles.slice(0, RECENT_SHOWN);
  if (recent.length === 0) {
    return [
      {
        kind: 'item',
        id: 'recent-none',
        label: t('Noch keine Dateien geöffnet'),
        disabled: true,
        run: () => undefined,
      },
    ];
  }
  return [
    ...recent.map((path, index): MenuEntry => ({
      kind: 'item',
      id: `recent-${index}`,
      // The name first, because that is what people scan for; the folder
      // is in the tooltip for the two files that are both called index.ts.
      label: `${index < 9 ? `${index + 1}  ` : ''}${path.split(/[\\/]/).filter(Boolean).pop() ?? path}`,
      hint: path,
      run: () => void openPaths([path]),
    })),
    separator(),
    {
      kind: 'item',
      id: 'recent-clear',
      label: t('Liste leeren'),
      run: forgetRecents,
    },
  ];
}

function fileMenu(): MenuEntry[] {
  const commands = allCommands();
  const c = (id: string, label?: string) => command(id, { label }, commands);
  return [
    c('file.new', t('Neu')),
    {
      kind: 'submenu',
      id: 'file.openMenu',
      label: t('Öffnen'),
      items: () => [
        c('file.open', t('Datei öffnen…')),
        separator(),
        {
          kind: 'item',
          id: 'recent-title',
          label: t('Zuletzt geöffnet'),
          disabled: true,
          run: () => undefined,
        },
        ...recentFiles(),
      ],
    },
    c('file.openFolder', t('Ordner öffnen…')),
    separator(),
    c('file.save', t('Speichern')),
    c('file.saveAs', t('Speichern unter…')),
    c('file.saveCopyAs', t('Kopie speichern unter…')),
    c('file.saveAll', t('Alle offenen Dateien speichern')),
    separator(),
    c('file.rename', t('Umbenennen…')),
    c('file.print', t('Drucken…')),
    separator(),
    c('file.close', t('Schließen')),
    c('file.closeAll', t('Alle offenen Dateien schließen')),
    c('file.reopenClosed'),
  ];
}

/* ── Suchen ────────────────────────────────────────────── */

function searchMenu(): MenuEntry[] {
  const commands = allCommands();
  const c = (id: string, label?: string) => command(id, { label }, commands);
  return [
    c('find.find', t('Suchen…')),
    c('find.replace', t('Ersetzen…')),
    c('find.inFiles', t('In Dateien suchen…')),
    separator(),
    c('find.gotoLine'),
  ];
}

/* ── Ansicht ───────────────────────────────────────────── */

function viewMenu(): MenuEntry[] {
  const commands = allCommands();
  const settings = getSettings();
  const compare = getCompare();
  const panes = paneCount(getWorkspace().layout);
  const c = (id: string, options: { label?: string; checked?: boolean } = {}) =>
    command(id, options, commands);
  return [
    c('view.toggleWrap', {
      label: t('Automatischer Zeilenumbruch'),
      checked: settings.wrap !== 'off',
    }),
    separator(),
    c('view.toggleLineNumbers', { label: t('Zeilennummern'), checked: settings.lineNumbers }),
    c('view.toggleWhitespace', {
      label: t('Leerzeichen anzeigen'),
      checked: settings.showWhitespace,
    }),
    c('view.toggleMinimap', { label: t('Minimap'), checked: settings.minimap }),
    c('view.toggleSidebar', { label: t('Seitenleiste'), checked: sidebarOpen() }),
    separator(),
    {
      kind: 'submenu',
      id: 'view.columnsMenu',
      label: t('Nebeneinander'),
      items: () => [
        c('view.columns1', { checked: panes === 1 }),
        c('view.columns2', { checked: panes === 2 }),
        c('view.columns3', { checked: panes === 3 }),
        separator(),
        c('view.splitRight'),
        c('view.splitDown'),
        c('view.closePane'),
      ],
    },
    separator(),
    c('view.compare', { label: t('Zwei Dateien vergleichen'), checked: compare.active }),
    c('view.compareSyncScroll', { checked: compare.active && compare.syncScroll }),
    c('view.nextDifference'),
    c('view.previousDifference'),
    separator(),
    c('view.zoomIn'),
    c('view.zoomOut'),
    c('view.zoomReset'),
  ];
}

/* ── Codierung ─────────────────────────────────────────── */

const GROUP_ORDER: EncodingGroup[] = [
  'western',
  'central',
  'cyrillic',
  'greek',
  'turkish',
  'baltic',
  'eastAsian',
];

/**
 * One entry per encoding, grouped under a greyed heading. Used twice: "save
 * as this" ticks the file's encoding, "read again as this" ticks nothing.
 */
function encodingEntries(
  prefix: string,
  groups: readonly EncodingGroup[],
  current: string | null,
  run: (label: string) => void,
): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const group of groups) {
    const members = ENCODINGS.filter((entry) => entry.group === group);
    if (members.length === 0) continue;
    if (entries.length > 0) entries.push(separator());
    entries.push({
      kind: 'item',
      id: `${prefix}-heading-${group}`,
      label: encodingGroupName(group),
      disabled: true,
      run: () => undefined,
    });
    for (const entry of members) {
      entries.push({
        kind: 'item',
        id: `${prefix}-${entry.label}`,
        label: entry.name,
        checked: current === null ? undefined : current === entry.label,
        run: () => run(entry.label),
      });
    }
  }
  return entries;
}

function encodingMenu(): MenuEntry[] {
  const id = activeDocId();
  const meta = id ? getMeta(id) : undefined;
  if (!id || !meta) {
    return [
      {
        kind: 'item',
        id: 'encoding-none',
        label: t('Keine Datei offen'),
        disabled: true,
        run: () => undefined,
      },
    ];
  }
  const write = (label: string) => setDocEncoding(id, label);
  const unicode = ENCODINGS.filter((entry) => entry.group === 'unicode');
  return [
    {
      kind: 'item',
      id: 'encoding-current',
      label: t('Aktuell: {encoding}', {
        encoding: `${ENCODINGS.find((entry) => entry.label === meta.encoding)?.name ?? meta.encoding}${meta.bom ? ` ${t('mit BOM')}` : ''}`,
      }),
      disabled: true,
      run: () => undefined,
    },
    separator(),
    ...unicode.map((entry): MenuEntry => ({
      kind: 'item',
      id: `encoding-write-${entry.label}`,
      label: t('Kodieren in {encoding}', { encoding: entry.name }),
      checked: meta.encoding === entry.label,
      run: () => write(entry.label),
    })),
    {
      kind: 'submenu',
      id: 'encoding-more',
      label: t('Weitere Zeichensätze'),
      items: () => encodingEntries('encoding-write', GROUP_ORDER, meta.encoding, write),
    },
    {
      kind: 'item',
      id: 'encoding-bom',
      label: t('Byte-Order-Mark (BOM)'),
      checked: meta.bom,
      run: () => patchMeta(id, { bom: !meta.bom }),
    },
    separator(),
    {
      kind: 'submenu',
      id: 'encoding-reopen',
      label: t('Neu öffnen mit'),
      disabled: !meta.path,
      items: () =>
        encodingEntries('encoding-reopen', ['unicode', ...GROUP_ORDER], null, (label) => {
          void reopenWithEncoding(id, label);
        }),
    },
    separator(),
    {
      kind: 'submenu',
      id: 'encoding-eol',
      label: t('Zeilenenden'),
      items: () =>
        EOLS.map((eol): MenuEntry => ({
          kind: 'item',
          id: `eol-${eol}`,
          label: eolName(eol),
          checked: meta.eol === eol,
          run: () => setDocEol(id, eol),
        })),
    },
  ];
}

/* ── Sprache ───────────────────────────────────────────── */

/** The letter a language is filed under: A–Z, and `#` for the rest. */
export function languageInitial(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

/** Languages by initial, each group sorted by name, the groups A to Z. */
export function languagesByInitial(
  entries: readonly { id: string; name: string }[],
): [string, { id: string; name: string }[]][] {
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const entry of entries) {
    const letter = languageInitial(entry.name);
    const group = groups.get(letter) ?? [];
    group.push(entry);
    groups.set(letter, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b),
  );
}

function languageMenu(): MenuEntry[] {
  const id = activeDocId();
  const meta = id ? getMeta(id) : undefined;
  const current = meta ? (resolveLanguage(meta)?.id ?? PLAIN_TEXT.id) : null;
  const set = (languageId: string | null) => {
    if (!id) return;
    patchMeta(id, { languageOverride: languageId });
    void applyDocLanguage(id);
  };
  const disabled = !id;
  const programming = LANGUAGES.filter((entry) => entry.id !== PLAIN_TEXT.id);
  return [
    {
      kind: 'item',
      id: 'language-auto',
      label: t('Automatisch erkennen'),
      disabled,
      checked: meta ? meta.languageOverride === null : undefined,
      run: () => set(null),
    },
    {
      kind: 'item',
      id: 'language-text',
      label: t('Normaler Text'),
      disabled,
      checked: current === PLAIN_TEXT.id,
      run: () => set(PLAIN_TEXT.id),
    },
    separator(),
    ...languagesByInitial(programming).map(([letter, group]): MenuEntry => ({
      kind: 'submenu',
      id: `language-letter-${letter}`,
      label: letter,
      disabled,
      items: () =>
        group.map((entry): MenuEntry => ({
          kind: 'item',
          id: `language-${entry.id}`,
          label: entry.name,
          checked: current === entry.id,
          run: () => set(entry.id),
        })),
    })),
  ];
}

/* ── Einstellungen ─────────────────────────────────────── */

function settingsMenu(): MenuEntry[] {
  const commands = allCommands();
  const c = (id: string, label?: string) => command(id, { label }, commands);
  return [
    c('app.settings', t('Einstellungen…')),
    c('app.palette', t('Befehlspalette…')),
    separator(),
    c('app.about'),
  ];
}

/* ── Werkzeuge ─────────────────────────────────────────── */

function toolsMenu(): MenuEntry[] {
  const commands = allCommands();
  const c = (id: string, label?: string) => command(id, { label }, commands);
  const plugins = commands.filter((entry) => entry.group() === t('Erweiterungen'));
  return [
    ...HASH_ALGORITHMS.map((algorithm): MenuEntry => ({
      kind: 'submenu',
      id: `tools-hash-${algorithm.id}`,
      label: algorithm.name,
      items: () => [
        c(`tools.hash.${algorithm.id}.text`, t('Erzeugen…')),
        c(`tools.hash.${algorithm.id}.files`, t('Aus Dateien erzeugen…')),
        c(`tools.hash.${algorithm.id}.selection`, t('Aus Auswahl in die Zwischenablage')),
      ],
    })),
    separator(),
    {
      kind: 'submenu',
      id: 'tools-macros',
      label: t('Makros'),
      items: () => [
        c('macro.toggleRecording'),
        c('macro.playLast'),
        c('macro.playLastTimes'),
        c('macro.playToEnd'),
        separator(),
        c('macro.manage'),
      ],
    },
    {
      kind: 'submenu',
      id: 'tools-plugins',
      label: t('Erweiterungen'),
      disabled: plugins.length === 0,
      items: () =>
        plugins.map((entry): MenuEntry => ({
          kind: 'item',
          id: entry.id,
          label: entry.title(),
          run: () => runCommand(entry.id),
        })),
    },
  ];
}

/* ── The row ───────────────────────────────────────────── */

export const MENUS: readonly TopMenu[] = [
  { id: 'file', label: () => t(N_('Datei')), items: fileMenu },
  { id: 'search', label: () => t(N_('Suchen')), items: searchMenu },
  { id: 'view', label: () => t(N_('Ansicht')), items: viewMenu },
  { id: 'encoding', label: () => t(N_('Codierung')), items: encodingMenu },
  { id: 'language', label: () => t(N_('Sprache')), items: languageMenu },
  { id: 'settings', label: () => t(N_('Einstellungen')), items: settingsMenu },
  { id: 'tools', label: () => t(N_('Werkzeuge')), items: toolsMenu },
];
