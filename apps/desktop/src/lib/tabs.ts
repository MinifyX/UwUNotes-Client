/**
 * Pinned tabs and tab colours, as plain rules over lists of ids.
 *
 * The flags themselves live on the document (`DocMeta.pinned`, `DocMeta.color`
 * in `lib/documents.ts`), because that is what the session writes down per
 * document. What lives here is what follows from them: pinned tabs sit at the
 * left of their bar, a drag cannot mix the two groups, and the bulk-close
 * commands leave a pinned tab alone. Every function takes an `isPinned`
 * callback instead of reading the document store, so the rules can be tested
 * with strings and `lib/workspace.ts` can use them without an import cycle.
 */

import type { DocId } from './documents';
import { N_ } from './i18n';

/**
 * The colours a tab can wear, Notepad++ style.
 *
 * Five, and none of them pink: pink already means "the active tab" and a
 * coloured tab must never be mistaken for the one you are typing in. Each one
 * is a syntax colour from `@uwu/tokens`' `code.css`, which are checked against
 * both grounds — so a stripe stays visible in light and dark without a second
 * palette.
 */
export const TAB_COLORS = ['blue', 'green', 'yellow', 'violet', 'red'] as const;

export type TabColor = (typeof TAB_COLORS)[number];

/** German source names; translated where they are shown. */
export const TAB_COLOR_NAMES: Record<TabColor, string> = {
  blue: N_('Blau'),
  green: N_('Grün'),
  yellow: N_('Gelb'),
  violet: N_('Violett'),
  red: N_('Rot'),
};

/** A colour read back from the session file, or `undefined` for none or nonsense. */
export function sanitizeTabColor(raw: unknown): TabColor | undefined {
  return TAB_COLORS.includes(raw as TabColor) ? (raw as TabColor) : undefined;
}

type IsPinned = (doc: DocId) => boolean;

/**
 * The tabs with the pinned ones moved to the front, each group in its own
 * order. Hands back the very same array when nothing had to move, so a caller
 * can tell "already in order" apart without comparing element by element.
 */
export function pinnedFirst(tabs: readonly DocId[], isPinned: IsPinned): readonly DocId[] {
  let seenLoose = false;
  let ordered = true;
  for (const doc of tabs) {
    if (!isPinned(doc)) seenLoose = true;
    else if (seenLoose) {
      ordered = false;
      break;
    }
  }
  if (ordered) return tabs;
  return [...tabs.filter(isPinned), ...tabs.filter((doc) => !isPinned(doc))];
}

/**
 * Where a dragged tab may land, as an index over the *other* tabs — the same
 * convention as `reorderTab`, which takes the tab out before putting it back.
 *
 * A pinned tab stays inside the pinned group and a loose one outside it. A
 * drop across the boundary lands at the boundary, which is the closest place
 * that is allowed and is where the marker is drawn.
 */
export function clampDropIndex(
  tabs: readonly DocId[],
  doc: DocId,
  index: number,
  isPinned: IsPinned,
): number {
  const others = tabs.filter((id) => id !== doc);
  const pinned = others.filter(isPinned).length;
  const at = Math.max(0, Math.min(others.length, index));
  return isPinned(doc) ? Math.min(at, pinned) : Math.max(at, pinned);
}

export type CloseScope = 'all' | 'others' | 'right';

/**
 * Which tabs a bulk close actually closes.
 *
 * Pinned tabs never: pinning is how somebody says "this one stays", and "close
 * all" is precisely the moment it was said for. Closing a pinned tab is still
 * one click on its own cross, or Ctrl+W.
 *
 * `right` is relative to `doc` in the bar's order; `doc` itself is only ever
 * closed by `all`.
 */
export function tabsToClose(
  tabs: readonly DocId[],
  doc: DocId | null,
  scope: CloseScope,
  isPinned: IsPinned,
): DocId[] {
  const at = doc === null ? -1 : tabs.indexOf(doc);
  return tabs.filter((id, index) => {
    if (isPinned(id)) return false;
    if (scope === 'all') return true;
    if (id === doc) return false;
    return scope === 'others' || index > at;
  });
}

/**
 * A pinned tab's short name. The stylesheet trims the rest, but a file name
 * keeps its extension at the end, and `main.rs` should not lose to
 * `very-long-module-na…` just because the start happened to be long.
 */
export function shortTabName(name: string, max = 12): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 5 ? name.slice(dot) : '';
  const keep = Math.max(1, max - extension.length - 1);
  return `${name.slice(0, keep)}…${extension}`;
}
