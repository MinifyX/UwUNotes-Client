/**
 * The sidebar's bookmark list: every bookmark in every open document, with
 * the text of its line, grouped by file.
 *
 * Notepad++ has no such list and its users keep asking for one; with marks in
 * five files, F2 only ever walks the one in front of you. A click jumps there,
 * opening the tab if it is in the background.
 *
 * The marks live in each document's state, so this listens for new states
 * (`subscribeDocState`, which covers background tabs too) and compares
 * identities — each document's text and its bookmark set — and only rebuilds
 * the list when one of them actually moved.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  allBookmarks,
  bookmarkSignature,
  removeBookmark,
  revealLine,
  sameSignature,
  type BookmarkEntry,
} from '../../lib/bookmarks';
import {
  documentsVersion,
  subscribeDocState,
  subscribeDocuments,
  type DocId,
} from '../../lib/documents';
import { t, useLanguage } from '../../lib/i18n';
import { shortcutLabel } from '../../lib/shortcuts';
import { Icon } from '../Icon';

/** Long lines are cut in the row; the whole line is in the tooltip. */
const MAX_TEXT = 120;

type Group = { docId: DocId; name: string; path: string | null; entries: BookmarkEntry[] };

function grouped(entries: BookmarkEntry[]): Group[] {
  const groups: Group[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.docId === entry.docId) last.entries.push(entry);
    else groups.push({ docId: entry.docId, name: entry.name, path: entry.path, entries: [entry] });
  }
  return groups;
}

export function BookmarksView() {
  useLanguage();
  const version = useSyncExternalStore(subscribeDocuments, documentsVersion);
  const [entries, setEntries] = useState<BookmarkEntry[]>(() => allBookmarks());

  useEffect(() => {
    let shown = bookmarkSignature();
    setEntries(allBookmarks());

    return subscribeDocState(() => {
      const now = bookmarkSignature();
      if (sameSignature(now, shown)) return;
      shown = now;
      setEntries(allBookmarks());
    });
  }, [version]);

  const groups = useMemo(() => grouped(entries), [entries]);

  return (
    <div className="sidebar-view bookmarks-view">
      <header className="sidebar-header">
        <h2 className="sidebar-title">{t('Lesezeichen')}</h2>
      </header>
      <div className="outline-body">
        {groups.length === 0 ? (
          <p className="outline-empty">
            {t('Noch keine Lesezeichen. {key} setzt eins in der Zeile mit dem Cursor.', {
              key: shortcutLabel('bookmark.toggle') ?? 'Strg+F2',
            })}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.docId} className="bookmarks-group">
              <h3 className="bookmarks-file" title={group.path ?? group.name}>
                {group.name}
              </h3>
              <ul className="outline-list">
                {group.entries.map((entry) => {
                  const text = entry.text.trim();
                  return (
                    <li key={entry.line} className="bookmarks-row">
                      <button
                        type="button"
                        className="outline-item bookmarks-item"
                        title={text || t('Zeile {line}', { line: entry.line })}
                        onClick={() => revealLine(entry.docId, entry.line)}
                      >
                        <span className="outline-line bookmarks-line">{entry.line}</span>
                        <span className="outline-label">
                          {text
                            ? text.length > MAX_TEXT
                              ? `${text.slice(0, MAX_TEXT - 1)}…`
                              : text
                            : t('(leere Zeile)')}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="bookmarks-remove"
                        title={t('Lesezeichen entfernen')}
                        onClick={() => removeBookmark(entry.docId, entry.line)}
                      >
                        <Icon name="close" size={11} title={t('Lesezeichen entfernen')} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
