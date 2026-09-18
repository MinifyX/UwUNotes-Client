/**
 * Ctrl+G: a line number, and optionally a column after a colon.
 *
 * `42`, `42:8` and `42,8` all work, because the three of them turn up in
 * compiler output, stack traces and linter messages, and pasting one of those
 * straight in is the entire point of this box.
 *
 * Out-of-range input is clamped rather than refused: somebody who types `9999`
 * into a 300-line file means the end of the file, and answering that with a red
 * border helps nobody.
 */

import { useState } from 'react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { closeDialog, useUiState } from '../lib/commands';
import { t } from '../lib/i18n';
import { activeView } from '../lib/views';
import { Modal } from './Modal';

type Target = { line: number; column: number };

/** `42`, `42:8`, `42,8` — and nothing else, because anything else is a typo. */
function parseTarget(input: string): Target | null {
  const match = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(input);
  if (!match) return null;
  const line = Number(match[1]);
  const column = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isFinite(line) || line < 1) return null;
  return { line, column: Number.isFinite(column) && column >= 1 ? column : 1 };
}

export function GoToLine() {
  const { dialog } = useUiState();
  if (dialog !== 'gotoLine') return null;
  return <GoToLineBody />;
}

function GoToLineBody() {
  const [value, setValue] = useState('');
  const view = activeView();
  const lines = view?.state.doc.lines ?? 1;
  const target = parseTarget(value);
  const typedSomething = value.trim().length > 0;

  const jump = () => {
    if (!view || !target) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(1, target.line), doc.lines));
    const at = Math.min(line.from + target.column - 1, line.to);
    view.dispatch({
      selection: EditorSelection.cursor(at),
      // Centred rather than merely visible: a jump that lands the line on the
      // last pixel of the viewport looks like it went to the wrong place.
      effects: EditorView.scrollIntoView(at, { y: 'center' }),
    });
    // `closeDialog()` puts the keyboard back into the editor on its way out.
    closeDialog();
  };

  return (
    <Modal title={t('Gehe zu Zeile')} onClose={closeDialog}>
      <form
        className="gotoline"
        onSubmit={(event) => {
          event.preventDefault();
          jump();
        }}
      >
        <label className="gotoline-label" htmlFor="gotoline-input">
          {t('Zeile')}
        </label>
        <input
          id="gotoline-input"
          className="gotoline-input"
          value={value}
          autoFocus
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          aria-describedby="gotoline-hint"
          aria-invalid={typedSomething && !target}
          placeholder="42:8"
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="gotoline-hint" id="gotoline-hint">
          {typedSomething && !target
            ? t('Nur eine Zahl, oder Zeile:Spalte.')
            : t('1 bis {max}. Eine Spalte kann nach einem Doppelpunkt folgen.', { max: lines })}
        </p>
        <div className="gotoline-actions">
          <button type="button" className="gotoline-cancel" onClick={closeDialog}>
            {t('Abbrechen')}
          </button>
          <button type="submit" className="gotoline-submit" disabled={!target || !view}>
            {t('Springen')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
