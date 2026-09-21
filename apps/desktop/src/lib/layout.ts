/**
 * The split view, as a tree.
 *
 * A leaf is a pane — a tab bar with an editor under it. A branch splits the
 * space it was given between two children, horizontally or vertically, at a
 * ratio the user can drag. Nesting is what makes "split the right half again"
 * work without a second concept, and Notepad++'s two views are simply the tree
 * one level deep.
 *
 * A document belongs to exactly one pane. Moving a tab across moves it; the
 * same file open twice in two panes would mean two editors sharing one undo
 * history, which CodeMirror does not do for free — see docs/architecture.md.
 *
 * Everything here is plain data and pure functions, so the whole layout
 * serialises into the session file and comes back unchanged.
 */

export type PaneId = string;

export type SplitDirection = 'horizontal' | 'vertical';

export type LayoutNode =
  | { kind: 'pane'; id: PaneId }
  | {
      kind: 'split';
      /** `horizontal` puts the children side by side, with a vertical divider. */
      direction: SplitDirection;
      /** How much of the space `first` gets, 0.1 to 0.9. */
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };

/** Panes cannot be squeezed to nothing: a divider stops here. */
export const MIN_RATIO = 0.12;
export const MAX_RATIO = 0.88;

/**
 * Two files side by side, or three — and no more.
 *
 * Past three, every pane on a laptop screen is narrower than a line of code,
 * and the tree stops being a layout anyone can read. Splitting a fourth time
 * is refused rather than squeezed.
 */
export const MAX_PANES = 3;

/**
 * `ids` as columns of equal width, left to right.
 *
 * Built as a chain — the first column, then a split of everything after it —
 * with each ratio set so every column ends up the same width: a third and then
 * a half for three, a half for two.
 */
export function columnsLayout(ids: readonly PaneId[]): LayoutNode | null {
  const [first, ...rest] = ids;
  if (first === undefined) return null;
  const tail = columnsLayout(rest);
  if (!tail) return singlePane(first);
  return {
    kind: 'split',
    direction: 'horizontal',
    ratio: 1 / ids.length,
    first: singlePane(first),
    second: tail,
  };
}

let paneCounter = 0;

export function newPaneId(): string {
  paneCounter += 1;
  return `pane-${paneCounter}`;
}

export function singlePane(id: PaneId): LayoutNode {
  return { kind: 'pane', id };
}

/** Every pane in the tree, left to right, top to bottom. */
export function paneIds(node: LayoutNode): PaneId[] {
  if (node.kind === 'pane') return [node.id];
  return [...paneIds(node.first), ...paneIds(node.second)];
}

export function paneCount(node: LayoutNode): number {
  return paneIds(node).length;
}

/**
 * Splits `target` in two, keeping it as the first half and putting `newPane`
 * in the second. Returns the tree unchanged when `target` is not in it.
 */
export function splitPane(
  node: LayoutNode,
  target: PaneId,
  direction: SplitDirection,
  newPane: PaneId,
): LayoutNode {
  if (node.kind === 'pane') {
    if (node.id !== target) return node;
    return {
      kind: 'split',
      direction,
      ratio: 0.5,
      first: node,
      second: { kind: 'pane', id: newPane },
    };
  }
  return {
    ...node,
    first: splitPane(node.first, target, direction, newPane),
    second: splitPane(node.second, target, direction, newPane),
  };
}

/**
 * Removes a pane and collapses the split it was half of, so the sibling takes
 * the whole space. Returns `null` when the last pane would be removed — the
 * caller keeps it instead, because a window with no pane has nowhere to type.
 */
export function removePane(node: LayoutNode, target: PaneId): LayoutNode | null {
  if (node.kind === 'pane') return node.id === target ? null : node;
  const first = removePane(node.first, target);
  const second = removePane(node.second, target);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

/** Moves one divider. Which divider is addressed by the path taken to reach it. */
export function setRatio(node: LayoutNode, path: SplitPath, ratio: number): LayoutNode {
  // A ratio that is not a number is not a resize. `NaN` is what a divide by a
  // zero-height box gives, and clamping it leaves it `NaN` — which would go
  // into the tree, into the session file, and into a `flex` nobody can drag
  // back. Leaving the split where it is says "that drag meant nothing".
  if (!Number.isFinite(ratio)) return node;
  const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
  if (node.kind !== 'split') return node;
  if (path.length === 0) return { ...node, ratio: clamped };
  const [head, ...rest] = path;
  return head === 'first'
    ? { ...node, first: setRatio(node.first, rest, clamped) }
    : { ...node, second: setRatio(node.second, rest, clamped) };
}

/** Which branches to take from the root to reach a particular split. */
export type SplitPath = ('first' | 'second')[];

/** The pane after `current` in reading order, wrapping around. */
export function nextPane(node: LayoutNode, current: PaneId, back = false): PaneId {
  const ids = paneIds(node);
  const index = ids.indexOf(current);
  if (index < 0) return ids[0] ?? current;
  const step = back ? -1 : 1;
  return ids[(index + step + ids.length) % ids.length] ?? current;
}

/**
 * Deeper than this and it is not a window somebody arranged.
 *
 * Six nested splits is already a layout nobody can work in. The number is
 * generous because the point is not to police taste; it is that the walk below
 * is recursive, and a session file nested ten thousand deep would be a stack
 * overflow rather than a rejected layout.
 */
const MAX_DEPTH = 64;

/**
 * Checks a layout that came out of the session file.
 *
 * The session is JSON the user could have edited, so nothing is trusted: the
 * shape is walked, ratios are clamped, and any pane not in `known` is dropped.
 * A tree that ends up empty gives `null`, and the caller starts fresh.
 *
 * "Nothing is trusted" includes the shape of the walk itself — see
 * {@link MAX_DEPTH} and the visited set in {@link walkLayout}. A sanitiser that
 * can be made to throw is not one.
 */
export function sanitizeLayout(raw: unknown, known: ReadonlySet<PaneId>): LayoutNode | null {
  return walkLayout(raw, known, new Set(), 0);
}

function walkLayout(
  raw: unknown,
  known: ReadonlySet<PaneId>,
  visited: Set<object>,
  depth: number,
): LayoutNode | null {
  if (depth > MAX_DEPTH) return null;
  if (typeof raw !== 'object' || raw === null) return null;
  // JSON has no way of writing the same object twice, so a node we have already
  // been through is a node that reaches itself. Dropping it is what stops the
  // walk; the sibling takes the space, as it does for any unusable node.
  if (visited.has(raw)) return null;
  visited.add(raw);

  const node = raw as Record<string, unknown>;
  if (node.kind === 'pane') {
    return typeof node.id === 'string' && known.has(node.id) ? { kind: 'pane', id: node.id } : null;
  }
  if (node.kind !== 'split') return null;
  const first = walkLayout(node.first, known, visited, depth + 1);
  const second = walkLayout(node.second, known, visited, depth + 1);
  if (!first) return second;
  if (!second) return first;
  const ratio = typeof node.ratio === 'number' && Number.isFinite(node.ratio) ? node.ratio : 0.5;
  return {
    kind: 'split',
    direction: node.direction === 'vertical' ? 'vertical' : 'horizontal',
    ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)),
    first,
    second,
  };
}
