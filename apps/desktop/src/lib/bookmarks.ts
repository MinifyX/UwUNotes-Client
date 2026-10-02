/**
 * Bookmarks at the app's level: the commands, the list across every open
 * document, and the trip into and out of the session file.
 *
 * The marks themselves live in each document's `EditorState` (see
 * `editor/bookmarks.ts`), which is what makes them move with the text. This
 * module only reads them back out — from the store, where every document's
 * current state is, so a tab in a background pane is listed as well as the one
 * on screen.
 *
 * In the session a document's bookmarks are line numbers. Positions would be
 * exact for one version of the file and wrong for the next: the session can
 * outlive an edit made in another program, and a line number survives that
 * far better than an offset does.
 */

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  bookmarkedText,
  bookmarkField,
  bookmarkLines,
  clearBookmarks,
  deleteBookmarkedLines,
  gotoBookmark,
  setBookmarksEffect,
  toggleBookmark,
} from '../editor/bookmarks';
import { setSidebarView } from './chrome';
import type { Command } from './commands';
import { allDocs, getDoc, setDocState, type DocId } from './documents';
import { t } from './i18n';
import { shortcutLabel } from './shortcuts';
import { toast } from './toast';
import { activeView, viewFor } from './views';
import { getPane, paneOf, showDoc } from './workspace';

/** Whether two {@link bookmarkSignature}s describe the same moment. */
export function sameSignature(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((part, index) => part === b[index]);
}

/** At most this many marks per document come back from a session file. */
const MAX_RESTORED = 5_000;

/* ── Reading them out ──────────────────────────────────── */

export type BookmarkEntry = {
  docId: DocId;
  name: string;
  path: string | null;
  /** 1-based. */
  line: number;
  text: string;
};

/** Every bookmark in every open document, document by document, line by line. */
export function allBookmarks(): BookmarkEntry[] {
  const entries: BookmarkEntry[] = [];
  for (const doc of allDocs()) {
    const { state, meta } = doc;
    for (const line of bookmarkLines(state)) {
      entries.push({
        docId: meta.id,
        name: meta.name,
        path: meta.path,
        line,
        text: state.doc.line(line).text,
      });
    }
  }
  return entries;
}

/**
 * Something that changes whenever any document's bookmarks or bookmarked text
 * could have — cheap enough to compare on every animation frame. The field
 * value and the doc are both immutable, so identity is the whole comparison.
 */
export function bookmarkSignature(): unknown[] {
  const parts: unknown[] = [];
  for (const doc of allDocs()) {
    parts.push(doc.meta.id, doc.meta.name, doc.state.doc, doc.state.field(bookmarkField, false));
  }
  return parts;
}

/* ── The session ───────────────────────────────────────── */

/** What `persistSession` writes for a document; `undefined` keeps the field out of the file. */
export function bookmarksForSession(id: DocId): number[] | undefined {
  const doc = getDoc(id);
  if (!doc) return undefined;
  const lines = bookmarkLines(doc.state);
  return lines.length > 0 ? lines : undefined;
}

/** Whatever the session file holds, made into a list of line numbers or nothing. */
export function sanitizeBookmarkLines(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const lines = raw
    .filter((line): line is number => Number.isInteger(line) && line >= 1)
    .slice(0, MAX_RESTORED);
  return lines.length > 0 ? lines : undefined;
}

/** Puts restored marks into a freshly opened document. Lines past its end are dropped. */
export function restoreBookmarks(id: DocId, lines: readonly number[] | undefined): void {
  if (!lines || lines.length === 0) return;
  const doc = getDoc(id);
  if (!doc) return;
  setDocState(id, doc.state.update({ effects: setBookmarksEffect.of(lines) }).state);
}

/* ── Going somewhere ───────────────────────────────────── */

function liveView(id: DocId): EditorView | undefined {
  const pane = paneOf(id);
  return pane && getPane(pane)?.active === id ? viewFor(pane) : undefined;
}

/**
 * Shows a document with the caret at the start of `line`, centred.
 *
 * A document in a background tab has no view yet. Its selection goes into the
 * stored state first, so the editor it is handed to already has the caret in
 * place, and the scroll follows once the pane has swapped it in — scrolling is
 * a property of a view, and there is none to scroll until then.
 */
export function revealLine(id: DocId, line: number): void {
  const doc = getDoc(id);
  if (!doc) return;
  const number = Math.max(1, Math.min(line, doc.state.doc.lines));
  const from = doc.state.doc.line(number).from;
  const reveal = (view: EditorView) => {
    view.dispatch({
      selection: EditorSelection.cursor(from),
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
    view.focus();
  };

  const view = liveView(id);
  if (view) {
    reveal(view);
    return;
  }
  setDocState(id, doc.state.update({ selection: EditorSelection.cursor(from) }).state);
  showDoc(id);
  // One frame for React to swap the document in, one for CodeMirror to have
  // measured it — the same two the session restore waits for.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const shown = liveView(id);
      if (shown) reveal(shown);
    });
  });
}

/** Takes one mark away, wherever its document is — the sidebar's remove button. */
export function removeBookmark(id: DocId, line: number): void {
  const doc = getDoc(id);
  if (!doc) return;
  const lines = bookmarkLines(doc.state).filter((marked) => marked !== line);
  const effects = setBookmarksEffect.of(lines);
  const view = liveView(id);
  if (view) view.dispatch({ effects });
  else setDocState(id, doc.state.update({ effects }).state);
}

/* ── Commands ──────────────────────────────────────────── */

function withView(run: (view: EditorView) => void): () => void {
  return () => {
    const view = activeView();
    if (view) run(view);
  };
}

const hasBookmarks = () => {
  const view = activeView();
  return view !== undefined && bookmarkLines(view.state).length > 0;
};

export function bookmarkCommands(): Command[] {
  const group = () => t('Lesezeichen');
  const hasView = () => activeView() !== undefined;
  return [
    {
      id: 'bookmark.toggle',
      title: () => t('Lesezeichen setzen oder entfernen'),
      group,
      shortcut: shortcutLabel('bookmark.toggle'),
      enabled: hasView,
      run: withView((view) => toggleBookmark(view)),
    },
    {
      id: 'bookmark.next',
      title: () => t('Nächstes Lesezeichen'),
      group,
      shortcut: shortcutLabel('bookmark.next'),
      enabled: hasBookmarks,
      run: withView((view) => {
        gotoBookmark(view);
      }),
    },
    {
      id: 'bookmark.previous',
      title: () => t('Vorheriges Lesezeichen'),
      group,
      shortcut: shortcutLabel('bookmark.previous'),
      enabled: hasBookmarks,
      run: withView((view) => {
        gotoBookmark(view, true);
      }),
    },
    {
      id: 'bookmark.clear',
      title: () => t('Alle Lesezeichen entfernen'),
      group,
      enabled: hasBookmarks,
      run: withView(clearBookmarks),
    },
    {
      id: 'bookmark.copyLines',
      title: () => t('Lesezeichen-Zeilen kopieren'),
      group,
      enabled: hasBookmarks,
      run: async () => {
        const view = activeView();
        if (!view) return;
        try {
          await navigator.clipboard.writeText(bookmarkedText(view.state));
          toast('success', t('Lesezeichen-Zeilen kopiert.'));
        } catch {
          toast('error', t('Die Zwischenablage hat den Text nicht angenommen.'));
        }
      },
    },
    {
      id: 'bookmark.deleteLines',
      title: () => t('Lesezeichen-Zeilen löschen'),
      group,
      enabled: () => hasBookmarks() && activeView()?.state.readOnly === false,
      run: withView((view) => {
        const count = deleteBookmarkedLines(view);
        // Plain on purpose: this removed text. Ctrl+Z brings it back, and
        // saying so is the useful half of the message.
        if (count === 1) toast('info', t('Eine Zeile gelöscht. Strg+Z holt sie zurück.'));
        else if (count > 1) {
          toast('info', t('{count} Zeilen gelöscht. Strg+Z holt sie zurück.', { count }));
        }
      }),
    },
    {
      id: 'bookmark.showList',
      title: () => t('Lesezeichen in der Seitenleiste zeigen'),
      group,
      run: () => setSidebarView('bookmarks'),
    },
  ];
}
