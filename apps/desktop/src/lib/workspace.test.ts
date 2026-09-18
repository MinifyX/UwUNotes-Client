/**
 * Tabs and panes.
 *
 * The rules being checked here are the ones a person notices immediately when
 * they are wrong: the same file opening twice, a tab closing and the wrong
 * neighbour coming forward, an empty pane left sitting there after its last tab
 * was dragged away.
 *
 * The documents are plain strings. A `DocId` is a string, this module never
 * looks inside one, and building real documents would mean these tests failed
 * when `lib/documents.ts` did — which is a different test's job.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { paneIds } from './layout';
import {
  activateDoc,
  closeTab,
  getPane,
  getWorkspace,
  moveTabToPane,
  paneOf,
  resetWorkspace,
  showDoc,
  splitActivePane,
} from './workspace';

beforeEach(() => {
  // The workspace is one module-level value; without this, every test would be
  // reading the tabs the test before it left open.
  resetWorkspace();
});

/** The two panes of a fresh split, in reading order. */
function splitInTwo(): { source: string; created: string } {
  splitActivePane('horizontal');
  const [source, created] = paneIds(getWorkspace().layout);
  if (!source || !created) throw new Error('a split must leave two panes');
  return { source, created };
}

describe('opening a document', () => {
  it('puts it at the end of the tab bar and shows it', () => {
    showDoc('one');
    showDoc('two');

    const pane = getPane(getWorkspace().activePane);
    expect(pane?.tabs).toEqual(['one', 'two']);
    expect(pane?.active).toBe('two');
  });

  it('reveals a document that is already open instead of opening it twice', () => {
    showDoc('one');
    showDoc('two');
    const { source, created } = splitInTwo();

    // `two` went across with the split; asking for `one` again must go back to
    // the pane it is in, not deal a second copy into this one.
    showDoc('one');

    expect(getWorkspace().activePane).toBe(source);
    expect(getPane(source)?.tabs).toEqual(['one']);
    expect(getPane(created)?.tabs).toEqual(['two']);
  });
});

describe('closing a tab', () => {
  it('brings forward the one to its right', () => {
    showDoc('one');
    showDoc('two');
    showDoc('three');
    activateDoc('two');

    closeTab('two');

    expect(getPane(getWorkspace().activePane)?.active).toBe('three');
  });

  it('brings forward the one to its left when there is nothing to the right', () => {
    showDoc('one');
    showDoc('two');

    closeTab('two');

    expect(getPane(getWorkspace().activePane)?.active).toBe('one');
  });

  it('leaves the active tab alone when some other tab closes', () => {
    showDoc('one');
    showDoc('two');
    showDoc('three');

    closeTab('one');

    expect(getPane(getWorkspace().activePane)?.active).toBe('three');
  });

  it('closes the pane along with its last tab', () => {
    showDoc('one');
    showDoc('two');
    const { source, created } = splitInTwo();

    closeTab('two');

    expect(paneIds(getWorkspace().layout)).toEqual([source]);
    expect(getPane(created)).toBeUndefined();
    expect(getWorkspace().activePane).toBe(source);
  });

  it('keeps the last pane, empty, when its last tab closes', () => {
    showDoc('one');

    closeTab('one');

    const pane = getPane(getWorkspace().activePane);
    expect(pane?.tabs).toEqual([]);
    expect(pane?.active).toBeNull();
  });

  it('does nothing for a document that is not open', () => {
    showDoc('one');

    closeTab('elsewhere');

    expect(getPane(getWorkspace().activePane)?.tabs).toEqual(['one']);
  });
});

describe('moving a tab to another pane', () => {
  it('empties the pane it came from and collapses it', () => {
    showDoc('one');
    showDoc('two');
    const { source, created } = splitInTwo();

    moveTabToPane('two', source);

    expect(paneIds(getWorkspace().layout)).toEqual([source]);
    expect(getPane(created)).toBeUndefined();
    expect(getPane(source)?.tabs).toEqual(['one', 'two']);
    expect(getPane(source)?.active).toBe('two');
  });

  it('leaves the pane it came from standing when tabs remain in it', () => {
    showDoc('one');
    showDoc('two');
    showDoc('three');
    const { source, created } = splitInTwo();

    moveTabToPane('one', created);

    expect(paneIds(getWorkspace().layout)).toEqual([source, created]);
    expect(getPane(source)?.tabs).toEqual(['two']);
    expect(getPane(created)?.tabs).toEqual(['three', 'one']);
  });

  it('changes nothing when the tab is already in that pane', () => {
    showDoc('one');
    showDoc('two');
    const before = getWorkspace();

    moveTabToPane('one', before.activePane);

    expect(getWorkspace()).toBe(before);
  });

  it('changes nothing when the pane does not exist', () => {
    showDoc('one');
    const before = getWorkspace();

    moveTabToPane('one', 'pane-that-never-was');

    expect(getWorkspace()).toBe(before);
  });
});

describe('splitting the active pane', () => {
  it('takes the active tab across, leaving the rest behind', () => {
    showDoc('one');
    showDoc('two');

    const { source, created } = splitInTwo();

    expect(getPane(source)?.tabs).toEqual(['one']);
    expect(getPane(created)?.tabs).toEqual(['two']);
    expect(getWorkspace().activePane).toBe(created);
    expect(paneOf('two')).toBe(created);
  });
});
