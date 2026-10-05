/**
 * The sidebar's trash view: everything closed tabs had not saved, newest
 * first, with room to look at it before deciding.
 *
 * The notebook view lists the trash too, as the second half of "my notes".
 * This one is the trash on its own, with what that view has no room for: how
 * big an entry is, when exactly it was thrown away, the whole text on a click,
 * and emptying it — asked here, in the panel, rather than in a dialog over the
 * text, because the list the question is about should stay in sight.
 *
 * The entries and every action on them are `lib/notebook.ts`'s; this file only
 * draws them.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, locale, t, useLanguage } from '../../lib/i18n';
import {
  deleteTrashed,
  emptyTrashNow,
  peekTrashed,
  refreshTrash,
  restoreTrashed,
  useTrash,
} from '../../lib/notebook';
import { matchesQuery, previewLine, relativeAge } from '../../lib/notebook-list';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { Icon } from '../Icon';
import { NyuScene } from '../nyu/scenes';
import '../../styles/notes.css';

/** Relative dates are redrawn this often, so "vor 1 Minute" does not stay forever. */
const CLOCK_MS = 60_000;

/** The whole text of the entry that is open, once it has been read. */
type Peek = { id: string; text: string | null };

export function TrashView() {
  const language = useLanguage();
  const trash = useTrash();
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void refreshTrash();
    const clock = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(clock);
  }, []);

  // The safe answer has the keyboard, so Enter or Escape right away is "no".
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  // A trash that emptied some other way has nothing left to ask about.
  useEffect(() => {
    if (trash.length === 0) setConfirming(false);
  }, [trash.length]);

  // Read the whole text of the entry that was opened; the listing only has
  // the first few thousand characters.
  useEffect(() => {
    if (!open) return;
    let current = true;
    void peekTrashed(open).then((text) => {
      if (current) setPeek({ id: open, text });
    });
    return () => {
      current = false;
    };
  }, [open]);

  const shown = useMemo(
    () => trash.filter((entry) => matchesQuery({ name: entry.name, text: entry.excerpt }, query)),
    [trash, query],
  );

  const ages = useMemo(
    () => new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }),
    [language],
  );
  const dates = useMemo(
    () => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }),
    [language],
  );
  const age = (then: number) => {
    const { value, unit } = relativeAge(then, now);
    return ages.format(value, unit);
  };

  const total = trash.reduce((sum, entry) => sum + entry.bytes, 0);
  const toggle = (id: string) => setOpen((current) => (current === id ? null : id));

  const restore = (id: string) => {
    if (open === id) setOpen(null);
    void restoreTrashed(id);
  };
  const remove = (id: string) => {
    if (open === id) setOpen(null);
    void deleteTrashed(id);
  };

  const menuItems = (id: string): ContextMenuItem[] => [
    {
      id: 'open',
      label: open === id ? t('Zuklappen') : t('Öffnen'),
      run: () => toggle(id),
    },
    { id: 'restore', label: t('Wiederherstellen'), run: () => restore(id) },
    { id: 'delete', label: t('Endgültig löschen'), danger: true, run: () => remove(id) },
  ];

  return (
    <div className="sidebar-view trashview">
      <header className="sidebar-header">
        <h2 className="sidebar-title">{t('Papierkorb')}</h2>
        <div className="sidebar-actions">
          <button
            type="button"
            className="sidebar-action"
            title={t('Papierkorb leeren…')}
            disabled={trash.length === 0 || confirming}
            onClick={() => setConfirming(true)}
          >
            <Icon name="trash" size={14} title={t('Papierkorb leeren…')} />
          </button>
        </div>
      </header>

      <div className="notebook-body">
        {confirming ? (
          <div
            className="trash-confirm"
            role="alertdialog"
            aria-labelledby="trash-confirm-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setConfirming(false);
              }
            }}
          >
            <p className="trash-confirm-title" id="trash-confirm-title">
              {t('Papierkorb leeren?')}
            </p>
            <p className="trash-confirm-text">
              {trash.length === 1
                ? t('Eine Notiz wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.')
                : t(
                    '{count} Notizen werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.',
                    { count: trash.length },
                  )}
            </p>
            <div className="trash-confirm-actions">
              <button
                type="button"
                className="trash-confirm-danger"
                onClick={() => {
                  setConfirming(false);
                  setOpen(null);
                  void emptyTrashNow();
                }}
              >
                {t('Leeren')}
              </button>
              <button type="button" ref={cancelRef} onClick={() => setConfirming(false)}>
                {t('Abbrechen')}
              </button>
            </div>
          </div>
        ) : null}

        {trash.length === 0 ? (
          <div className="notebook-empty">
            <NyuScene name="empty" className="sidebar-empty-scene" />
            <p className="sidebar-empty-text">
              {t(
                'Der Papierkorb ist leer. Was du ungespeichert schließt, landet hier und bleibt 30 Tage.',
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="notebook-search">
              <Icon name="search" size={13} className="notebook-search-icon" />
              <input
                type="search"
                className="notebook-search-input"
                placeholder={t('Papierkorb durchsuchen')}
                aria-label={t('Papierkorb durchsuchen')}
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

            <p className="trash-summary">
              {trash.length === 1
                ? t('1 Notiz · {size}', { size: formatBytes(total) })
                : t('{count} Notizen · {size}', { count: trash.length, size: formatBytes(total) })}
              {' · '}
              {t('Nach 30 Tagen gelöscht')}
            </p>

            {shown.length === 0 ? (
              <p className="notebook-none">{t('Nichts gefunden.')}</p>
            ) : (
              <ul className="notebook-list">
                {shown.map((entry) => {
                  const isOpen = open === entry.id;
                  const text = peek?.id === entry.id ? peek.text : undefined;
                  return (
                    <li key={entry.id} className="trash-entry" data-open={isOpen || undefined}>
                      <button
                        type="button"
                        className="notebook-item trash-entry-main"
                        aria-expanded={isOpen}
                        title={entry.path ?? entry.name}
                        onClick={() => toggle(entry.id)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setMenu({ x: event.clientX, y: event.clientY, id: entry.id });
                        }}
                      >
                        <span className="notebook-item-name">{entry.name}</span>
                        {isOpen ? null : (
                          <span className="notebook-item-preview">
                            {previewLine(entry.excerpt) || t('(leer)')}
                          </span>
                        )}
                        <span
                          className="notebook-item-meta"
                          title={dates.format(new Date(entry.trashedAt))}
                        >
                          {age(entry.trashedAt)} · {formatBytes(entry.bytes)}
                        </span>
                      </button>
                      <div className="trash-entry-tools">
                        <button
                          type="button"
                          className="trash-entry-tool"
                          title={t('Wiederherstellen')}
                          onClick={() => restore(entry.id)}
                        >
                          <Icon name="restore" size={13} title={t('Wiederherstellen')} />
                        </button>
                        <button
                          type="button"
                          className="trash-entry-tool trash-entry-delete"
                          title={t('Endgültig löschen')}
                          onClick={() => remove(entry.id)}
                        >
                          <Icon name="trash" size={13} title={t('Endgültig löschen')} />
                        </button>
                      </div>
                      {isOpen ? (
                        <div className="trash-entry-body">
                          {entry.path ? <p className="trash-entry-path">{entry.path}</p> : null}
                          <pre className="trash-entry-text" tabIndex={0}>
                            {text === undefined
                              ? entry.excerpt
                              : text === null
                                ? t('Diese Notiz ist nicht mehr im Papierkorb.')
                                : text}
                          </pre>
                          <div className="trash-entry-actions">
                            <button
                              type="button"
                              className="trash-entry-restore"
                              onClick={() => restore(entry.id)}
                            >
                              <Icon name="restore" size={13} />
                              {t('Wiederherstellen')}
                            </button>
                            <button
                              type="button"
                              className="trash-entry-remove"
                              title={t('Endgültig löschen')}
                              onClick={() => remove(entry.id)}
                            >
                              <Icon name="trash" size={13} title={t('Endgültig löschen')} />
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
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
