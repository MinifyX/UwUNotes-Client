/**
 * Two or three files side by side, and the pieces of the comparison that can
 * be checked without a window: the line mapping behind the scroll sync, the
 * diff colours, the language menu's letters and the rename guard.
 */

import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';
import { beforeEach, describe, expect, it } from 'vitest';
import { diffDecorations } from '../editor/compare';
import { mapLine } from './compare';
import { isPlainFileName } from './files';
import { columnsLayout, MAX_PANES, paneIds } from './layout';
import { languageInitial, languagesByInitial } from './menus';
import {
  arrangeColumns,
  canSplit,
  getPane,
  getWorkspace,
  resetWorkspace,
  showDoc,
  splitActivePane,
} from './workspace';

beforeEach(() => {
  resetWorkspace();
});

const doc = (lines: string[]) => Text.of(lines);

describe('side by side', () => {
  it('lays columns out with equal widths', () => {
    const three = columnsLayout(['a', 'b', 'c']);
    expect(three?.kind).toBe('split');
    if (three?.kind !== 'split') return;
    expect(three.ratio).toBeCloseTo(1 / 3);
    expect(three.direction).toBe('horizontal');
    expect(three.second.kind === 'split' && three.second.ratio).toBeCloseTo(0.5);
    expect(columnsLayout([])).toBeNull();
  });

  it('never splits past three panes', () => {
    showDoc('one');
    expect(splitActivePane('horizontal')).toBe(true);
    expect(splitActivePane('horizontal')).toBe(true);
    expect(canSplit()).toBe(false);
    expect(splitActivePane('vertical')).toBe(false);
    expect(paneIds(getWorkspace().layout)).toHaveLength(MAX_PANES);
  });

  it('gives each new column a different file when there are spare tabs', () => {
    showDoc('one');
    showDoc('two');
    showDoc('three');
    arrangeColumns(3);
    const ids = paneIds(getWorkspace().layout);
    expect(ids).toHaveLength(3);
    const shown = ids.map((id) => getPane(id)?.active);
    expect(new Set(shown).size).toBe(3);
    // Nothing lost, nothing doubled.
    const all = ids.flatMap((id) => getPane(id)?.tabs ?? []).sort();
    expect(all).toEqual(['one', 'three', 'two']);
  });

  it('folds extra columns back without losing a tab', () => {
    showDoc('one');
    showDoc('two');
    showDoc('three');
    arrangeColumns(3);
    arrangeColumns(1);
    const ids = paneIds(getWorkspace().layout);
    expect(ids).toHaveLength(1);
    expect([...(getPane(ids[0]!)?.tabs ?? [])].sort()).toEqual(['one', 'three', 'two']);
  });

  it('turns a vertical split into columns', () => {
    showDoc('one');
    showDoc('two');
    splitActivePane('vertical');
    arrangeColumns(2);
    const layout = getWorkspace().layout;
    expect(layout.kind === 'split' && layout.direction).toBe('horizontal');
  });
});

describe('the scroll sync mapping', () => {
  it('is the identity for identical files', () => {
    const a = doc(['a', 'b', 'c']);
    const chunks = Chunk.build(a, a);
    expect(chunks).toHaveLength(0);
    expect(mapLine(2, a, a, chunks, 'a')).toBe(2);
  });

  it('shifts lines after an insertion on the other side', () => {
    const a = doc(['one', 'two', 'three']);
    const b = doc(['one', 'new 1', 'new 2', 'two', 'three']);
    const chunks = Chunk.build(a, b);
    // `two` is line 2 on the left and line 4 on the right.
    expect(mapLine(2, a, b, chunks, 'a')).toBe(4);
    expect(mapLine(4, b, a, chunks, 'b')).toBe(2);
    expect(mapLine(1, a, b, chunks, 'a')).toBe(1);
  });

  it('stays inside the other document', () => {
    const a = doc(['x', 'y']);
    const b = doc(['x', 'y', 'z', 'w']);
    const chunks = Chunk.build(a, b);
    for (let line = 1; line <= b.lines; line += 1) {
      const mapped = mapLine(line, b, a, chunks, 'b');
      expect(mapped).toBeGreaterThanOrEqual(1);
      expect(mapped).toBeLessThanOrEqual(a.lines);
    }
  });
});

describe('the diff colours', () => {
  it('marks the changed line on each side and nothing else', () => {
    const a = doc(['same', 'old text', 'same']);
    const b = doc(['same', 'new text', 'same']);
    const chunks = Chunk.build(a, b);
    const left = diffDecorations(a, 'a', chunks);
    const lines: number[] = [];
    left.between(0, a.length, (from, _to, deco) => {
      if (deco.spec.class?.includes('cm-diff-line')) lines.push(a.lineAt(from).number);
    });
    expect(lines).toEqual([2]);
    let marked = '';
    diffDecorations(b, 'b', chunks).between(0, b.length, (from, to, deco) => {
      if (deco.spec.class?.includes('cm-diff-chars')) marked += b.sliceString(from, to);
    });
    expect(marked).toBe('new');
  });

  it('marks where lines exist only on the other side', () => {
    const a = doc(['one', 'three']);
    const b = doc(['one', 'two', 'three']);
    const chunks = Chunk.build(a, b);
    const classes: string[] = [];
    diffDecorations(a, 'a', chunks).between(0, a.length, (_from, _to, deco) => {
      classes.push(String(deco.spec.class));
    });
    expect(classes.some((name) => name.includes('cm-diff-gap'))).toBe(true);
  });
});

describe('the language menu', () => {
  it('files languages under their first letter, and the rest under #', () => {
    expect(languageInitial('Python')).toBe('P');
    expect(languageInitial('c++')).toBe('C');
    expect(languageInitial('1C')).toBe('#');
    const groups = languagesByInitial([
      { id: 'py', name: 'Python' },
      { id: 'bash', name: 'Bash' },
      { id: 'perl', name: 'Perl' },
      { id: 'x', name: '1C' },
    ]);
    expect(groups.map(([letter]) => letter)).toEqual(['B', 'P', '#']);
    expect(groups[1]![1].map((entry) => entry.name)).toEqual(['Perl', 'Python']);
  });
});

describe('renaming', () => {
  it('accepts a plain name and refuses anything that would leave the folder', () => {
    expect(isPlainFileName('notes.md')).toBe(true);
    expect(isPlainFileName('  spaced name.txt ')).toBe(true);
    for (const bad of ['', '..', '.', '../x', 'a/b', 'a\\b', 'C:x', 'a*b', 'xy']) {
      expect(isPlainFileName(bad), bad).toBe(false);
    }
  });
});
