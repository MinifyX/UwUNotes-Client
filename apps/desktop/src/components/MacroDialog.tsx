/**
 * The macro manager: what has been recorded, what was saved, and the four
 * things anyone ever wants to do with a macro — play it, play it a number of
 * times, give it a name, give it a key.
 *
 * It is the only place with a text field for a macro, which is why the
 * "save the recording" and "rename" paths end up here rather than in a prompt:
 * `lib/prompt.ts` asks questions with buttons, and a name is not a button.
 *
 * Everything it shows comes from `useMacros()`, so a recording that is running
 * while this is open counts up on screen. It decides nothing itself — playback
 * rules, limits and failure messages all live in `lib/macros.ts`.
 */

import { useEffect, useState } from 'react';
import { closeDialog, useUiState } from '../lib/commands';
import { t } from '../lib/i18n';
import {
  cancelRecording,
  deleteMacro,
  hasLastRecording,
  macroLabel,
  playLast,
  playMacro,
  playUntilEndOfFile,
  renameMacro,
  saveLastRecording,
  setMacroShortcut,
  stopRecording,
  useMacros,
  type Macro,
} from '../lib/macros';
import { ask } from '../lib/prompt';
import {
  macroShortcutFromEvent,
  macroShortcutTaken,
  macroShortcutText,
  shortcutLabel,
} from '../lib/shortcuts';
import { toast } from '../lib/toast';
import { Modal } from './Modal';

export function MacroDialog() {
  const { dialog } = useUiState();
  if (dialog !== 'macros') return null;
  return <MacroManager />;
}

function MacroManager() {
  const { macros, recording, stepCount, playing } = useMacros();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [capturing, setCapturing] = useState<string | null>(null);
  // As typed, not as a number: a number field that snaps back to 1 the moment
  // it is cleared cannot be typed into at all.
  const [repeats, setRepeats] = useState<Record<string, string>>({});

  useShortcutCapture(capturing, setCapturing);

  const repeatText = (id: string) => repeats[id] ?? '2';
  const repeatCount = (id: string) => {
    const value = Number(repeatText(id));
    // An empty field plays once rather than refusing to play at all.
    return Number.isFinite(value) && value >= 1 ? Math.min(1000, Math.round(value)) : 1;
  };

  // Playing puts the caret in the file behind this dialog, so the dialog gets
  // out of the way first — watching a macro run into a document you cannot see
  // is how you find out afterwards that it ran into the wrong one.
  const playAndClose = (run: () => Promise<void>) => {
    closeDialog();
    void run();
  };

  const remove = async (macro: Macro) => {
    const choice = await ask(
      t('Makro „{name}“ löschen?', { name: macroLabel(macro) }),
      t('Das lässt sich nicht rückgängig machen.'),
      [
        { id: 'delete', label: t('Löschen'), tone: 'danger' },
        { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
      ],
    );
    if (choice === 'delete') deleteMacro(macro.id);
  };

  return (
    <Modal
      title={t('Makros')}
      onClose={closeDialog}
      footer={
        <button type="button" className="macro-done" onClick={closeDialog}>
          {t('Schließen')}
        </button>
      }
      wide
    >
      <div className="macro-manager">
        {recording ? (
          <section className="macro-recording" aria-live="polite">
            <p className="macro-recording-text">
              {t('Aufzeichnung läuft: {count} Schritte.', { count: stepCount })}
            </p>
            <div className="macro-recording-actions">
              <button type="button" className="macro-stop" onClick={stopRecording}>
                {t('Aufzeichnung beenden')}
              </button>
              <button type="button" className="macro-discard" onClick={cancelRecording}>
                {t('Verwerfen')}
              </button>
            </div>
          </section>
        ) : hasLastRecording() ? (
          <section className="macro-latest">
            <h3 className="macro-latest-title">{t('Letzte Aufzeichnung')}</h3>
            <p className="macro-latest-count">{t('{count} Schritte', { count: stepCount })}</p>
            <div className="macro-latest-actions">
              <button
                type="button"
                className="macro-play"
                disabled={playing}
                onClick={() => playAndClose(() => playLast())}
              >
                {t('Abspielen')}
              </button>
              <button
                type="button"
                className="macro-play-end"
                disabled={playing}
                onClick={() => playAndClose(() => playUntilEndOfFile())}
              >
                {t('Bis zum Dateiende')}
              </button>
            </div>
            <form
              className="macro-save"
              onSubmit={(event) => {
                event.preventDefault();
                if (saveLastRecording(name)) setName('');
              }}
            >
              <label className="macro-save-label" htmlFor="macro-save-name">
                {t('Unter einem Namen speichern')}
              </label>
              <input
                id="macro-save-name"
                className="macro-save-input"
                value={name}
                data-autofocus
                spellCheck={false}
                autoComplete="off"
                placeholder={t('Name des Makros')}
                onChange={(event) => setName(event.target.value)}
              />
              <button type="submit" className="macro-save-submit">
                {t('Speichern')}
              </button>
            </form>
          </section>
        ) : null}

        {macros.length === 0 ? (
          <p className="macro-empty">
            {t('Noch keine Makros. Zeichne eines mit {keys} auf und gib ihm hier einen Namen.', {
              keys: shortcutLabel('macro.toggleRecording') ?? '',
            })}
          </p>
        ) : (
          <ul className="macro-list">
            {macros.map((macro) => (
              <li key={macro.id} className="macro-row">
                <div className="macro-row-head">
                  {renaming === macro.id ? (
                    <form
                      className="macro-rename"
                      onSubmit={(event) => {
                        event.preventDefault();
                        renameMacro(macro.id, renameText);
                        setRenaming(null);
                      }}
                    >
                      <input
                        className="macro-rename-input"
                        value={renameText}
                        autoFocus
                        spellCheck={false}
                        autoComplete="off"
                        aria-label={t('Neuer Name')}
                        onChange={(event) => setRenameText(event.target.value)}
                      />
                      <button type="submit" className="macro-rename-submit">
                        {t('Übernehmen')}
                      </button>
                      <button
                        type="button"
                        className="macro-rename-cancel"
                        onClick={() => setRenaming(null)}
                      >
                        {t('Abbrechen')}
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="macro-name">{macroLabel(macro)}</span>
                      <span className="macro-meta">
                        {t('{count} Schritte', { count: macro.steps.length })}
                      </span>
                      {macro.shortcut ? (
                        <kbd className="macro-keys">{macroShortcutText(macro.shortcut)}</kbd>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="macro-actions">
                  <button
                    type="button"
                    className="macro-play"
                    disabled={playing}
                    onClick={() => playAndClose(() => playMacro(macro.id))}
                  >
                    {t('Abspielen')}
                  </button>
                  <div className="macro-repeat">
                    <input
                      className="macro-repeat-input"
                      type="number"
                      min={1}
                      max={1000}
                      value={repeatText(macro.id)}
                      aria-label={t('Anzahl der Durchläufe')}
                      onChange={(event) =>
                        setRepeats((previous) => ({ ...previous, [macro.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="macro-play-times"
                      disabled={playing}
                      onClick={() => playAndClose(() => playMacro(macro.id, repeatCount(macro.id)))}
                    >
                      {t('{count}× abspielen', { count: repeatCount(macro.id) })}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="macro-play-end"
                    disabled={playing}
                    onClick={() => playAndClose(() => playUntilEndOfFile(macro.id))}
                  >
                    {t('Bis zum Dateiende')}
                  </button>
                  <button
                    type="button"
                    className="macro-rename-start"
                    onClick={() => {
                      setRenameText(macro.name);
                      setRenaming(macro.id);
                    }}
                  >
                    {t('Umbenennen')}
                  </button>
                  <button
                    type="button"
                    className="macro-shortcut"
                    aria-pressed={capturing === macro.id}
                    onClick={() => setCapturing(capturing === macro.id ? null : macro.id)}
                  >
                    {capturing === macro.id ? t('Taste drücken…') : t('Kürzel')}
                  </button>
                  {macro.shortcut ? (
                    <button
                      type="button"
                      className="macro-shortcut-clear"
                      onClick={() => setMacroShortcut(macro.id, null)}
                    >
                      {t('Kürzel entfernen')}
                    </button>
                  ) : null}
                  <button type="button" className="macro-delete" onClick={() => void remove(macro)}>
                    {t('Löschen')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/**
 * Listens for the next chord while a macro is waiting for a key.
 *
 * In the capture phase, so the window-wide shortcut table does not get the
 * keystroke first and save the file while somebody is trying to bind Ctrl+S —
 * and `stopPropagation` so it does not get it second either.
 *
 * Escape is the one key this does not take. The dialog's focus trap is also
 * listening in the capture phase, was installed first, and has already closed
 * the dialog by the time we see it; fighting it for Escape would mean two ways
 * out of one dialog that do different things.
 */
function useShortcutCapture(
  capturing: string | null,
  setCapturing: (id: string | null) => void,
): void {
  useEffect(() => {
    if (!capturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCapturing(null);
        return;
      }
      // A modifier on its own is the user still reaching for the key.
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;

      event.preventDefault();
      event.stopPropagation();

      const shortcut = macroShortcutFromEvent(event);
      if (!shortcut) {
        toast('info', t('Ein Makro-Kürzel braucht Strg und eine Taste.'));
        return;
      }
      if (macroShortcutTaken(shortcut)) {
        toast('info', t('Diese Tastenkombination gehört schon zu UwUNotes selbst.'));
        return;
      }
      setMacroShortcut(capturing, shortcut);
      setCapturing(null);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, setCapturing]);
}
