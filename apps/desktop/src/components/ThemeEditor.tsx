/**
 * The theme editor: thirty colours, a sample to look at while you change them,
 * and the four things anyone does to a theme — copy it, rename it, hand it to
 * somebody else, throw it away.
 *
 * Every change is written through `lib/user-themes.ts` the moment it is made
 * and the open documents are reconfigured immediately, the same bargain the
 * settings page strikes: no OK button, no pending copy, and the editor behind
 * this dialog is the real preview. The sample block exists for the tokens that
 * happen not to be on screen — nobody has a merge conflict and an invalid
 * escape sequence open just because they wanted to fix the comment colour.
 *
 * It opens on whichever theme the settings page has selected, and never quietly
 * changes that selection: duplicating or importing switches to the new theme
 * because a copy you cannot see is not a copy you can edit, and both of those
 * are things the user just pressed a button to do.
 *
 * This module writes no colours of its own. Everything it paints comes out of
 * the theme being edited, which is why the inline styles below are inline — a
 * stylesheet cannot know what the user typed four keystrokes ago.
 */

import { useId, useState } from 'react';
import { t } from '../lib/i18n';
import { ask } from '../lib/prompt';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import {
  clearUserThemeToken,
  deleteUserTheme,
  duplicateTheme,
  exportTheme,
  importTheme,
  createUserTheme,
  isColourValue,
  renameUserTheme,
  setUserThemeDark,
  themeValue,
  TOKEN_GROUPS,
  TOKEN_LABELS,
  updateUserTheme,
  useUserThemes,
  type ThemeSource,
  type ThemeToken,
  type UserTheme,
} from '../lib/user-themes';
import { reconfigureAllDocs } from '../editor/setup';
import { THEMES } from '../editor/themes';
import { Modal } from './Modal';

type ThemeEditorProps = {
  /** A theme id, or `null` to open on the import box with nothing selected. */
  themeId: string | null;
  onClose: () => void;
};

export function ThemeEditor({ themeId, onClose }: ThemeEditorProps) {
  const settings = useSettings();
  const themes = useUserThemes();
  const [editing, setEditing] = useState(themeId);
  const mine = themes.find((theme) => theme.id === editing);
  // Looked up in the shipped list rather than through `themeById()`, which
  // answers "UwU" for anything it does not recognise: a theme deleted in
  // another window has to land on the import box, not on the house theme.
  const shipped = THEMES.find((theme) => theme.id === editing);

  /** The copy is selected as well as created — an invisible copy cannot be edited. */
  const startFrom = (source: ThemeSource) => {
    const id = duplicateTheme(source, t('{name} Kopie', { name: source.name }));
    activateTheme(id);
    setEditing(id);
  };

  const importFrom = (json: string): boolean => {
    const id = importTheme(json);
    if (!id) {
      toast('error', t('Darin steht kein Theme, das sich lesen lässt.'));
      return false;
    }
    activateTheme(id);
    setEditing(id);
    toast('success', t('Theme importiert.'));
    return true;
  };

  const remove = async (theme: UserTheme) => {
    const choice = await ask(
      t('Theme „{name}“ löschen?', { name: theme.name }),
      t('Das lässt sich nicht rückgängig machen.'),
      [
        { id: 'delete', label: t('Löschen'), tone: 'danger' },
        { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
      ],
    );
    if (choice !== 'delete') return;
    deleteUserTheme(theme.id);
    // Read fresh: the question above was awaited, and the selection may have
    // moved on while it was on screen.
    if (getSettings().editorTheme === theme.id) updateSettings({ editorTheme: 'uwu' });
    reconfigureAllDocs();
    onClose();
  };

  return (
    <Modal
      title={mine || shipped ? t('Theme bearbeiten') : t('Theme importieren')}
      onClose={onClose}
      footer={
        <button type="button" className="theme-editor-done" onClick={onClose}>
          {t('Fertig')}
        </button>
      }
      wide
    >
      <div className="theme-editor">
        {mine ? (
          <ThemeForm
            theme={mine}
            active={settings.editorTheme === mine.id}
            onDuplicate={() => startFrom(mine)}
            onDelete={() => void remove(mine)}
          />
        ) : shipped ? (
          <section className="theme-editor-shipped">
            <p className="theme-editor-shipped-text">
              {t(
                '„{name}“ gehört zum Programm und bleibt, wie es ist. Eine Kopie davon kannst du ändern, so weit du magst.',
                { name: shipped.name },
              )}
            </p>
            <button
              type="button"
              className="theme-editor-duplicate"
              data-autofocus
              onClick={() => startFrom(shipped)}
            >
              {t('Kopie anlegen und bearbeiten')}
            </button>
          </section>
        ) : (
          <section className="theme-editor-none">
            <p className="theme-editor-none-text">
              {t(
                'Kein Theme ausgewählt. Füge unten eins ein, das dir jemand geschickt hat, oder fang bei den Farben an, die gerade zu sehen sind.',
              )}
            </p>
            <button
              type="button"
              className="theme-editor-new"
              data-autofocus
              onClick={() => {
                const id = createUserTheme(t('Neues Theme'));
                activateTheme(id);
                setEditing(id);
              }}
            >
              {t('Neues Theme anlegen')}
            </button>
          </section>
        )}

        {/* Keyed on the theme, so importing one closes the box it arrived in
            instead of leaving the JSON sitting above the editor it produced. */}
        <Exchange key={mine?.id ?? 'none'} themeId={mine?.id ?? null} onImport={importFrom} />
      </div>
    </Modal>
  );
}

/** Selecting and applying in one move; everything that mints a theme ends here. */
function activateTheme(id: string) {
  updateSettings({ editorTheme: id });
  reconfigureAllDocs();
}

/* ── The theme itself ──────────────────────────────────── */

type ThemeFormProps = {
  theme: UserTheme;
  /** Whether the open documents are showing this one, and so need reconfiguring. */
  active: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
};

function ThemeForm({ theme, active, onDuplicate, onDelete }: ThemeFormProps) {
  const nameId = useId();
  const darkId = useId();

  const applied = () => {
    if (active) reconfigureAllDocs();
  };

  return (
    <>
      <div className="theme-editor-head">
        <div className="theme-editor-name">
          <label className="theme-editor-name-label" htmlFor={nameId}>
            {t('Name')}
          </label>
          <input
            id={nameId}
            className="theme-editor-name-input"
            value={theme.name}
            data-autofocus
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => renameUserTheme(theme.id, event.target.value)}
          />
        </div>

        <div className="theme-editor-dark">
          <span className="theme-editor-dark-label" id={`${darkId}-label`}>
            {t('Dunkler Grund')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={theme.dark}
            aria-labelledby={`${darkId}-label`}
            aria-describedby={`${darkId}-hint`}
            className="theme-editor-dark-switch"
            onClick={() => {
              setUserThemeDark(theme.id, !theme.dark);
              applied();
            }}
          >
            <span className="theme-editor-dark-knob" aria-hidden="true" />
          </button>
          {/* Honest about what it does, which today is nothing: everything that
              needs a colour reads the tokens below directly, including the
              minimap. The flag travels with the theme so that the next thing to
              want the answer does not have to guess it from the background. */}
          <p className="theme-editor-dark-hint" id={`${darkId}-hint`}>
            {t('Gehört zur Beschreibung des Themes und ändert keine einzige Farbe.')}
          </p>
        </div>

        <div className="theme-editor-actions">
          <button type="button" className="theme-editor-duplicate" onClick={onDuplicate}>
            {t('Duplizieren')}
          </button>
          <button type="button" className="theme-editor-delete" onClick={onDelete}>
            {t('Löschen')}
          </button>
        </div>
      </div>

      <Preview theme={theme} />

      {TOKEN_GROUPS.map((group) => (
        <section key={group.id} className="theme-editor-group">
          <h3 className="theme-editor-group-title">{t(group.title)}</h3>
          <div className="theme-editor-group-body">
            {group.tokens.map((token) => (
              <TokenRow
                key={`${theme.id}:${token}`}
                theme={theme}
                token={token}
                onApplied={applied}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/* ── One colour ────────────────────────────────────────── */

type TokenRowProps = { theme: UserTheme; token: ThemeToken; onApplied: () => void };

/**
 * A swatch and a text field for one token.
 *
 * The text field is the real control and the swatch is a convenience: `oklch()`
 * and `color-mix()` are colours the editor accepts and `<input type="color">`
 * is not able to show, so it falls back to black rather than pretending to
 * know. Only the text field can produce those, and only it is allowed to be
 * momentarily wrong — `#ff` on the way to `#ff8ab8` is rejected by
 * `updateUserTheme` and would snap the field back under the user's hands, so a
 * half-typed value is held here until it either parses or the field is left.
 */
function TokenRow({ theme, token, onApplied }: TokenRowProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const stored = themeValue(theme, token);
  const shown = draft ?? stored;
  const label = t(TOKEN_LABELS[token]);
  const invalid = draft !== null && !isColourValue(draft.trim());

  const write = (value: string) => {
    if (updateUserTheme(theme.id, token, value)) onApplied();
  };

  return (
    <div className="theme-token" data-invalid={invalid ? 'yes' : undefined}>
      <label className="theme-token-label" htmlFor={id}>
        {label}
      </label>
      <input
        type="color"
        className="theme-token-swatch"
        value={asHex(shown)}
        aria-label={t('Farbwähler für {token}', { token: label })}
        onChange={(event) => {
          setDraft(null);
          write(event.target.value);
        }}
      />
      <input
        id={id}
        type="text"
        className="theme-token-input"
        value={shown}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        onChange={(event) => {
          setDraft(event.target.value);
          write(event.target.value);
        }}
        // Leaving the field settles it: whatever was typed either landed, in
        // which case the draft matches, or it never will, in which case the
        // stored value is the honest thing to show.
        onBlur={() => setDraft(null)}
      />
      <button
        type="button"
        className="theme-token-reset"
        aria-label={t('{token} zurücksetzen', { token: label })}
        onClick={() => {
          setDraft(null);
          clearUserThemeToken(theme.id, token);
          onApplied();
        }}
      >
        {t('Zurücksetzen')}
      </button>
    </div>
  );
}

/** `<input type="color">` speaks `#rrggbb` and nothing else. */
function asHex(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
  if (short) {
    const [, red, green, blue] = short;
    if (red && green && blue) {
      return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase();
    }
  }
  return '#000000';
}

/* ── The sample ────────────────────────────────────────── */

type Span = {
  token?: ThemeToken;
  text: string;
  bold?: boolean;
  italic?: boolean;
  picked?: boolean;
};
type SampleLine = { spans: readonly Span[]; mark?: ThemeToken; active?: boolean };

/**
 * Six lines that between them use nearly every token in the list.
 *
 * Including the furniture: line three is the active line and carries the
 * caret, line four holds a selection, and the gutter shows one of each git
 * mark. A sample that only showed syntax would leave half the fields below it
 * with nothing to point at.
 */
function sampleLines(): readonly SampleLine[] {
  return [
    {
      spans: [
        {
          token: '--uwu-code-comment',
          text: `// ${t('zählt, was gezählt werden muss')}`,
          italic: true,
        },
      ],
    },
    {
      mark: '--uwu-code-added',
      spans: [
        { token: '--uwu-code-keyword', text: 'import', bold: true },
        { token: '--uwu-code-operator', text: ' { ' },
        { token: '--uwu-code-variable', text: 'nyu' },
        { token: '--uwu-code-operator', text: ' } ' },
        { token: '--uwu-code-keyword', text: 'from' },
        { token: '--uwu-code-operator', text: ' ' },
        { token: '--uwu-code-string', text: "'./nyu'" },
        { token: '--uwu-code-operator', text: ';' },
      ],
    },
    {
      active: true,
      spans: [
        { token: '--uwu-code-keyword', text: 'const', bold: true },
        { text: ' ' },
        { token: '--uwu-code-constant', text: 'GRENZE' },
        { token: '--uwu-code-operator', text: ': ' },
        { token: '--uwu-code-type', text: 'number' },
        { token: '--uwu-code-operator', text: ' = ' },
        { token: '--uwu-code-number', text: '42' },
        { token: '--uwu-code-operator', text: ';' },
      ],
    },
    {
      mark: '--uwu-code-modified',
      spans: [
        { token: '--uwu-code-keyword', text: 'function', bold: true },
        { text: ' ' },
        { token: '--uwu-code-function', text: 'zaehle' },
        { token: '--uwu-code-operator', text: '(' },
        { token: '--uwu-code-variable', text: 'worte', picked: true },
        { token: '--uwu-code-operator', text: ') {' },
      ],
    },
    {
      spans: [
        { token: '--uwu-code-operator', text: '  ' },
        { token: '--uwu-code-keyword', text: 'return', bold: true },
        { text: ' ' },
        { token: '--uwu-code-variable', text: 'worte' },
        { token: '--uwu-code-operator', text: '.' },
        { token: '--uwu-code-function', text: 'filter' },
        { token: '--uwu-code-operator', text: '((w) => w !== ' },
        { token: '--uwu-code-string', text: "'uwu'" },
        { token: '--uwu-code-operator', text: ').length > ' },
        { token: '--uwu-code-constant', text: 'GRENZE' },
        { token: '--uwu-code-operator', text: ';' },
      ],
    },
    {
      mark: '--uwu-code-deleted',
      spans: [{ token: '--uwu-code-matching-bracket', text: '}' }],
    },
  ];
}

/**
 * `role="img"` on purpose: the sample is a picture of the theme, and reading
 * six lines of made-up TypeScript aloud helps nobody choose a comment colour.
 */
function Preview({ theme }: { theme: UserTheme }) {
  const value = (token: ThemeToken) => themeValue(theme, token);

  return (
    <div
      className="theme-preview"
      role="img"
      aria-label={t('Vorschau des Themes')}
      style={{ background: value('--uwu-deep'), color: value('--uwu-ink') }}
    >
      {sampleLines().map((line, index) => (
        <div
          key={index}
          className="theme-preview-line"
          style={line.active ? { background: value('--uwu-code-active-line') } : undefined}
        >
          <span
            className="theme-preview-gutter"
            style={{
              background: value('--uwu-deep-gutter'),
              borderRight: `1px solid ${value('--uwu-hairline')}`,
              color: value(
                line.active ? '--uwu-code-line-number-active' : '--uwu-code-line-number',
              ),
            }}
          >
            <span
              className="theme-preview-mark"
              style={{ background: line.mark ? value(line.mark) : 'transparent' }}
            />
            {index + 1}
          </span>
          <span className="theme-preview-code">
            {line.spans.map((span, at) => (
              <span
                key={at}
                className="theme-preview-span"
                style={{
                  color: span.token ? value(span.token) : undefined,
                  background: span.picked ? value('--uwu-code-selection') : undefined,
                  fontWeight: span.bold ? 600 : undefined,
                  fontStyle: span.italic ? 'italic' : undefined,
                }}
              >
                {span.text}
              </span>
            ))}
            {line.active ? (
              <span
                className="theme-preview-caret"
                style={{ borderLeft: `2px solid ${value('--uwu-code-cursor')}` }}
              />
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── One theme as one blob ─────────────────────────────── */

type ExchangeProps = { themeId: string | null; onImport: (json: string) => boolean };

/**
 * Export and import share one text box, because they are the same box: what
 * comes out of "Exportieren" is exactly what "Importieren" eats, and a theme
 * that travels as one paste is a theme somebody will actually send you.
 */
function Exchange({ themeId, onImport }: ExchangeProps) {
  const id = useId();
  const [open, setOpen] = useState(themeId === null);
  const [text, setText] = useState('');

  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => toast('success', t('In die Zwischenablage kopiert.')),
      () =>
        toast(
          'error',
          t('Die Zwischenablage hat abgelehnt. Markiere den Text und kopiere ihn selbst.'),
        ),
    );
  };

  return (
    <section className="theme-exchange">
      <button
        type="button"
        className="theme-exchange-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {t('Austausch')}
      </button>
      {open ? (
        <div className="theme-exchange-body" id={id}>
          <label className="theme-exchange-label" htmlFor={`${id}-text`}>
            {t('Ein Theme als JSON')}
          </label>
          <textarea
            id={`${id}-text`}
            className="theme-exchange-text"
            value={text}
            rows={8}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('Hier einfügen, was dir jemand geschickt hat.')}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="theme-exchange-actions">
            <button
              type="button"
              className="theme-exchange-export"
              disabled={themeId === null}
              onClick={() => setText(themeId ? exportTheme(themeId) : '')}
            >
              {t('Exportieren')}
            </button>
            <button
              type="button"
              className="theme-exchange-copy"
              disabled={text === ''}
              onClick={copy}
            >
              {t('Kopieren')}
            </button>
            <button
              type="button"
              className="theme-exchange-import"
              disabled={text.trim() === ''}
              onClick={() => {
                if (onImport(text)) setText('');
              }}
            >
              {t('Importieren')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
