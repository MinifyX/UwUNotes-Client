/**
 * The macOS menu bar as data: what a Mac would show, built from the same menu
 * tree as the in-app row. The native side only turns this into items, so this
 * is where the menu bar can be checked without a Mac.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MenuEntry, TopMenu } from './menus';
import {
  acceleratorFromKeys,
  buildNativeMenu,
  macAccelerator,
  type NativeEntry,
} from './native-menu';
import { MENUS } from './menus';
import { updateSettings } from './settings';

// The labels are checked in the source language.
beforeAll(() => updateSettings({ language: 'de' }));

type Submenu = Extract<NativeEntry, { kind: 'submenu' }>;
type Item = Extract<NativeEntry, { kind: 'item' }>;

function items(entries: NativeEntry[]): Item[] {
  return entries.flatMap((entry) =>
    entry.kind === 'item' ? [entry] : entry.kind === 'submenu' ? items(entry.items) : [],
  );
}

const fixture = (run = vi.fn()): TopMenu[] => [
  {
    id: 'file',
    label: () => 'Datei',
    items: (): MenuEntry[] => [
      { kind: 'separator', id: 's0' },
      { kind: 'item', id: 'file.save', label: 'Speichern', shortcut: 'Strg+S', run },
      { kind: 'separator', id: 's1' },
      { kind: 'separator', id: 's2' },
      { kind: 'item', id: 'recent-0', label: 'R&D.txt', run, disabled: true },
      {
        kind: 'submenu',
        id: 'more',
        label: 'Mehr',
        items: () => [
          { kind: 'item', id: 'view.toggleWrap', label: 'Umbruch', checked: true, run },
          { kind: 'item', id: 'find.replace', label: 'Ersetzen', shortcut: 'Strg+H', run },
        ],
      },
      { kind: 'submenu', id: 'off', label: 'Aus', disabled: true, items: () => [] },
      { kind: 'separator', id: 's3' },
    ],
  },
  {
    id: 'settings',
    label: () => 'Einstellungen',
    items: (): MenuEntry[] => [
      { kind: 'item', id: 'app.settings', label: 'Einstellungen…', shortcut: 'Strg+,', run },
    ],
  },
];

describe('accelerators', () => {
  it('turns Ctrl into ⌘ and keeps the key', () => {
    expect(acceleratorFromKeys(['Strg', 'S'])).toBe('CmdOrCtrl+S');
    expect(acceleratorFromKeys(['Strg', 'Umschalt', 'O'])).toBe('CmdOrCtrl+Shift+O');
    expect(acceleratorFromKeys(['Strg', '+'])).toBe('CmdOrCtrl++');
    expect(acceleratorFromKeys(['Umschalt', 'F2'])).toBe('Shift+F2');
    expect(acceleratorFromKeys(['F11'])).toBe('F11');
  });

  it('reads the app’s own table', () => {
    expect(macAccelerator('file.save')).toBe('CmdOrCtrl+S');
    expect(macAccelerator('app.settings')).toBe('CmdOrCtrl+,');
    expect(macAccelerator('view.zoomIn')).toBe('CmdOrCtrl++');
    expect(macAccelerator('bookmark.next')).toBe('F2');
    expect(macAccelerator('file.saveCopyAs')).toBeNull();
  });

  it('moves the chords macOS keeps for itself', () => {
    expect(macAccelerator('find.replace')).toBe('CmdOrCtrl+Alt+F');
    expect(macAccelerator('view.closePane')).toBeNull();
    expect(macAccelerator('view.columns3')).toBe('CmdOrCtrl+Alt+3');
  });
});

describe('buildNativeMenu', () => {
  it('wraps the app’s menus in the ones every Mac app has', () => {
    const { menus } = buildNativeMenu(fixture(), vi.fn());
    expect(menus.map((menu) => menu.label)).toEqual([
      'UwUNotes',
      'Bearbeiten',
      'Datei',
      'Einstellungen',
      'Fenster',
      'Hilfe',
    ]);
    expect(menus.at(-2)?.role).toBe('window');
    expect(menus.at(-1)?.role).toBe('help');
    const edit = menus[1]!.items.filter((entry) => entry.kind === 'predefined');
    expect(edit.map((entry) => entry.kind === 'predefined' && entry.role)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'selectAll',
    ]);
    const app = menus[0]!.items;
    expect(app.some((entry) => entry.kind === 'predefined' && entry.role === 'services')).toBe(
      true,
    );
    expect(items(app).find((entry) => entry.id === 'app/quit')?.accelerator).toBe('CmdOrCtrl+Q');
  });

  it('carries labels, ticks, greyed entries and keys over', () => {
    const { menus } = buildNativeMenu(fixture(), vi.fn());
    const file = menus[2] as Submenu;
    const all = items(file.items);
    expect(all.find((entry) => entry.id === 'file/file.save')).toMatchObject({
      label: 'Speichern',
      accelerator: 'CmdOrCtrl+S',
      enabled: true,
      checked: null,
    });
    // A literal & would otherwise become a mnemonic.
    expect(all.find((entry) => entry.id === 'file/recent-0')).toMatchObject({
      label: 'R&&D.txt',
      enabled: false,
      accelerator: null,
    });
    expect(all.find((entry) => entry.id === 'file/more/view.toggleWrap')).toMatchObject({
      checked: true,
      // No shortcut shown in the app, so none here either.
      accelerator: null,
    });
    expect(all.find((entry) => entry.id === 'file/more/find.replace')?.accelerator).toBe(
      'CmdOrCtrl+Alt+F',
    );
    const off = file.items.find((entry) => entry.kind === 'submenu' && entry.label === 'Aus');
    expect(off).toMatchObject({ enabled: false, items: [] });
  });

  it('drops separators at the edges and doubled ones', () => {
    const file = buildNativeMenu(fixture(), vi.fn()).menus[2] as Submenu;
    const kinds = file.items.map((entry) => entry.kind);
    expect(kinds[0]).not.toBe('separator');
    expect(kinds.at(-1)).not.toBe('separator');
    expect(kinds.join(' ')).not.toContain('separator separator');
  });

  it('gives each key to one entry only, the app menu first', () => {
    const { menus } = buildNativeMenu(fixture(), vi.fn());
    const withComma = items(menus.flatMap((menu) => menu.items)).filter(
      (entry) => entry.accelerator === 'CmdOrCtrl+,',
    );
    expect(withComma.map((entry) => entry.id)).toEqual(['app/app.settings']);
    expect(
      items(menus[3]!.items).find((entry) => entry.id === 'settings/app.settings')?.accelerator,
    ).toBeNull();
  });

  it('runs an entry by its id, and quits through the page', () => {
    const run = vi.fn();
    const quit = vi.fn();
    const { actions } = buildNativeMenu(fixture(run), quit);
    actions.get('file/file.save')?.();
    expect(run).toHaveBeenCalledTimes(1);
    actions.get('app/quit')?.();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('builds the real menus, Nyu included, with ids that are unique', () => {
    const { menus, actions } = buildNativeMenu(MENUS, vi.fn());
    const labels = menus.map((menu) => menu.label);
    expect(labels).toContain('Nyu');
    expect(labels.indexOf('Nyu')).toBeLessThan(labels.indexOf('Fenster'));
    const ids = items(menus).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(actions.size).toBe(ids.length);
    const keys = items(menus)
      .map((entry) => entry.accelerator?.toLowerCase())
      .filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    // ⌘H stays the system's "hide".
    expect(keys).not.toContain('cmdorctrl+h');
  });
});
