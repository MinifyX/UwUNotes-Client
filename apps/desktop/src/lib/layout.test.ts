/**
 * The split tree.
 *
 * Everything here is a pure function over plain data, so these tests need no
 * DOM and no store — which is the reason the module was written that way.
 *
 * Half of them are about {@link sanitizeLayout}, and they are the half that
 * matters: it is the one function in the app that is handed a JSON object a
 * user could have typed, and "it copes" is a claim, not a fact, until something
 * hands it the objects a person would never write on purpose.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_RATIO,
  MIN_RATIO,
  nextPane,
  paneIds,
  removePane,
  sanitizeLayout,
  setRatio,
  singlePane,
  splitPane,
  type LayoutNode,
} from './layout';

/** Two panes side by side, built fresh so no test can edit another's tree. */
function pair(): LayoutNode {
  return {
    kind: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    first: singlePane('left'),
    second: singlePane('right'),
  };
}

function depthOf(node: LayoutNode | null): number {
  if (!node || node.kind === 'pane') return 0;
  return 1 + Math.max(depthOf(node.first), depthOf(node.second));
}

/* ── Splitting and removing ────────────────────────────── */

describe('splitting', () => {
  it('keeps the pane that was split as the first half', () => {
    const split = splitPane(singlePane('left'), 'left', 'vertical', 'right');

    expect(split).toEqual({
      kind: 'split',
      direction: 'vertical',
      ratio: 0.5,
      first: { kind: 'pane', id: 'left' },
      second: { kind: 'pane', id: 'right' },
    });
  });

  it('leaves a tree alone when the pane to split is not in it', () => {
    const before = pair();

    expect(splitPane(before, 'nowhere', 'horizontal', 'new')).toEqual(before);
  });

  it('splits the half that was asked for and not its sibling', () => {
    const nested = splitPane(pair(), 'right', 'vertical', 'bottom');

    expect(paneIds(nested)).toEqual(['left', 'right', 'bottom']);
    expect(depthOf(nested)).toBe(2);
  });
});

describe('removing a pane', () => {
  it('gives the whole space to the sibling', () => {
    expect(removePane(pair(), 'left')).toEqual({ kind: 'pane', id: 'right' });
  });

  it('collapses only the split it was half of', () => {
    const nested = splitPane(pair(), 'right', 'vertical', 'bottom');

    expect(removePane(nested, 'bottom')).toEqual(pair());
  });

  it('gives nothing back when the last pane would go', () => {
    // The caller keeps it instead: a window with no pane has nowhere to type.
    expect(removePane(singlePane('only'), 'only')).toBeNull();
  });

  it('leaves a tree alone when the pane is not in it', () => {
    const before = pair();

    expect(removePane(before, 'nowhere')).toEqual(before);
  });
});

describe('walking the panes', () => {
  it('lists them in reading order', () => {
    const nested = splitPane(pair(), 'right', 'vertical', 'bottom');

    expect(paneIds(nested)).toEqual(['left', 'right', 'bottom']);
  });

  it('wraps around at both ends', () => {
    const tree = pair();

    expect(nextPane(tree, 'right')).toBe('left');
    expect(nextPane(tree, 'left', true)).toBe('right');
  });

  it('starts at the beginning when the current pane has gone', () => {
    expect(nextPane(pair(), 'closed')).toBe('left');
  });
});

/* ── Dividers ──────────────────────────────────────────── */

describe('moving a divider', () => {
  it('cannot squeeze a pane to nothing', () => {
    const wide = setRatio(pair(), [], 5);
    const thin = setRatio(pair(), [], 0.001);

    expect(wide.kind === 'split' && wide.ratio).toBe(MAX_RATIO);
    expect(thin.kind === 'split' && thin.ratio).toBe(MIN_RATIO);
  });

  it('is addressed by the path taken to reach it', () => {
    const nested = splitPane(pair(), 'right', 'vertical', 'bottom');

    const moved = setRatio(nested, ['second'], 0.3);

    expect(moved.kind === 'split' && moved.ratio).toBe(0.5);
    expect(moved.kind === 'split' && moved.second.kind === 'split' && moved.second.ratio).toBe(0.3);
  });

  it('does nothing at all when the ratio is not a number', () => {
    // A zero-height box divides to `NaN`, and clamping leaves it `NaN`. Writing
    // that into the tree would give a split nobody could ever drag back.
    const before = pair();

    expect(setRatio(before, [], Number.NaN)).toEqual(before);
    expect(setRatio(before, [], Number.POSITIVE_INFINITY)).toEqual(before);
  });
});

/* ── What comes out of the session file ────────────────── */

describe('a layout out of the session file', () => {
  const known = new Set(['left', 'right']);

  it('keeps the panes the window still has', () => {
    expect(sanitizeLayout(pair(), known)).toEqual(pair());
  });

  it('drops a pane the window no longer has and collapses the split', () => {
    const stale = { ...pair(), second: { kind: 'pane', id: 'closed' } };

    expect(sanitizeLayout(stale, known)).toEqual({ kind: 'pane', id: 'left' });
  });

  it('is not a layout when nothing in it is', () => {
    expect(sanitizeLayout('a layout, honest', known)).toBeNull();
    expect(sanitizeLayout(42, known)).toBeNull();
    expect(sanitizeLayout(null, known)).toBeNull();
    expect(sanitizeLayout({ kind: 'window' }, known)).toBeNull();
    expect(sanitizeLayout({ kind: 'pane', id: 7 }, known)).toBeNull();
  });

  it('is not a layout when a node is a string where a node should be', () => {
    expect(sanitizeLayout({ ...pair(), first: 'left', second: 'right' }, known)).toBeNull();
  });

  it('takes a ratio that is not a number as a half', () => {
    const broken = { ...pair(), ratio: Number.NaN };
    const missing = { ...pair(), ratio: 'wide' };

    expect(sanitizeLayout(broken, known)).toEqual(pair());
    expect(sanitizeLayout(missing, known)).toEqual(pair());
  });

  it('pulls a stored ratio back into range', () => {
    const squeezed = sanitizeLayout({ ...pair(), ratio: -3 }, known);

    expect(squeezed?.kind === 'split' && squeezed.ratio).toBe(MIN_RATIO);
  });

  it('takes a direction it does not know as side by side', () => {
    const sideways = sanitizeLayout({ ...pair(), direction: 'diagonal' }, known);

    expect(sideways?.kind === 'split' && sideways.direction).toBe('horizontal');
  });

  it('does not take the stack with it when a layout contains itself', () => {
    const cyclic: Record<string, unknown> = { kind: 'split', direction: 'horizontal', ratio: 0.5 };
    cyclic.first = { kind: 'pane', id: 'left' };
    cyclic.second = cyclic;

    // The branch that reaches back into itself is dropped like any other node
    // that cannot be used, and its sibling takes the space.
    expect(sanitizeLayout(cyclic, known)).toEqual({ kind: 'pane', id: 'left' });
  });

  it('cuts a layout nested deeper than a window could be down to size', () => {
    let deep: unknown = { kind: 'pane', id: 'left' };
    for (let level = 0; level < 50_000; level += 1) {
      deep = {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        first: deep,
        second: { kind: 'pane', id: 'right' },
      };
    }

    const walked = sanitizeLayout(deep, known);

    expect(walked).not.toBeNull();
    expect(depthOf(walked)).toBeLessThan(100);
  });
});
