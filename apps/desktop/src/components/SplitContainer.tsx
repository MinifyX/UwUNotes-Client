/**
 * The split tree, turned into nested flex boxes.
 *
 * `lib/layout.ts` keeps the layout as a binary tree of panes and splits, and
 * this walks it. The `SplitPath` — which branches to take from the root — is
 * built on the way down, because that is the only address a divider has: there
 * is no id on a split, and giving one would mean a second thing to keep in step
 * with the tree that already describes it perfectly.
 *
 * Nothing here holds the ratio. Dragging writes straight through
 * `resizeSplit()`, which clamps to `MIN_RATIO`/`MAX_RATIO` and re-renders us
 * with the new number; a pane can never be dragged to nothing, and the layout
 * that goes into the session file is the layout on screen.
 */

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { t, useLanguage } from '../lib/i18n';
import {
  MAX_RATIO,
  MIN_RATIO,
  type LayoutNode,
  type SplitDirection,
  type SplitPath,
} from '../lib/layout';
import { resizeSplit, useWorkspace } from '../lib/workspace';
import { EditorPane } from './EditorPane';

/** One arrow press. Small enough to aim with, large enough to be worth pressing. */
const NUDGE = 0.02;
/** Page Up and Page Down, for crossing the pane in a few presses. */
const JUMP = 0.1;

function clamp(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

export function SplitContainer() {
  const { layout } = useWorkspace();
  return <div className="splitcontainer">{renderNode(layout, [])}</div>;
}

function renderNode(node: LayoutNode, path: SplitPath): ReactNode {
  if (node.kind === 'pane') return <EditorPane key={node.id} pane={node.id} />;
  return <Split key={pathKey(path)} node={node} path={path} />;
}

/** A stable React key for a split: where it sits in the tree. */
function pathKey(path: SplitPath): string {
  return path.length === 0 ? 'root' : path.join('-');
}

function Split({ node, path }: { node: Extract<LayoutNode, { kind: 'split' }>; path: SplitPath }) {
  const boxRef = useRef<HTMLDivElement>(null);

  return (
    <div className="split" data-direction={node.direction} ref={boxRef}>
      {/* `flex-basis: 0` with the ratio as the grow factor, so the two halves
          divide whatever is left after the divider's own width — which keeps
          the divider from shifting the split as the window narrows. */}
      <div className="split-half" style={{ flex: `${node.ratio} 1 0%` }}>
        {renderNode(node.first, [...path, 'first'])}
      </div>
      <Divider direction={node.direction} ratio={node.ratio} path={path} boxRef={boxRef} />
      <div className="split-half" style={{ flex: `${1 - node.ratio} 1 0%` }}>
        {renderNode(node.second, [...path, 'second'])}
      </div>
    </div>
  );
}

type DividerProps = {
  direction: SplitDirection;
  ratio: number;
  path: SplitPath;
  boxRef: RefObject<HTMLDivElement>;
};

/**
 * The handle between two halves.
 *
 * A wide hit area with a thin line drawn inside it: a 1 px target is a target
 * nobody hits, and a 6 px line is a gutter. The stylesheet draws the line; this
 * only says how wide the grab zone is by being that element.
 *
 * Keyboard-operable because it has to be — dragging is the only other way to
 * resize a pane, and "use the mouse" is not an answer. As a focusable
 * `separator` it is a real widget, so it carries `aria-valuenow` and friends and
 * a screen reader can read the split back as a percentage.
 */
function Divider({ direction, ratio, path, boxRef }: DividerProps) {
  useLanguage();
  const [dragging, setDragging] = useState(false);
  const horizontal = direction === 'horizontal';

  const ratioAt = (clientX: number, clientY: number): number | null => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return horizontal ? (clientX - box.left) / box.width : (clientY - box.top) / box.height;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // The pointer will leave this 8 px strip within the first few pixels of the
    // drag; without capture the resize stops the moment it does.
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const next = ratioAt(event.clientX, event.clientY);
    if (next !== null) resizeSplit(path, next);
  };

  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const nudge = (delta: number) => resizeSplit(path, clamp(ratio + delta));

  return (
    <div
      className="split-divider"
      role="separator"
      // A vertical line divides a horizontal split. The attribute describes the
      // divider, not the arrangement, and getting it the wrong way round is the
      // single easiest mistake in this file.
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={horizontal ? t('Breite der Bereiche') : t('Höhe der Bereiche')}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      aria-valuetext={t('{percent} %', { percent: Math.round(ratio * 100) })}
      tabIndex={0}
      data-dragging={dragging ? true : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => resizeSplit(path, 0.5)}
      onKeyDown={(event) => {
        const smaller = horizontal ? 'ArrowLeft' : 'ArrowUp';
        const larger = horizontal ? 'ArrowRight' : 'ArrowDown';
        if (event.key === smaller) nudge(-NUDGE);
        else if (event.key === larger) nudge(NUDGE);
        else if (event.key === 'PageUp') nudge(-JUMP);
        else if (event.key === 'PageDown') nudge(JUMP);
        else if (event.key === 'Home') resizeSplit(path, MIN_RATIO);
        else if (event.key === 'End') resizeSplit(path, MAX_RATIO);
        else if (event.key === 'Enter') resizeSplit(path, 0.5);
        else return;
        // Only reached when the key was one of ours, so the arrows still scroll
        // anything else that happens to be focused.
        event.preventDefault();
      }}
    >
      <span className="split-divider-line" aria-hidden />
    </div>
  );
}
