/**
 * Where a drop-down list or a submenu goes, and how tall it may be.
 *
 * Pure arithmetic, so it is tested without a window; `components/MenuBar.tsx`
 * measures and applies it. The rule is that a list never leaves the window:
 *
 * - A list under the menu row starts right under its button and gets the
 *   height that is left below it. What does not fit scrolls.
 * - A submenu opens to the right of its item, or to the left when the right
 *   has no room, and starts level with the item. Too tall for the space below
 *   the item, it moves up — as far as it has to and no further — and when it
 *   is taller than the whole window it fills it and scrolls.
 * - Nothing is ever wider than the window either; the labels ellipsize.
 */

/** A rectangle as `getBoundingClientRect()` gives it, reduced to its edges. */
export type Anchor = { left: number; right: number; top: number; bottom: number };

export type Placement = 'below' | 'side';

export type MenuPosition = { left: number; top: number; maxHeight: number };

/** How close a list may come to the window's edge. */
export const MENU_MARGIN = 6;

/** A submenu sits this much higher than its item, so their first lines align. */
const SIDE_LIFT = 5;
/** And overlaps its parent by this much, so the pointer can cross without a gap. */
const SIDE_OVERLAP = 2;

export function placeMenu(
  anchor: Anchor,
  /** The list's natural size, before any height limit of ours. */
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: Placement,
  margin = MENU_MARGIN,
): MenuPosition {
  const width = Math.min(size.width, viewport.width - 2 * margin);
  const floor = viewport.height - margin;

  let left: number;
  if (placement === 'below') {
    left = Math.min(anchor.left, viewport.width - margin - width);
  } else {
    left = anchor.right - SIDE_OVERLAP;
    if (left + width > viewport.width - margin) {
      // Flip to the left of the parent; if that does not fit either, the side
      // with more room wins and the clamp below keeps it inside.
      const flipped = anchor.left - width + SIDE_OVERLAP;
      left = flipped >= margin ? flipped : Math.min(left, viewport.width - margin - width);
    }
  }
  left = Math.max(margin, left);

  if (placement === 'below') {
    const top = Math.min(anchor.bottom, floor);
    return { left, top, maxHeight: Math.max(0, floor - top) };
  }

  let top = Math.max(margin, anchor.top - SIDE_LIFT);
  if (top + size.height > floor) top = Math.max(margin, floor - size.height);
  return { left, top, maxHeight: Math.max(0, floor - top) };
}

/**
 * The `scrollTop` that shows an item inside a list scrolled to `scrollTop`,
 * moving as little as possible — the keyboard's "nearest".
 */
export function scrollToShow(
  item: { top: number; height: number },
  list: { scrollTop: number; clientHeight: number },
): number {
  if (item.top < list.scrollTop) return item.top;
  const bottom = item.top + item.height;
  if (bottom > list.scrollTop + list.clientHeight) return bottom - list.clientHeight;
  return list.scrollTop;
}
