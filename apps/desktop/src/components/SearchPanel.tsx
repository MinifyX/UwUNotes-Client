/**
 * Find in files, as a side panel.
 *
 * A panel and not a dialog, for one reason: the search streams. Rows appear
 * while Rust is still walking the tree, and the user is meant to be able to
 * click one, read the file, come back and click the next without the search
 * having been thrown away in between. A modal would make all of that
 * impossible, and the counts at the top would be a lie by the time they were
 * read.
 *
 * Everything the panel says about completeness it says out loud: how many
 * files were skipped, whether the walk stopped at the limit, and whether it
 * searched the open buffers because there is no folder. `lib/project-search.ts`
 * keeps those numbers honest; this file only shows them, and writes no styles.
 */

import {
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { SearchMatch } from '../lib/api';
import { useUiState } from '../lib/commands';
import { t, useLanguage } from '../lib/i18n';
import {
  closeProjectSearch,
  openMatch,
  openProjectSearch,
  parentOf,
  replaceAllInFiles,
  runProjectSearch,
  stopProjectSearch,
  toggleFileCollapsed,
  updateProjectSearch,
  useProjectSearch,
  type FileResult,
} from '../lib/project-search';
import { focusActiveView } from '../lib/views';
import { useWorkspace } from '../lib/workspace';
import { NyuScene } from './nyu/scenes';
import { Icon } from './Icon';
import { SearchToggle } from './FindBar';

/** The line, with the part that matched marked up. */
function MatchPreview({ match }: { match: SearchMatch }) {
  // The offsets arrive as UTF-16 code units — the units a JavaScript string is
  // measured in — so they slice the preview directly. Recomputing them here
  // would be a second chance to get astral characters wrong.
  return (
    <span className="searchpanel-match-preview">
      {match.preview.slice(0, match.start)}
      <mark className="searchpanel-match-hit">{match.preview.slice(match.start, match.end)}</mark>
      {match.preview.slice(match.end)}
    </span>
  );
}

function FileRow({
  result,
  collapsed,
  listId,
}: {
  result: FileResult;
  collapsed: boolean;
  listId: string;
}) {
  return (
    <li className="searchpanel-file">
      <button
        type="button"
        className="searchpanel-file-row"
        aria-expanded={!collapsed}
        aria-controls={listId}
        onClick={() => toggleFileCollapsed(result.id)}
      >
        <Icon
          name={collapsed ? 'chevronRight' : 'chevronDown'}
          className="searchpanel-file-twisty"
        />
        <span className="searchpanel-file-name">{result.name}</span>
        <span className="searchpanel-file-folder">
          {result.path ? parentOf(result.path) : t('Nicht gespeichert')}
        </span>
        <span className="searchpanel-file-count">{result.matches.length}</span>
      </button>
      {!collapsed && (
        <ul className="searchpanel-matches" id={listId}>
          {result.matches.map((match, index) => (
            <li key={`${match.line}-${match.start}-${index}`}>
              <button
                type="button"
                className="searchpanel-match"
                onClick={() => {
                  void openMatch(result, match);
                }}
              >
                <span className="searchpanel-match-line">{match.line}</span>
                <MatchPreview match={match} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function SearchPanel() {
  useLanguage();
  const ui = useUiState();
  const search = useProjectSearch();
  const workspace = useWorkspace();
  const queryField = useRef<HTMLInputElement>(null);
  const baseId = useId();

  // The command flips the `projectSearch` slot; the store takes that as "show
  // the panel" and gives the slot straight back, so the panel outlives the next
  // thing that wants to be a dialog.
  useEffect(() => {
    if (ui.dialog !== 'projectSearch') return;
    openProjectSearch();
    queryField.current?.focus();
    queryField.current?.select();
  }, [ui.dialog]);

  const open = search.open;
  useEffect(() => {
    if (!open) return;
    queryField.current?.focus();
    queryField.current?.select();
  }, [open]);

  if (!search.open) return null;

  const hasFolder = workspace.folder !== null;

  const dismiss = () => {
    closeProjectSearch();
    focusActiveView();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runProjectSearch();
  };

  const nothingFound =
    search.searched && !search.running && search.results.length === 0 && search.error === null;

  return (
    <aside className="searchpanel" aria-label={t('In Dateien suchen')} onKeyDown={onKeyDown}>
      <header className="searchpanel-header">
        <h2 className="searchpanel-title">{t('In Dateien suchen')}</h2>
        <button
          type="button"
          className="searchpanel-close"
          aria-label={t('Suche schließen')}
          title={t('Suche schließen')}
          onClick={dismiss}
        >
          <Icon name="close" />
        </button>
      </header>

      <form className="searchpanel-form" onSubmit={onSubmit}>
        <div className="searchpanel-field">
          <input
            ref={queryField}
            className="searchpanel-input"
            type="text"
            value={search.query}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('Suchen nach')}
            aria-invalid={search.error !== null || undefined}
            placeholder={t('Suchen')}
            onChange={(event) => updateProjectSearch({ query: event.target.value })}
          />
          <div className="searchpanel-toggles">
            <SearchToggle
              className="searchpanel-toggle"
              glyph=".*"
              label={t('Regulärer Ausdruck')}
              pressed={search.regex}
              onToggle={() => updateProjectSearch({ regex: !search.regex })}
            />
            <SearchToggle
              className="searchpanel-toggle"
              glyph="Aa"
              label={t('Groß- und Kleinschreibung beachten')}
              pressed={search.caseSensitive}
              onToggle={() => updateProjectSearch({ caseSensitive: !search.caseSensitive })}
            />
            <SearchToggle
              className="searchpanel-toggle"
              glyph="ab"
              label={t('Nur ganze Wörter')}
              pressed={search.wholeWord}
              onToggle={() => updateProjectSearch({ wholeWord: !search.wholeWord })}
            />
            <SearchToggle
              className="searchpanel-toggle"
              glyph="·"
              label={t('Versteckte Dateien einbeziehen')}
              pressed={search.includeHidden}
              disabled={!hasFolder}
              onToggle={() => updateProjectSearch({ includeHidden: !search.includeHidden })}
            />
          </div>
        </div>

        <div className="searchpanel-globs">
          <label className="searchpanel-glob">
            <span className="searchpanel-glob-label">{t('Einschließen')}</span>
            <input
              className="searchpanel-input"
              type="text"
              value={search.include}
              spellCheck={false}
              autoComplete="off"
              disabled={!hasFolder}
              placeholder="*.ts, *.rs"
              onChange={(event) => updateProjectSearch({ include: event.target.value })}
            />
          </label>
          <label className="searchpanel-glob">
            <span className="searchpanel-glob-label">{t('Ausschließen')}</span>
            <input
              className="searchpanel-input"
              type="text"
              value={search.exclude}
              spellCheck={false}
              autoComplete="off"
              disabled={!hasFolder}
              placeholder="dist, *.min.js"
              onChange={(event) => updateProjectSearch({ exclude: event.target.value })}
            />
          </label>
        </div>

        <label className="searchpanel-option">
          <input
            type="checkbox"
            checked={search.respectIgnoreFiles}
            disabled={!hasFolder}
            onChange={(event) => updateProjectSearch({ respectIgnoreFiles: event.target.checked })}
          />
          <span>{t('.gitignore beachten')}</span>
        </label>

        <div className="searchpanel-actions">
          <button type="submit" className="searchpanel-button" disabled={search.query.length === 0}>
            {t('Suchen')}
          </button>
          {search.running && (
            <button type="button" className="searchpanel-button" onClick={stopProjectSearch}>
              {t('Anhalten')}
            </button>
          )}
        </div>

        <div className="searchpanel-replace">
          <input
            className="searchpanel-input"
            type="text"
            value={search.replacement}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('Ersetzen durch')}
            placeholder={t('Ersetzen durch')}
            onChange={(event) => updateProjectSearch({ replacement: event.target.value })}
          />
          <button
            type="button"
            className="searchpanel-button"
            disabled={search.inMemory || search.running || search.results.length === 0}
            onClick={() => {
              void replaceAllInFiles();
            }}
          >
            {t('In allen Dateien ersetzen')}
          </button>
        </div>
      </form>

      <div className="searchpanel-status" role="status">
        {search.running ? (
          <p className="searchpanel-status-line">
            {t('Suche läuft — {matches} Treffer in {files} Dateien', {
              matches: search.matches,
              files: search.files,
            })}
          </p>
        ) : (
          search.searched && (
            <p className="searchpanel-status-line">
              {t('{matches} Treffer in {files} Dateien', {
                matches: search.matches,
                files: search.files,
              })}
            </p>
          )
        )}
        {search.truncated && (
          <p className="searchpanel-status-warn">
            {t('Abgebrochen bei {matches} Treffern — es gibt mehr.', { matches: search.matches })}
          </p>
        )}
        {search.skipped > 0 && (
          <p className="searchpanel-status-warn">
            {t('{skipped} Dateien übersprungen (zu groß oder nicht lesbar).', {
              skipped: search.skipped,
            })}
          </p>
        )}
        {search.inMemory && (
          <p className="searchpanel-status-warn">
            {t('Kein Ordner geöffnet — durchsucht werden die offenen Dokumente.')}
          </p>
        )}
      </div>

      {search.error && (
        <p className="searchpanel-error" role="alert">
          {search.error}
        </p>
      )}

      {nothingFound ? (
        <div className="searchpanel-empty">
          <NyuScene name="noResults" className="searchpanel-empty-scene" />
          <p className="searchpanel-empty-text">{t('Nichts gefunden.')}</p>
        </div>
      ) : (
        <ul className="searchpanel-results">
          {search.results.map((result, index) => (
            <FileRow
              key={result.id}
              result={result}
              collapsed={search.collapsed.has(result.id)}
              listId={`${baseId}-${index}`}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}
