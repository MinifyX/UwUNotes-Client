/**
 * Pinned tabs and tab colours.
 *
 * The promise a pin makes is small and easy to break from a dozen places: the
 * tab stays at the left, a drag does not carry it into the loose tabs, and
 * "close all" walks past it. The rules are tested here on plain strings, and
 * once more through the workspace store, because that is where a tab opened
 * next to a pinned one would otherwise slip into the pinned group.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { clearDocuments, openDoc, patchMeta } from './documents';
import { clampDropIndex, pinnedFirst, sanitizeTabColor, shortTabName, tabsToClose } from './tabs';
import {
  getPane,
  getWorkspace,
  reorderTab,
  resetWorkspace,
  setTabPinned,
  showDoc,
  showDocNext,
} from './workspace';

const pinnedSet = (...ids: string[]) => {
  const set = new Set(ids);
  return (id: string) => set.has(id);
};

describe('ordering', () => {
  it('moves pinned tabs to the front and keeps both groups in their order', () => {
    expect(pinnedFirst(['a', 'b', 'c', 'd'], pinnedSet('c', 'a'))).toEqual(['a', 'c', 'b', 'd']);
  });

  it('hands back the same list when it is already in order', () => {
    const tabs = ['a', 'b', 'c'];
    expect(pinnedFirst(tabs, pinnedSet('a'))).toBe(tabs);
    expect(pinnedFirst(tabs, pinnedSet())).toBe(tabs);
  });
});

describe('dragging', () => {
  const tabs = ['p1', 'p2', 'a', 'b', 'c'];
  const pinned = pinnedSet('p1', 'p2');

  it('keeps a pinned tab inside the pinned group', () => {
    expect(clampDropIndex(tabs, 'p1', 4, pinned)).toBe(1);
    expect(clampDropIndex(tabs, 'p1', 0, pinned)).toBe(0);
  });

  it('keeps a loose tab out of the pinned group', () => {
    expect(clampDropIndex(tabs, 'c', 0, pinned)).toBe(2);
    expect(clampDropIndex(tabs, 'a', 4, pinned)).toBe(4);
  });

  it('clamps nonsense indices into the bar', () => {
    expect(clampDropIndex(tabs, 'a', -5, pinned)).toBe(2);
    expect(clampDropIndex(tabs, 'a', 99, pinned)).toBe(4);
  });
});

describe('closing in bulk', () => {
  const tabs = ['p1', 'a', 'b', 'p2', 'c'];
  const pinned = pinnedSet('p1', 'p2');

  it('closes all but the pinned tabs', () => {
    expect(tabsToClose(tabs, null, 'all', pinned)).toEqual(['a', 'b', 'c']);
  });

  it('closes the others, sparing the pinned ones and the tab itself', () => {
    expect(tabsToClose(tabs, 'b', 'others', pinned)).toEqual(['a', 'c']);
  });

  it('closes to the right of the tab, pinned ones excepted', () => {
    expect(tabsToClose(tabs, 'a', 'right', pinned)).toEqual(['b', 'c']);
    expect(tabsToClose(tabs, 'c', 'right', pinned)).toEqual([]);
  });

  it('closes everything to the right of a pinned tab that is loose', () => {
    expect(tabsToClose(tabs, 'p1', 'right', pinned)).toEqual(['a', 'b', 'c']);
  });
});

describe('colours and names', () => {
  it('accepts only the colours it knows', () => {
    expect(sanitizeTabColor('blue')).toBe('blue');
    expect(sanitizeTabColor('pink')).toBeUndefined();
    expect(sanitizeTabColor(3)).toBeUndefined();
    expect(sanitizeTabColor(null)).toBeUndefined();
  });

  it('shortens a long name but keeps its extension', () => {
    expect(shortTabName('main.rs')).toBe('main.rs');
    expect(shortTabName('very-long-module-name.rs')).toBe('very-lon….rs');
    expect(shortTabName('README-for-everyone')).toBe('README-for-…');
  });
});

describe('the workspace keeps pinned tabs at the left', () => {
  let ids: string[] = [];

  beforeEach(() => {
    clearDocuments();
    resetWorkspace();
    ids = ['one', 'two', 'three'].map((name) => openDoc({ path: null, name, text: '' }));
    for (const id of ids) showDoc(id);
  });

  const tabs = () => getPane(getWorkspace().activePane)?.tabs;

  it('moves a tab to the end of the pinned group when it is pinned', () => {
    setTabPinned(ids[2]!, true);
    expect(tabs()).toEqual([ids[2], ids[0], ids[1]]);
    setTabPinned(ids[1]!, true);
    expect(tabs()).toEqual([ids[2], ids[1], ids[0]]);
  });

  it('puts an unpinned tab back right after the pinned ones', () => {
    setTabPinned(ids[1]!, true);
    setTabPinned(ids[2]!, true);
    setTabPinned(ids[1]!, false);
    expect(tabs()).toEqual([ids[2], ids[1], ids[0]]);
  });

  it('does not let a tab opened next to a pinned one into the pinned group', () => {
    setTabPinned(ids[0]!, true);
    showDoc(ids[0]!);
    const fresh = openDoc({ path: null, name: 'four', text: '' });
    showDocNext(fresh);
    expect(tabs()).toEqual([ids[0], fresh, ids[1], ids[2]]);
  });

  it('does not let a drag carry a loose tab in front of a pinned one', () => {
    setTabPinned(ids[0]!, true);
    reorderTab(ids[2]!, 0);
    expect(tabs()).toEqual([ids[0], ids[2], ids[1]]);
  });

  it('orders by the flag even when it was set behind its back, as a restore does', () => {
    patchMeta(ids[2]!, { pinned: true });
    showDoc(ids[0]!);
    expect(tabs()?.[0]).toBe(ids[2]);
  });
});
