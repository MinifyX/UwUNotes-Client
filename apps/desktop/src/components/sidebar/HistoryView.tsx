/**
 * The sidebar's Zeitreise view: the versions of the document in front of you.
 *
 * Always the active tab's history — switch tabs and the timeline follows —
 * grouped by day, newest first, each row with a relative time, why it was
 * taken, and how much it differs in size from the one before it. A click
 * opens the diff against the current text; everything else a version can do
 * is in the row's context menu and in the diff's footer.
 *
 * The list is fetched from Rust when the document changes and whenever a
 * version is written or deleted (`useHistoryRevision`), never while typing.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import type { HistoryVersion } from '../../lib/api';
import { documentsVersion, getMeta, subscribeDocuments } from '../../lib/documents';
import {
  clearHistory,
  closeHistoryDiff,
  copyVersion,
  dayLabel,
  dayOf,
  deleteVersion,
  listVersions,
  openHistoryDiff,
  openVersionAsTab,
  REASON_LABELS,
  relativeTime,
  restoreVersion,
  snapshotNow,
  useHistoryDiff,
  useHistoryRevision,
} from '../../lib/history';
import { formatBytes, locale, t, useLanguage } from '../../lib/i18n';
import { useSettings } from '../../lib/settings';
import { useWorkspace } from '../../lib/workspace';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { Icon } from '@uwusuite/design';
import { APP_ICONS } from '../../lib/icons';
import { HistoryDiff } from './HistoryDiff';
import '../../styles/history.css';

/** Relative times drift; this is how often they are worked out again. */
const CLOCK_MS = 30_000;

export function HistoryView() {
  const lang = useLanguage();
  const settings = useSettings();
  const workspace = useWorkspace();
  useSyncExternalStore(subscribeDocuments, documentsVersion);
  const revision = useHistoryRevision();
  const diff = useHistoryDiff();

  const docId = workspace.panes[workspace.activePane]?.active ?? null;
  const meta = docId ? getMeta(docId) : undefined;
  // A note saved for the first time keeps its id but changes its history, so
  // the path is part of what the list depends on.
  const owner = meta ? `${meta.id}\u0000${meta.path ?? ''}` : null;

  const [versions, setVersions] = useState<HistoryVersion[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [menu, setMenu] = useState<{ version: HistoryVersion; x: number; y: number } | null>(null);
  const shownOwner = useRef<string | null>(null);

  useEffect(() => {
    if (!docId) {
      setVersions([]);
      return;
    }
    // A different document starts from "loading"; a new version of the same
    // one keeps the old list on screen until the new one arrives.
    if (shownOwner.current !== owner) setVersions(null);
    shownOwner.current = owner;
    let live = true;
    void listVersions(docId).then((list) => {
      if (live) setVersions(list);
    });
    setNow(Date.now());
    return () => {
      live = false;
    };
  }, [docId, owner, revision]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    // The diff belongs to this view: leaving the view ends it, rather than
    // having it pop up again the next time the timeline is shown.
    return () => {
      window.clearInterval(timer);
      closeHistoryDiff();
    };
  }, []);

  useEffect(() => {
    if (diff && diff.docId !== docId) closeHistoryDiff();
  }, [diff, docId]);

  const groups: { day: number; entries: { version: HistoryVersion; older?: HistoryVersion }[] }[] =
    [];
  (versions ?? []).forEach((version, index) => {
    const day = dayOf(version.time);
    const last = groups[groups.length - 1];
    const entry = { version, older: versions?.[index + 1] };
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  });

  const menuItems = (version: HistoryVersion): ContextMenuItem[] =>
    docId
      ? [
          {
            id: 'compare',
            label: t('Mit aktuellem Text vergleichen'),
            run: () => openHistoryDiff(docId, version),
          },
          {
            id: 'restore',
            label: t('Diese Version wiederherstellen'),
            run: () => void restoreVersion(docId, version),
          },
          {
            id: 'tab',
            label: t('Als neuen Tab öffnen'),
            run: () => void openVersionAsTab(docId, version),
          },
          { id: 'copy', label: t('Kopieren'), run: () => void copyVersion(docId, version) },
          {
            id: 'delete',
            label: t('Version löschen'),
            danger: true,
            run: () => void deleteVersion(docId, version),
          },
        ]
      : [];

  const openMenu = (event: MouseEvent, version: HistoryVersion) => {
    event.preventDefault();
    setMenu({ version, x: event.clientX, y: event.clientY });
  };

  const count = versions?.length ?? 0;

  return (
    <div className="sidebar-view history-view">
      <header className="sidebar-header">
        <h2 className="sidebar-title">{t('Zeitreise')}</h2>
        <div className="sidebar-actions">
          <button
            type="button"
            className="sidebar-action"
            title={t('Version jetzt sichern')}
            disabled={!docId}
            onClick={() => docId && void snapshotNow(docId)}
          >
            <Icon icon={APP_ICONS.add} size="xs" label={t('Version jetzt sichern')} />
          </button>
          <button
            type="button"
            className="sidebar-action"
            title={t('Verlauf dieser Datei löschen…')}
            disabled={!docId || count === 0}
            onClick={() => docId && void clearHistory(docId)}
          >
            <Icon icon={APP_ICONS.delete} size="xs" label={t('Verlauf dieser Datei löschen…')} />
          </button>
        </div>
      </header>

      <div className="history-body">
        {!settings.history && (
          <p className="history-note">
            {t('Die Zeitreise ist ausgeschaltet. Vorhandene Versionen bleiben hier sichtbar.')}
          </p>
        )}
        {!meta ? (
          <p className="history-empty">{t('Keine Datei geöffnet')}</p>
        ) : versions === null ? null : count === 0 ? (
          <p className="history-empty">
            {settings.tone === 'playful'
              ? t('Noch keine Versionen. Die erste entsteht beim Speichern (・ω・)')
              : t('Noch keine Versionen. Die erste entsteht beim Speichern.')}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.day} className="history-day">
              <h3 className="history-day-title">{dayLabel(group.day, now, lang)}</h3>
              <ol className="history-list">
                {group.entries.map(({ version, older }) => {
                  const selected = diff?.docId === docId && diff?.version.id === version.id;
                  return (
                    <li key={version.id}>
                      <button
                        type="button"
                        className="history-item"
                        aria-current={selected ? 'true' : undefined}
                        title={new Date(version.time).toLocaleString(locale(lang))}
                        onClick={() => docId && openHistoryDiff(docId, version)}
                        onContextMenu={(event) => openMenu(event, version)}
                      >
                        <span className="history-item-time">
                          {relativeTime(version.time, now, lang)}
                        </span>
                        <span className={`history-badge history-badge-${version.reason}`}>
                          {t(REASON_LABELS[version.reason])}
                        </span>
                        <span className="history-item-meta">
                          {formatBytes(version.size, lang)}
                          <LineDelta version={version} older={older} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
      </div>

      <footer className="sidebar-footer">
        <span className="history-footer" title={meta?.path ?? meta?.name}>
          {meta
            ? count === 1
              ? t('{name} · 1 Version', { name: meta.name })
              : t('{name} · {count} Versionen', { name: meta.name, count })
            : ''}
        </span>
      </footer>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={t('Version')}
          items={menuItems(menu.version)}
          onClose={() => setMenu(null)}
        />
      )}
      {diff && diff.docId === docId && <HistoryDiff target={diff} versions={versions ?? []} />}
    </div>
  );
}

/**
 * Lines gained or lost against the version before: mint for more, red for
 * fewer. The oldest version has nothing before it and shows its length.
 */
function LineDelta({ version, older }: { version: HistoryVersion; older?: HistoryVersion }) {
  if (!older) {
    return (
      <span className="history-delta">
        {version.lines === 1
          ? t('1 Zeile')
          : t('{count} Zeilen', { count: version.lines.toLocaleString(locale()) })}
      </span>
    );
  }
  const delta = version.lines - older.lines;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  const text =
    Math.abs(delta) === 1
      ? t('{delta} Zeile', { delta: `${sign}1` })
      : t('{delta} Zeilen', { delta: `${sign}${Math.abs(delta).toLocaleString(locale())}` });
  return (
    <span
      className="history-delta"
      data-trend={delta > 0 ? 'up' : delta < 0 ? 'down' : 'same'}
      title={t('Gegenüber der Version davor')}
    >
      {text}
    </span>
  );
}
