/**
 * Editor line → preview offset, for scroll sync.
 *
 * Every block in the preview carries the source line it starts on, so the
 * preview is a list of anchors: "line 12 is drawn 340 px down". The editor's
 * top visible line usually falls between two of them, and the offset is
 * interpolated between the anchor before and the anchor after — which is what
 * keeps a long paragraph or code block from making the preview jump in steps.
 *
 * Pure, so it can be tested without a layout engine; the component measures
 * and this decides.
 */

export type LineAnchor = {
  /** Zero-based source line. */
  line: number;
  /** Offset of the element's top inside the scroll container, in px. */
  top: number;
};

/**
 * Where the preview should scroll so that `line` (zero-based, may be
 * fractional) sits at its top. `anchors` must be sorted by line.
 */
export function previewOffsetForLine(anchors: readonly LineAnchor[], line: number): number {
  const first = anchors[0];
  if (!first) return 0;
  // Above the first block — blank lines, usually — runs from the very top of
  // the preview down to that block, so the first scroll does not jump.
  if (line <= first.line) {
    return first.line === 0 ? 0 : (first.top * Math.max(0, line)) / first.line;
  }

  // Binary search for the last anchor at or before the line: a long document
  // has thousands of blocks and this runs on every scroll frame.
  let low = 0;
  let high = anchors.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((anchors[mid]?.line ?? 0) <= line) low = mid;
    else high = mid - 1;
  }

  const before = anchors[low];
  if (!before) return 0;
  const after = anchors[low + 1];
  if (!after || after.line === before.line) return before.top;
  const fraction = (line - before.line) / (after.line - before.line);
  return before.top + (after.top - before.top) * fraction;
}

/**
 * The anchors with duplicate lines folded into the first one.
 *
 * A list item and the paragraph inside it start on the same line; keeping both
 * would give a zero-length span to interpolate across.
 */
export function dedupeAnchors(anchors: readonly LineAnchor[]): LineAnchor[] {
  const sorted = [...anchors].sort((a, b) => a.line - b.line || a.top - b.top);
  const result: LineAnchor[] = [];
  for (const anchor of sorted) {
    const last = result[result.length - 1];
    if (last && last.line === anchor.line) continue;
    // A later line drawn above an earlier one is a nested element measured
    // oddly; it would make the offset run backwards, so it is skipped.
    if (last && anchor.top < last.top) continue;
    result.push(anchor);
  }
  return result;
}
