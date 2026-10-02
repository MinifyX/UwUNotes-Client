/**
 * The tabs Ctrl+Shift+T can bring back, in the order they were closed.
 *
 * Two kinds share one stack, because the user closed them in one sequence and
 * expects them back in that sequence: a clean file, which is just a path to
 * open again, and a tab that had unsaved changes, whose text went to the note
 * trash and is named here by its trash entry. Mixing them in two lists would
 * bring back the wrong one first.
 *
 * Pure and small, so the ordering is testable without a window. What popping
 * an entry *does* is `lib/files.ts`'s and `lib/notebook.ts`'s business.
 */

export type ClosedTab = { kind: 'path'; path: string } | { kind: 'trash'; id: string };

/** Enough to undo a careless "close all" in a busy window, not a history. */
export const CLOSED_LIMIT = 30;

export type ClosedStack = {
  push(entry: ClosedTab): void;
  /** The most recently closed tab, taken off the stack. */
  pop(): ClosedTab | undefined;
  /** A trash entry that came back another way (the sidebar) or was deleted. */
  forgetTrash(id: string): void;
  size(): number;
  clear(): void;
};

export function createClosedStack(limit = CLOSED_LIMIT): ClosedStack {
  let entries: ClosedTab[] = [];
  return {
    push(entry) {
      // The same file closed twice is one entry, at the top: opening it again
      // twice would only reveal the tab that is already there.
      if (entry.kind === 'path') {
        entries = entries.filter((old) => old.kind !== 'path' || old.path !== entry.path);
      }
      entries.push(entry);
      if (entries.length > limit) entries = entries.slice(-limit);
    },
    pop() {
      return entries.pop();
    },
    forgetTrash(id) {
      entries = entries.filter((entry) => entry.kind !== 'trash' || entry.id !== id);
    },
    size() {
      return entries.length;
    },
    clear() {
      entries = [];
    },
  };
}
