/**
 * Task list items — `- [ ] milk` — as text, without a parser.
 *
 * The editor, the preview and the command palette all need the same answer to
 * one question: is there a checkbox on this line, and where exactly is it? A
 * line-level pattern is the right tool for that rather than the Markdown tree,
 * because the editor has to answer for every document (a `.txt` shopping list
 * is a task list too) and for lines the grammar has not parsed yet.
 *
 * The pattern follows GitHub's rule: a list marker, whitespace, a box with a
 * space or an `x` in it, and then whitespace or the end of the line. `[ ]milk`
 * is not a task, and neither is a box with anything else in it. Block quotes
 * are allowed in front, because a task quoted in a reply is still a task.
 */

/** Everything before the box, then the box's content. Kept unanchored at the end on purpose. */
const TASK = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/;

export type TaskBox = {
  /** Offset of the `[` within the line. */
  start: number;
  checked: boolean;
};

/** Where the checkbox on this line is, or `null` when the line is not a task. */
export function findTaskBox(lineText: string): TaskBox | null {
  const match = TASK.exec(lineText);
  if (!match?.[1] || match[2] === undefined) return null;
  return { start: match[1].length, checked: match[2] !== ' ' };
}

/**
 * The one-character change that flips the box on a line starting at
 * `lineFrom`, or `null` when there is no box to flip.
 *
 * Only the character between the brackets is replaced. Replacing the whole
 * line would be simpler and would also move every caret and bookmark on it,
 * which is not what clicking a checkbox should do.
 */
export function taskToggleChange(
  lineText: string,
  lineFrom: number,
): { from: number; to: number; insert: string } | null {
  const box = findTaskBox(lineText);
  if (!box) return null;
  const at = lineFrom + box.start + 1;
  return { from: at, to: at + 1, insert: box.checked ? ' ' : 'x' };
}
