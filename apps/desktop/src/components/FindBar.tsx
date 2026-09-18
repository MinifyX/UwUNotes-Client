/**
 * The find bar: one strip above the editor, never a window over it.
 *
 * A modal find dialog covers the very text it is searching, which is why every
 * editor that ever shipped one eventually replaced it with a bar. Escape closes
 * it and hands the keyboard back to the editor; nothing else in here traps
 * focus, because the user is meant to be able to click into their file mid-search
 * and keep the query where they left it.
 *
 * The matching, the counting and the caret live in `lib/find.ts`. This file
 * renders that state and sends clicks back to it, and it writes no styles: the
 * class names are the contract with the stylesheet.
 */

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useUiState } from '../lib/commands';
import {
  closeFind,
  findNext,
  openFind,
  replaceAll,
  replaceCurrent,
  updateFind,
  useFind,
  type FindState,
} from '../lib/find';
import { t, useLanguage } from '../lib/i18n';
import { focusActiveView } from '../lib/views';
import { Icon } from './Icon';

/**
 * One option toggle: a short glyph, an accessible name, and `aria-pressed` so
 * the state is audible as well as visible.
 *
 * `components/SearchPanel.tsx` uses it too, with its own class family — the two
 * places offer the same four options and should not disagree about what they
 * are called.
 */
export function SearchToggle({
  className,
  glyph,
  label,
  pressed,
  disabled,
  onToggle,
}: {
  className: string;
  glyph: ReactNode;
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={pressed ? `${className} ${className}-on` : className}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/** `3 von 17`, or an honest hedge when the count stopped at the cap. */
function countLabel(find: FindState): string {
  if (!find.query || find.error) return '';
  if (find.matches === 0) return t('Keine Treffer');
  if (find.current > 0) {
    return find.capped
      ? t('{index} von über {total}', { index: find.current, total: find.matches })
      : t('{index} von {total}', { index: find.current, total: find.matches });
  }
  return find.capped
    ? t('über {total} Treffer', { total: find.matches })
    : t('{total} Treffer', { total: find.matches });
}

export function FindBar() {
  useLanguage();
  const ui = useUiState();
  const find = useFind();
  const queryField = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // The command in `lib/commands.ts` only flips the dialog slot; the bar is what
  // turns that into an open find bar with the selected word already in it.
  useEffect(() => {
    if (ui.dialog === 'find') openFind(false);
    else if (ui.dialog === 'replace') openFind(true);
  }, [ui.dialog]);

  const open = find.open;
  const replaceMode = find.replace;
  useEffect(() => {
    if (!open) return;
    const field = queryField.current;
    field?.focus();
    // Selected rather than merely focused: the usual next move is to type a
    // different query, not to edit the old one by hand.
    field?.select();
  }, [open, replaceMode]);

  if (!find.open) return null;

  const dismiss = () => {
    closeFind();
    focusActiveView();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  };

  const nothingToFind = find.query.length === 0 || find.error !== null;

  return (
    <div
      className="findbar"
      role="search"
      aria-label={t('Suchen und ersetzen')}
      onKeyDown={onKeyDown}
    >
      <div className="findbar-row">
        <div className="findbar-field">
          <input
            ref={queryField}
            className="findbar-input"
            type="text"
            value={find.query}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('Suchen nach')}
            aria-invalid={find.error !== null || undefined}
            aria-describedby={find.error ? errorId : undefined}
            placeholder={t('Suchen')}
            onChange={(event) => updateFind({ query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              findNext(event.shiftKey);
            }}
          />
          <div className="findbar-toggles">
            <SearchToggle
              className="findbar-toggle"
              glyph=".*"
              label={t('Regulärer Ausdruck')}
              pressed={find.regex}
              onToggle={() => updateFind({ regex: !find.regex })}
            />
            <SearchToggle
              className="findbar-toggle"
              glyph="Aa"
              label={t('Groß- und Kleinschreibung beachten')}
              pressed={find.caseSensitive}
              onToggle={() => updateFind({ caseSensitive: !find.caseSensitive })}
            />
            <SearchToggle
              className="findbar-toggle"
              glyph="ab"
              label={t('Nur ganze Wörter')}
              pressed={find.wholeWord}
              onToggle={() => updateFind({ wholeWord: !find.wholeWord })}
            />
            <SearchToggle
              className="findbar-toggle"
              glyph="[ ]"
              label={t('Nur in der Auswahl')}
              pressed={find.inSelection}
              onToggle={() => updateFind({ inSelection: !find.inSelection })}
            />
          </div>
        </div>

        <span className="findbar-count" role="status">
          {countLabel(find)}
          {find.wrapped && <span className="findbar-wrapped"> {t('am anderen Ende weiter')}</span>}
        </span>

        <div className="findbar-actions">
          <button
            type="button"
            className="findbar-button"
            aria-label={t('Vorheriger Treffer')}
            title={t('Vorheriger Treffer')}
            disabled={nothingToFind}
            onClick={() => findNext(true)}
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            type="button"
            className="findbar-button"
            aria-label={t('Nächster Treffer')}
            title={t('Nächster Treffer')}
            disabled={nothingToFind}
            onClick={() => findNext(false)}
          >
            <span aria-hidden="true">↓</span>
          </button>
          <button
            type="button"
            className="findbar-button findbar-close"
            aria-label={t('Suchleiste schließen')}
            title={t('Suchleiste schließen')}
            onClick={dismiss}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>

      {find.replace && (
        <div className="findbar-row">
          <div className="findbar-field">
            <input
              className="findbar-input"
              type="text"
              value={find.replacement}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('Ersetzen durch')}
              placeholder={t('Ersetzen durch')}
              onChange={(event) => updateFind({ replacement: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (event.shiftKey) replaceAll();
                else replaceCurrent();
              }}
            />
          </div>
          <div className="findbar-actions">
            <button
              type="button"
              className="findbar-button findbar-button-wide"
              disabled={nothingToFind}
              onClick={replaceCurrent}
            >
              {t('Ersetzen')}
            </button>
            <button
              type="button"
              className="findbar-button findbar-button-wide"
              disabled={nothingToFind || find.matches === 0}
              onClick={replaceAll}
            >
              {t('Alle ersetzen')}
            </button>
          </div>
        </div>
      )}

      {find.error && (
        <p className="findbar-error" id={errorId} role="alert">
          {find.error}
        </p>
      )}
    </div>
  );
}
