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
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { openDialog, useUiState } from '../lib/commands';
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

/**
 * The search window: Notepad++'s find dialog, cut down to what is used.
 *
 * Three tabs — Suchen, Ersetzen, In Dateien — and on the first two only the
 * field, the buttons and the live count. Case, whole words, regular
 * expressions and "only in the selection" are behind **Erweitert**, because
 * nine out of ten searches are a word typed and Enter pressed. When one of
 * them is on while folded away, the button says so with a dot, so an option
 * left on from yesterday cannot silently change today's results.
 *
 * It floats in the top-right corner of the editor area instead of sitting in
 * the middle of the screen, and it is not modal: the text stays visible,
 * clickable and editable behind it, which is what makes stepping through
 * matches bearable.
 */
export function FindBar() {
  useLanguage();
  const ui = useUiState();
  const find = useFind();
  const queryField = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [advanced, setAdvanced] = useState(false);

  // The command in `lib/commands.ts` only flips the dialog slot; the window is
  // what turns that into an open search with the selected word already in it.
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
  const optionsOn = find.regex || find.caseSensitive || find.wholeWord || find.inSelection;

  return (
    <div
      className="findbar"
      role="dialog"
      aria-label={t('Suchen und ersetzen')}
      onKeyDown={onKeyDown}
    >
      <div className="findbar-head">
        <div className="findbar-tabs" role="tablist" aria-label={t('Suchen und ersetzen')}>
          <button
            type="button"
            role="tab"
            aria-selected={!find.replace}
            className="findbar-tab"
            onClick={() => openFind(false)}
          >
            {t('Suchen')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={find.replace}
            className="findbar-tab"
            onClick={() => openFind(true)}
          >
            {t('Ersetzen')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={false}
            className="findbar-tab"
            onClick={() => {
              closeFind();
              openDialog('projectSearch');
            }}
          >
            {t('In Dateien')}
          </button>
        </div>
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

      <label className="findbar-label">
        <span>{t('Suchen nach')}</span>
        <input
          ref={queryField}
          className="findbar-input"
          type="text"
          value={find.query}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={find.error !== null || undefined}
          aria-describedby={find.error ? errorId : undefined}
          onChange={(event) => updateFind({ query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            findNext(event.shiftKey);
          }}
        />
      </label>

      {find.replace && (
        <label className="findbar-label">
          <span>{t('Ersetzen durch')}</span>
          <input
            className="findbar-input"
            type="text"
            value={find.replacement}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => updateFind({ replacement: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (event.shiftKey) replaceAll();
              else replaceCurrent();
            }}
          />
        </label>
      )}

      <div className="findbar-status">
        <span className="findbar-count" role="status">
          {countLabel(find)}
          {find.wrapped && <span className="findbar-wrapped"> {t('am anderen Ende weiter')}</span>}
        </span>
      </div>

      {find.error && (
        <p className="findbar-error" id={errorId} role="alert">
          {find.error}
        </p>
      )}

      <div className="findbar-actions">
        <button
          type="button"
          className="findbar-button findbar-button-wide"
          disabled={nothingToFind}
          onClick={() => findNext(true)}
          title={t('Umschalt+Enter')}
        >
          {t('Zurück')}
        </button>
        <button
          type="button"
          className="findbar-button findbar-button-wide findbar-primary"
          disabled={nothingToFind}
          onClick={() => findNext(false)}
          title={t('Enter')}
        >
          {t('Weitersuchen')}
        </button>
        {find.replace && (
          <>
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
          </>
        )}
      </div>

      <button
        type="button"
        className="findbar-advanced-toggle"
        aria-expanded={advanced}
        onClick={() => setAdvanced((value) => !value)}
      >
        <Icon name={advanced ? 'chevronDown' : 'chevronRight'} size={12} />
        {t('Erweitert')}
        {!advanced && optionsOn ? (
          <span className="findbar-advanced-dot" title={t('Eine erweiterte Option ist an')} />
        ) : null}
      </button>

      {advanced && (
        <div className="findbar-advanced">
          <label>
            <input
              type="checkbox"
              checked={find.caseSensitive}
              onChange={() => updateFind({ caseSensitive: !find.caseSensitive })}
            />
            {t('Groß- und Kleinschreibung beachten')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={find.wholeWord}
              onChange={() => updateFind({ wholeWord: !find.wholeWord })}
            />
            {t('Nur ganze Wörter')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={find.regex}
              onChange={() => updateFind({ regex: !find.regex })}
            />
            {t('Regulärer Ausdruck')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={find.inSelection}
              onChange={() => updateFind({ inSelection: !find.inSelection })}
            />
            {t('Nur in der Auswahl')}
          </label>
        </div>
      )}
    </div>
  );
}
