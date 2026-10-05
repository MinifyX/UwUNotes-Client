/**
 * The sidebar's notebook view: the notes that exist nowhere but in this app.
 *
 * Two lists under one search field. On top, the open tabs with text that is
 * not in any file yet — untitled notes and files with unsaved changes — where
 * a click goes to the tab. Below, the note trash: what closed tabs had not
 * saved, newest first, where a click brings the note back as a tab.
 *
 * Deleting one entry for good is a button and a menu item without a question;
 * it is one note the user is looking straight at. Emptying the whole trash
 * asks first, in plain words (`emptyTrashAsked` in `lib/notebook.ts`).
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { allDocs, documentsVersion, subscribeDocuments, type DocId } from '../../lib/documents';
import { newFile } from '../../lib/files';
import { locale, t, useLanguage } from '../../lib/i18n';
import {
  deleteTrashed,
  emptyTrashAsked,
  refreshTrash,
  restoreTrashed,
  useTrash,
} from '../../lib/notebook';
import { matchesQuery, previewLine, relativeAge } from '../../lib/notebook-list';
import { focusActiveView } from '../../lib/views';
import { activateDoc, useWorkspace } from '../../lib/workspace';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { Icon } from '@uwusuite/design';
import { APP_ICONS } from '../../lib/icons';
import { NyuScene } from '../nyu/scenes';
import '../../styles/notes.css';

/** Relative dates are redrawn this often, so "vor 1 Minute" does not stay forever. */
const CLOCK_MS = 60_000;

export function NotebookView() {
  const language = useLanguage();
  const version = useSyncExternalStore(subscribeDocuments, documentsVersion);
  const workspace = useWorkspace();
  const trash = useTrash();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Rust sweeps the trash on every write, so opening the view is a good
  // moment to look again.
  useEffect(() => {
    void refreshTrash();
    const clock = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(clock);
  }, []);

  const activeDoc = workspace.panes[workspace.activePane]?.active ?? null;

  // `version` is a dependency without being read: it changes whenever a name
  // or a dirty flag does, which is everything this list shows.
  const notes = useMemo(
    () =>
      allDocs()
        .filter((doc) => doc.meta.path === null || doc.meta.dirty)
        .filter((doc) =>
          // The text is only read when there is a query to look for.
          query.trim()
            ? matchesQuery({ name: doc.meta.name, text: doc.state.doc.toString() }, query)
            : true,
        )
        .map((doc) => doc.meta),
    [version, query],
  );

  const trashed = useMemo(
    () => trash.filter((entry) => matchesQuery({ name: entry.name, text: entry.excerpt }, query)),
    [trash, query],
  );

  const ages = useMemo(
    () => new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }),
    [language],
  );
  const age = (then: number) => {
    const { value, unit } = relativeAge(then, now);
    return ages.format(value, unit);
  };

  const showNote = (id: DocId) => {
    activateDoc(id);
    focusActiveView();
  };

  const menuItems = (id: string): ContextMenuItem[] => [
    { id: 'restore', label: t('Wiederherstellen'), run: () => void restoreTrashed(id) },
    {
      id: 'delete',
      label: t('Endgültig löschen'),
      danger: true,
      run: () => void deleteTrashed(id),
    },
  ];

  const searching = query.trim() !== '';
  const nothingAtAll = !searching && notes.length === 0 && trash.length === 0;

  return (
    <div className="sidebar-view notebook">
      <header className="sidebar-header">
        <h2 className="sidebar-title">{t('Notizbuch')}</h2>
        <div className="sidebar-actions">
          <button
            type="button"
            className="sidebar-action"
            title={t('Neue Notiz')}
            onClick={newFile}
          >
            <Icon icon={APP_ICONS.add} size="xs" label={t('Neue Notiz')} />
          </button>
          <button
            type="button"
            className="sidebar-action"
            title={t('Papierkorb leeren…')}
            disabled={trash.length === 0}
            onClick={() => void emptyTrashAsked()}
          >
            <Icon icon={APP_ICONS.delete} size="xs" label={t('Papierkorb leeren…')} />
          </button>
        </div>
      </header>

      <div className="notebook-body">
        <div className="notebook-search">
          <Icon icon={APP_ICONS.search} size="xs" className="notebook-search-icon" />
          <input
            type="search"
            className="notebook-search-input"
            placeholder={t('Notizen durchsuchen')}
            aria-label={t('Notizen durchsuchen')}
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation();
                setQuery('');
              }
            }}
          />
        </div>

        {nothingAtAll ? (
          <div className="notebook-empty">
            <NyuScene name="empty" className="sidebar-empty-scene" />
            <p className="sidebar-empty-text">
              {t('Noch keine Notizen. Was du ungespeichert schließt, landet hier im Papierkorb.')}
            </p>
            <button type="button" className="sidebar-open-button" onClick={newFile}>
              {t('Neue Notiz')}
            </button>
          </div>
        ) : (
          <>
            <section className="notebook-section" aria-label={t('Offene Notizen')}>
              <h3 className="notebook-section-title">{t('Offene Notizen')}</h3>
              {notes.length === 0 ? (
                <p className="notebook-none">
                  {searching ? t('Nichts gefunden.') : t('Alles gespeichert.')}
                </p>
              ) : (
                <ul className="notebook-list">
                  {notes.map((meta) => (
                    <li key={meta.id}>
                      <button
                        type="button"
                        className="notebook-item"
                        aria-current={meta.id === activeDoc ? 'true' : undefined}
                        title={meta.path ?? meta.name}
                        onClick={() => showNote(meta.id)}
                      >
                        <span className="notebook-item-name">
                          {meta.dirty ? (
                            <span className="notebook-dirty" aria-label={t('ungespeichert')} />
                          ) : null}
                          {meta.name}
                        </span>
                        <span className="notebook-item-meta">
                          {meta.path ?? t('Noch in keiner Datei')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="notebook-section" aria-label={t('Papierkorb')}>
              <h3 className="notebook-section-title">{t('Papierkorb')}</h3>
              {trashed.length === 0 ? (
                <p className="notebook-none">
                  {searching ? t('Nichts gefunden.') : t('Der Papierkorb ist leer.')}
                </p>
              ) : (
                <ul className="notebook-list">
                  {trashed.map((entry) => (
                    <li key={entry.id} className="notebook-row">
                      <button
                        type="button"
                        className="notebook-item"
                        title={t('Wiederherstellen')}
                        onClick={() => void restoreTrashed(entry.id)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setMenu({ x: event.clientX, y: event.clientY, id: entry.id });
                        }}
                      >
                        <span className="notebook-item-name">{entry.name}</span>
                        <span className="notebook-item-preview">{previewLine(entry.excerpt)}</span>
                        <span className="notebook-item-meta">{age(entry.trashedAt)}</span>
                      </button>
                      <button
                        type="button"
                        className="notebook-delete"
                        title={t('Endgültig löschen')}
                        onClick={() => void deleteTrashed(entry.id)}
                      >
                        <Icon icon={APP_ICONS.delete} size="xs" label={t('Endgültig löschen')} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={t('Papierkorb')}
          items={menuItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
