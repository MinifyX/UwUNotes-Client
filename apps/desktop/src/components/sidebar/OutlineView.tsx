/**
 * The sidebar's outline: headings of a Markdown file, symbols of a code file,
 * sections of a config file — for whichever document is active.
 *
 * What counts as structure is decided in `lib/outline.ts`; this is the list.
 * It follows the document through `subscribeDocState`, like the status bar —
 * every transaction, including the background parser's, replaces the state in
 * the store — and compares identities: the text, the syntax tree (which grows
 * while a big file is parsed in the background) and the language. Only a
 * change in one of those re-extracts, after a short pause, so typing in a long
 * file does not redo the outline on every keystroke. The caret is cheaper, and
 * is followed on every state to keep the current section lit.
 */

import { syntaxTree } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { resolveLanguage } from '../../editor/languages';
import {
  documentsVersion,
  getDoc,
  getMeta,
  subscribeDocState,
  subscribeDocuments,
} from '../../lib/documents';
import { t, useLanguage } from '../../lib/i18n';
import {
  currentOutlineIndex,
  extractOutline,
  filterOutline,
  type OutlineItem,
} from '../../lib/outline';
import { activeView } from '../../lib/views';
import { useWorkspace } from '../../lib/workspace';

/** The pause after the text stops changing before the outline is rebuilt. */
const REBUILD_MS = 250;

export function OutlineView() {
  useLanguage();
  const version = useSyncExternalStore(subscribeDocuments, documentsVersion);
  const workspace = useWorkspace();
  const docId = workspace.panes[workspace.activePane]?.active ?? null;
  const meta = docId ? getMeta(docId) : undefined;
  const languageId = meta ? (resolveLanguage(meta)?.id ?? null) : null;

  const [items, setItems] = useState<OutlineItem[]>([]);
  const [caret, setCaret] = useState(0);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let timer = 0;
    let shown: { doc: unknown; tree: unknown } | null = null;
    let lastCaret = -1;

    // The store, not the view: every transaction is written back to it, and
    // it cannot be caught halfway through a tab switch showing the old file.
    const stateNow = () => (docId ? getDoc(docId)?.state : undefined);

    const rebuild = () => {
      const state = stateNow();
      setItems(state ? extractOutline(state, languageId) : []);
    };
    // A different document or language is drawn at once; only edits wait.
    rebuild();

    const look = () => {
      const state = stateNow();
      if (!state) return;
      const head = state.selection.main.head;
      if (head !== lastCaret) {
        lastCaret = head;
        setCaret(head);
      }
      const tree = syntaxTree(state);
      if (shown && shown.doc === state.doc && shown.tree === tree) return;
      const firstLook = shown === null;
      shown = { doc: state.doc, tree };
      if (firstLook) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(rebuild, REBUILD_MS);
    };

    look();
    const stop = subscribeDocState((id) => {
      if (id === docId) look();
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [docId, languageId, version]);

  const current = useMemo(() => currentOutlineIndex(items, caret), [items, caret]);
  const shownItems = useMemo(() => filterOutline(items, query), [items, query]);
  const currentItem = current >= 0 ? items[current] : undefined;

  // Keep the lit entry in sight while the caret walks through a long file.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [currentItem]);

  const jump = (item: OutlineItem) => {
    const view = activeView();
    if (!view) return;
    const at = Math.min(item.from, view.state.doc.length);
    view.dispatch({
      selection: EditorSelection.cursor(at),
      effects: EditorView.scrollIntoView(at, { y: 'center' }),
    });
    view.focus();
  };

  return (
    <div className="sidebar-view outline-view">
      <header className="sidebar-header">
        <h2 className="sidebar-title">{t('Gliederung')}</h2>
      </header>
      <div className="outline-body">
        <input
          type="search"
          className="outline-filter"
          placeholder={t('Filtern…')}
          aria-label={t('Gliederung filtern')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter jumps to the first match, Escape clears: the two things
            // anyone does in a filter box next to a list.
            if (event.key === 'Enter' && shownItems[0]) jump(shownItems[0]);
            if (event.key === 'Escape') setQuery('');
          }}
        />
        {!docId ? (
          <p className="outline-empty">{t('Keine Datei geöffnet.')}</p>
        ) : shownItems.length === 0 ? (
          <p className="outline-empty">
            {query.trim()
              ? t('Nichts gefunden (・_・;)')
              : languageId === 'markdown'
                ? t('Noch keine Überschriften. Ein # am Zeilenanfang macht eine.')
                : t('Nichts zu gliedern (・_・;)')}
          </p>
        ) : (
          <ul className="outline-list" ref={listRef}>
            {shownItems.map((item) => (
              <li key={`${item.from}-${item.label}`}>
                <button
                  type="button"
                  className="outline-item"
                  data-kind={item.kind}
                  aria-current={item === currentItem ? true : undefined}
                  style={{ paddingLeft: `${10 + item.depth * 12}px` }}
                  title={t('Zeile {line}', { line: item.line })}
                  onClick={() => jump(item)}
                >
                  <span className="outline-mark" aria-hidden />
                  <span className="outline-label">{item.label || '…'}</span>
                  <span className="outline-line">{item.line}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
