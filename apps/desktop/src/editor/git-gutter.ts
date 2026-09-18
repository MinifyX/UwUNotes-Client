/**
 * The thin column between the line numbers and the text, saying which lines
 * this file has gained, changed or lost since git last looked at it.
 *
 * The marks are `git diff` output and nothing cleverer: `lib/git.ts` asks Rust
 * for the hunks of one file, this module turns line numbers into positions and
 * draws three kinds of mark. A deleted hunk gets a small wedge on the boundary
 * instead of a bar, because nothing on that line was removed — the lines around
 * it were, and a full-height bar would be pointing at the wrong text.
 *
 * Marks arrive as a {@link StateEffect} and live in a {@link StateField}, so new
 * hunks are one transaction and cost a gutter redraw. Rebuilding the editor's
 * configuration for them — which is what a facet or a compartment would need —
 * would throw away the measured line heights of every open document each time
 * someone saved a file.
 *
 * What it does not do: ask git anything (that is `lib/git.ts`), or decide when
 * a file has changed (that is git's whole job, and we are not going to do it
 * again in TypeScript).
 */

import {
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import { EditorView, GutterMarker, ViewPlugin, gutter, type ViewUpdate } from '@codemirror/view';
import { getMeta, subscribeDocuments, type DocId } from '../lib/documents';
import { gitHunks, scheduleGitHunks, subscribeGitHunks, type GitHunk } from '../lib/git';
import { N_ } from '../lib/i18n';
import { getSettings } from '../lib/settings';
import { viewFor } from '../lib/views';
import { getWorkspace } from '../lib/workspace';
import { registerPlugin } from './extensions/registry';

/** What the store knows about one document. The field turns it into positions. */
type GitGutterReport = {
  hunks: GitHunk[];
  /**
   * The buffer differs from the file on disk, and git diffed the file on disk.
   * The marks are therefore describing a document that no longer exists; they
   * are dimmed rather than removed, because "roughly here, a moment ago" is
   * more use than a blank column, and far more use than a confident lie.
   */
  stale: boolean;
  /** `settings.gitGutter`. Off collapses the column instead of leaving it blank. */
  enabled: boolean;
};

/** A report, plus the marks it produced against one particular document. */
type GitGutterMarks = GitGutterReport & { bars: RangeSet<GutterMarker> };

const NO_HUNKS: GitHunk[] = [];

const setGitGutterReport = StateEffect.define<GitGutterReport>();

const EMPTY_REPORT: GitGutterReport = { hunks: NO_HUNKS, stale: false, enabled: true };
const EMPTY_MARKS: GitGutterMarks = { ...EMPTY_REPORT, bars: RangeSet.empty };

const gitGutterMarks = StateField.define<GitGutterMarks>({
  create: () => EMPTY_MARKS,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setGitGutterReport)) continue;
      const report = effect.value;
      const unchanged = report.hunks === marks.hunks && !transaction.docChanged;
      return {
        ...report,
        bars: unchanged ? marks.bars : buildBars(transaction.state, report.hunks),
      };
    }

    if (!transaction.docChanged || marks.hunks.length === 0) return marks;
    // The line numbers now point into a document that has moved on. They are
    // rebuilt rather than mapped through the changes, because a gutter marker
    // only counts when it sits exactly on the start of a line, and an insertion
    // at that exact position would carry it one character past it — where it
    // silently stops being drawn at all.
    return { ...marks, stale: true, bars: buildBars(transaction.state, marks.hunks) };
  },
});

/* ── Drawing ───────────────────────────────────────────── */

class GitMark extends GutterMarker {
  constructor(readonly className: string) {
    super();
  }

  override eq(other: GitMark): boolean {
    return other.className === this.className;
  }

  override toDOM(): HTMLElement {
    const mark = document.createElement('span');
    mark.className = this.className;
    // Decoration, and an unreadable one: which lines changed is not something
    // a screen reader can usefully be handed one span at a time.
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  }
}

const MARKS = {
  added: new GitMark('cm-uwuGitBar cm-uwuGitBar-added'),
  modified: new GitMark('cm-uwuGitBar cm-uwuGitBar-modified'),
  deletedAbove: new GitMark('cm-uwuGitWedge cm-uwuGitWedge-above'),
  deletedBelow: new GitMark('cm-uwuGitWedge cm-uwuGitWedge-below'),
} as const;

function buildBars(state: EditorState, hunks: GitHunk[]): RangeSet<GutterMarker> {
  const ranges: Range<GutterMarker>[] = [];
  for (const hunk of hunks) {
    const line = state.doc.line(lineOf(state, hunk));
    ranges.push(markFor(hunk).range(line.from));
  }
  // Sorted on the way in: git emits hunks in order, but a stale hunk that had
  // to be clamped to the end of the document can land before its predecessor,
  // and an unsorted set is a thrown exception in the middle of a keystroke.
  return RangeSet.of(ranges, true);
}

/**
 * Which line a hunk is drawn on, in the document as it is right now.
 *
 * A deletion is drawn on the line *after* the removed text and hangs off its
 * top edge — that is where the gap is. At the end of the file there is no line
 * after, so the last line carries the wedge below itself instead.
 *
 * Everything is clamped into the document: while marks are stale their line
 * numbers can point past the end of a file that has just had a paragraph
 * deleted out of it.
 */
function lineOf(state: EditorState, hunk: GitHunk): number {
  const lines = state.doc.lines;
  const line = hunk.kind === 'deleted' ? hunk.fromLine + 1 : hunk.fromLine;
  return Math.min(Math.max(line, 1), lines);
}

function markFor(hunk: GitHunk): GitMark {
  if (hunk.kind === 'added') return MARKS.added;
  if (hunk.kind === 'modified') return MARKS.modified;
  return hunk.fromLine === 0 ? MARKS.deletedAbove : MARKS.deletedBelow;
}

/* ── Feeding the field ─────────────────────────────────── */

/**
 * Which document a view is showing.
 *
 * A pane owns one view for its whole life and swaps documents through it, so
 * the question can only be answered by asking the workspace which pane this
 * view belongs to. `lib/views.ts` deliberately does not know about documents,
 * and this is the one place that has to.
 */
function docIdOf(view: EditorView): DocId | null {
  const { panes } = getWorkspace();
  for (const [paneId, pane] of Object.entries(panes)) {
    if (viewFor(paneId) === view) return pane.active;
  }
  return null;
}

/**
 * Carries the store into the view.
 *
 * A plugin instance is built fresh every time a pane is handed another
 * document, which is what makes it a safe place to ask "which file is this?" —
 * the answer cannot go stale underneath it.
 */
const gitGutterFeed = ViewPlugin.fromClass(
  class {
    private readonly stopHunks: () => void;
    private readonly stopDocuments: () => void;
    private alive = true;

    constructor(private readonly view: EditorView) {
      this.stopHunks = subscribeGitHunks(() => this.push());
      // The dirty flag decides whether the marks are dimmed, and it lives in
      // the document store rather than in git's.
      this.stopDocuments = subscribeDocuments(() => this.push());
      // A plugin is constructed in the middle of the update that created it,
      // and an editor in the middle of an update will not accept a transaction.
      // A microtask is the first moment it will.
      queueMicrotask(() => this.push());
    }

    update(update: ViewUpdate) {
      if (!update.docChanged) return;
      const docId = docIdOf(update.view);
      // Debounced on the other side. Typing does not change the file git is
      // looking at, but an autosave does, and this is where we would hear it.
      if (docId) scheduleGitHunks(docId);
    }

    destroy() {
      this.alive = false;
      this.stopHunks();
      this.stopDocuments();
    }

    private push() {
      if (!this.alive) return;
      const docId = docIdOf(this.view);
      const meta = docId === null ? undefined : getMeta(docId);
      const report: GitGutterReport = {
        hunks: docId === null ? NO_HUNKS : gitHunks(docId),
        stale: meta?.dirty ?? false,
        enabled: getSettings().gitGutter,
      };

      // Every listener fires for every document, so most pushes have nothing to
      // say. Dispatching them anyway would be a transaction per open file per
      // keystroke in any of them.
      const known = this.view.state.field(gitGutterMarks, false);
      if (known && sameReport(known, report)) return;
      this.view.dispatch({ effects: setGitGutterReport.of(report) });
    }
  },
);

function sameReport(a: GitGutterReport, b: GitGutterReport): boolean {
  return a.hunks === b.hunks && a.stale === b.stale && a.enabled === b.enabled;
}

/* ── The extension ─────────────────────────────────────── */

const gitGutterTheme = EditorView.baseTheme({
  // Two classes, to outrank the `overflow: hidden` every gutter gets by
  // default — which would otherwise clip the wedge at the line boundary.
  '.cm-gutter.cm-uwuGitGutter': {
    width: '3px',
    marginLeft: '4px',
    marginRight: '3px',
    overflow: 'visible',
  },
  '.cm-uwuGitGutter .cm-gutterElement': { position: 'relative' },

  '.cm-uwuGitBar': {
    display: 'block',
    width: '3px',
    height: '100%',
    borderRadius: '1px',
  },
  '.cm-uwuGitBar-added': { backgroundColor: 'var(--uwu-code-added)' },
  '.cm-uwuGitBar-modified': { backgroundColor: 'var(--uwu-code-modified)' },

  // A triangle pointing into the text, sitting on the boundary the removed
  // lines used to be at.
  '.cm-uwuGitWedge': {
    position: 'absolute',
    left: '0',
    width: '0',
    height: '0',
    borderLeft: '5px solid var(--uwu-code-deleted)',
    borderTop: '3px solid transparent',
    borderBottom: '3px solid transparent',
  },
  '.cm-uwuGitWedge-above': { top: '-3px' },
  '.cm-uwuGitWedge-below': { bottom: '-3px' },

  // Last, because these two win over the rules above on source order alone.
  '&[data-uwu-git="stale"] .cm-uwuGitGutter': { opacity: '0.4' },
  // Collapsed rather than hidden: `display` on a gutter is `!important` in
  // CodeMirror's own base theme, and there is nothing in the column to hide
  // anyway once `lib/git.ts` stops answering.
  '&[data-uwu-git="off"] .cm-uwuGitGutter': { width: '0', marginLeft: '0', marginRight: '0' },
});

const STALE_EDITOR = { 'data-uwu-git': 'stale' };
const FRESH_EDITOR = { 'data-uwu-git': 'fresh' };
const OFF_EDITOR = { 'data-uwu-git': 'off' };

/**
 * The gutter, for `editor/setup.ts` to include directly if it ever wants to.
 * Normally it arrives through the plugin registered at the bottom of this file.
 */
export const gitGutter: Extension = [
  gitGutterMarks,
  gutter({
    class: 'cm-uwuGitGutter',
    markers: (view) => view.state.field(gitGutterMarks).bars,
    // A hidden marker of the same size, so the column is exactly as wide with
    // no marks in it as with some. Without it, the text steps sideways the
    // first time a file is edited.
    initialSpacer: () => MARKS.added,
  }),
  gitGutterFeed,
  // An attribute rather than a class per marker: staleness applies to all of
  // them at once and changes far more often than the marks themselves do.
  EditorView.editorAttributes.compute([gitGutterMarks], (state) => {
    const marks = state.field(gitGutterMarks);
    if (!marks.enabled) return OFF_EDITOR;
    return marks.stale ? STALE_EDITOR : FRESH_EDITOR;
  }),
  gitGutterTheme,
];

// A module-level registration, as `registry.ts` describes: `editor/setup.ts`
// imports this file for the side effect and that is the whole wiring. It costs
// the plugin the first slot in the settings list, which is where an import
// evaluated before the built-ins puts it.
registerPlugin({
  id: 'git-gutter',
  name: N_('Git-Markierungen am Zeilenrand'),
  description: N_(
    'Markiert neben jeder Zeile, was sich gegenüber dem Stand in Git geändert hat — hinzugefügt, geändert oder gelöscht.',
  ),
  defaultEnabled: true,
  build: () => gitGutter,
});
