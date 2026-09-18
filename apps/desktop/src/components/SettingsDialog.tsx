/**
 * Every preference in the app, in one dialog, applied the moment it is touched.
 *
 * There is no OK button and no pending copy of the settings, because a live
 * editor behind the dialog is a better preview than any mock-up — you change
 * the line height and you watch the line height change. The cost of that is
 * that "Abbrechen" cannot exist either, which is what the reset button at the
 * bottom is for.
 *
 * Writes go through `updateSettings()` and anything the editor reads is
 * followed by `reconfigureAllDocs()`, so a document in a background pane is
 * reconfigured too rather than keeping yesterday's font until it is clicked.
 *
 * Which plugins are on is NOT in `Settings`: the registry in
 * `editor/extensions/registry.ts` owns that, stores only the deviations from
 * each plugin's default, and announces its own changes. See its module comment
 * for why, and see this file's report for why no field was added here.
 *
 * Two sections show things this file does not own and cannot change: the saved
 * macros and the plugins' commands. They are here because a feature that can
 * only be found by typing its name into the palette is a feature for people who
 * already know it exists. Both are read-only lists with a way through to the
 * place that does own them.
 */

import { useId, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { closeDialog, openDialog, useUiState } from '../lib/commands';
import {
  ENCODINGS,
  encodingGroupName,
  encodingName,
  EOLS,
  eolName,
  type EncodingEntry,
  type EncodingGroup,
} from '../lib/encodings';
import { t } from '../lib/i18n';
import { macroLabel, useMacros } from '../lib/macros';
import { ask } from '../lib/prompt';
import {
  AUTOSAVE_CHOICES,
  BUNDLED_FONTS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  resetSettings,
  TAB_SIZES,
  updateSettings,
  useSettings,
  type Settings,
} from '../lib/settings';
import { macroShortcutText, shortcutLabel } from '../lib/shortcuts';
import { duplicateTheme, useUserThemes } from '../lib/user-themes';
import {
  allPlugins,
  pluginEnabled,
  setPluginEnabled,
  subscribePlugins,
  type UwuPlugin,
} from '../editor/extensions/registry';
import { reconfigureAllDocs } from '../editor/setup';
import { allThemes, themeById, THEMES, type EditorTheme } from '../editor/themes';
import { Modal } from './Modal';
import { ThemeEditor } from './ThemeEditor';

/** A plain preference: nothing in an `EditorState` depends on it. */
function write(patch: Partial<Settings>) {
  updateSettings(patch);
}

/**
 * A preference the editors read.
 *
 * `editor/setup.ts` also watches the store and would catch this, but a settings
 * page that relies on somebody else noticing is a settings page with a bug
 * waiting in it. The second reconfigure changes no text and costs a redraw of
 * the visible lines.
 */
function writeEditor(patch: Partial<Settings>) {
  updateSettings(patch);
  reconfigureAllDocs();
}

export function SettingsDialog() {
  const { dialog } = useUiState();
  if (dialog !== 'settings') return null;
  return <SettingsBody />;
}

function SettingsBody() {
  const settings = useSettings();
  const plugins = usePlugins();
  const themes = useEditorThemes();
  const { macros } = useMacros();
  /** Which theme the theme editor is open on, or `null` for nothing at all. */
  const [editingTheme, setEditingTheme] = useState<{ id: string | null } | null>(null);

  // Not `settings.editorTheme`: an id whose theme has been deleted still
  // resolves to the house theme in the editor, and a picker showing something
  // other than what is on screen is worse than a picker that moved.
  const currentTheme = themeById(settings.editorTheme);

  const duplicateCurrent = () => {
    const id = duplicateTheme(currentTheme, t('{name} Kopie', { name: currentTheme.name }));
    writeEditor({ editorTheme: id });
    setEditingTheme({ id });
  };

  const resetEverything = async () => {
    const answer = await ask(
      t('Einstellungen zurücksetzen?'),
      t(
        'Alle Einstellungen gehen auf die Voreinstellung zurück. Offene Dateien bleiben, wie sie sind.',
      ),
      [
        { id: 'reset', label: t('Zurücksetzen'), tone: 'danger' },
        { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
      ],
    );
    if (answer !== 'reset') return;
    resetSettings();
    for (const plugin of allPlugins()) setPluginEnabled(plugin.id, plugin.defaultEnabled);
    reconfigureAllDocs();
  };

  return (
    <>
      <Modal title={t('Einstellungen')} onClose={closeDialog} wide>
        <div className="settings">
          <Section title={t('Erscheinungsbild')}>
            <ChoiceField
              label={t('Farbschema')}
              value={settings.theme}
              options={[
                { value: 'system', label: t('System') },
                { value: 'light', label: t('Hell') },
                { value: 'dark', label: t('Dunkel') },
              ]}
              onChange={(theme) => write({ theme })}
            />
            <ThemeField
              value={currentTheme.id}
              themes={themes}
              onChange={(editorTheme) => writeEditor({ editorTheme })}
              onEdit={() => setEditingTheme({ id: currentTheme.id })}
              onDuplicate={duplicateCurrent}
              onImport={() => setEditingTheme({ id: null })}
            />
            <ChoiceField
              label={t('Sprache')}
              value={settings.language}
              options={[
                { value: 'system', label: t('System') },
                { value: 'de', label: 'Deutsch' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(language) => write({ language })}
            />
            <ChoiceField
              label={t('Animationen')}
              hint={t('„System“ folgt der Einstellung für reduzierte Bewegung.')}
              value={settings.motion}
              options={[
                { value: 'system', label: t('System') },
                { value: 'on', label: t('An') },
                { value: 'off', label: t('Aus') },
              ]}
              onChange={(motion) => write({ motion })}
            />
            <ChoiceField
              label={t('Tonfall')}
              hint={t('„Sachlich“ behält Nyu und lässt ihre Sprüche weg.')}
              value={settings.tone}
              options={[
                { value: 'playful', label: t('Verspielt') },
                { value: 'neutral', label: t('Sachlich') },
              ]}
              onChange={(tone) => write({ tone })}
            />
          </Section>

          <Section title={t('Schrift')}>
            <FontField
              value={settings.fontFamily}
              onChange={(fontFamily) => writeEditor({ fontFamily })}
            />
            <NumberField
              label={t('Schriftgröße')}
              value={settings.fontSize}
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              unit="px"
              onChange={(fontSize) => writeEditor({ fontSize })}
            />
            <RangeField
              label={t('Zeilenhöhe')}
              value={settings.lineHeight}
              min={1}
              max={3}
              step={0.05}
              format={(value) => value.toFixed(2)}
              onChange={(lineHeight) => writeEditor({ lineHeight })}
            />
            <SwitchField
              label={t('Ligaturen')}
              hint={t('Aus Zeichenpaaren wie != wird ein einzelnes Zeichen.')}
              checked={settings.ligatures}
              onChange={(ligatures) => writeEditor({ ligatures })}
            />
          </Section>

          <Section title={t('Editor')}>
            <SelectField
              label={t('Tabbreite')}
              value={settings.tabSize}
              options={TAB_SIZES.map((size) => ({ value: size, label: String(size) }))}
              onChange={(tabSize) => writeEditor({ tabSize })}
            />
            <SwitchField
              label={t('Mit Leerzeichen einrücken')}
              hint={t('Aus schreibt echte Tabulatoren — was ein Makefile braucht.')}
              checked={settings.insertSpaces}
              onChange={(insertSpaces) => writeEditor({ insertSpaces })}
            />
            <ChoiceField
              label={t('Zeilenumbruch')}
              value={settings.wrap}
              options={[
                { value: 'off', label: t('Aus') },
                { value: 'window', label: t('Am Fensterrand') },
              ]}
              onChange={(wrap) => writeEditor({ wrap })}
            />
            <ChoiceField
              label={t('Cursorform')}
              value={settings.caretStyle}
              options={[
                { value: 'line', label: t('Strich') },
                { value: 'block', label: t('Block') },
                { value: 'underline', label: t('Unterstrich') },
              ]}
              onChange={(caretStyle) => writeEditor({ caretStyle })}
            />
            <SwitchField
              label={t('Cursor blinkt')}
              hint={t('Ein blinkender Cursor kann Migräne und Anfälle auslösen.')}
              checked={settings.caretBlink}
              onChange={(caretBlink) => writeEditor({ caretBlink })}
            />
            <SwitchField
              label={t('Zeilennummern')}
              checked={settings.lineNumbers}
              onChange={(lineNumbers) => writeEditor({ lineNumbers })}
            />
            <SwitchField
              label={t('Minimap')}
              checked={settings.minimap}
              onChange={(minimap) => writeEditor({ minimap })}
            />
            <SwitchField
              label={t('Einrückungslinien')}
              checked={settings.indentGuides}
              onChange={(indentGuides) => writeEditor({ indentGuides })}
            />
            <SwitchField
              label={t('Aktive Zeile hervorheben')}
              checked={settings.highlightActiveLine}
              onChange={(highlightActiveLine) => writeEditor({ highlightActiveLine })}
            />
            <SwitchField
              label={t('Leerzeichen anzeigen')}
              hint={t('Punkte für Leerzeichen, Pfeile für Tabulatoren.')}
              checked={settings.showWhitespace}
              onChange={(showWhitespace) => writeEditor({ showWhitespace })}
            />
            <SwitchField
              label={t('Randlinie')}
              checked={settings.printMargin}
              onChange={(printMargin) => writeEditor({ printMargin })}
            />
            <NumberField
              label={t('Randlinie bei Spalte')}
              value={settings.printMarginColumn}
              min={20}
              max={400}
              step={1}
              disabled={!settings.printMargin}
              onChange={(printMarginColumn) => writeEditor({ printMarginColumn })}
            />
            <SwitchField
              label={t('Klammerpaare hervorheben')}
              checked={settings.bracketMatching}
              onChange={(bracketMatching) => writeEditor({ bracketMatching })}
            />
            <SwitchField
              label={t('Klammern automatisch schließen')}
              checked={settings.closeBrackets}
              onChange={(closeBrackets) => writeEditor({ closeBrackets })}
            />
            <SwitchField
              label={t('Autovervollständigung')}
              checked={settings.autocomplete}
              onChange={(autocomplete) => writeEditor({ autocomplete })}
            />
            <SwitchField
              label={t('Gleiche Wörter markieren')}
              hint={t('Jedes weitere Vorkommen des Worts unter dem Cursor bekommt einen Kasten.')}
              checked={settings.highlightSelectionMatches}
              onChange={(highlightSelectionMatches) => writeEditor({ highlightSelectionMatches })}
            />
          </Section>

          <Section title={t('Speichern')}>
            <SwitchField
              label={t('Leerzeichen am Zeilenende entfernen')}
              hint={t('Beim Speichern, im Text und im Editor gleichzeitig.')}
              checked={settings.trimTrailingWhitespaceOnSave}
              onChange={(trimTrailingWhitespaceOnSave) => write({ trimTrailingWhitespaceOnSave })}
            />
            <SwitchField
              label={t('Datei mit einem Zeilenumbruch beenden')}
              checked={settings.ensureFinalNewlineOnSave}
              onChange={(ensureFinalNewlineOnSave) => write({ ensureFinalNewlineOnSave })}
            />
            <SelectField
              label={t('Automatisch speichern')}
              hint={t('Nur Dateien, die schon einen Pfad haben und nichts zu fragen aufwerfen.')}
              value={settings.autosaveSeconds}
              options={AUTOSAVE_CHOICES.map((seconds) => ({
                value: seconds,
                label: autosaveLabel(seconds),
              }))}
              onChange={(autosaveSeconds) => write({ autosaveSeconds })}
            />
            <EncodingField
              label={t('Kodierung für neue Dateien')}
              value={settings.defaultEncoding}
              onChange={(defaultEncoding) => write({ defaultEncoding })}
            />
            <ChoiceField
              label={t('Zeilenenden für neue Dateien')}
              value={settings.defaultEol}
              options={NEW_FILE_EOLS.map((eol) => ({ value: eol, label: eolName(eol) }))}
              onChange={(defaultEol) => write({ defaultEol })}
            />
          </Section>

          <Section title={t('Verhalten')}>
            <SwitchField
              label={t('Sitzung wiederherstellen')}
              hint={t('Tabs, Splitlayout, Cursorpositionen und ungespeicherte Texte.')}
              checked={settings.restoreSession}
              onChange={(restoreSession) => write({ restoreSession })}
            />
            <SwitchField
              label={t('Git-Marker')}
              hint={t('Färbt geänderte Dateien im Dateibaum und auf dem Tab.')}
              checked={settings.gitIndicators}
              onChange={(gitIndicators) => write({ gitIndicators })}
            />
            <SwitchField
              label={t('Git-Marker am Zeilenrand')}
              hint={t(
                'Zeigt neben jeder Zeile, was sich seit dem letzten Commit geändert hat. Kostet einen Git-Aufruf pro Datei.',
              )}
              checked={settings.gitGutter}
              onChange={(gitGutter) => write({ gitGutter })}
            />
            <SwitchField
              label={t('Töne')}
              hint={t('Ein kurzer Ton beim Speichern und beim Fehler.')}
              checked={settings.sounds}
              onChange={(sounds) => write({ sounds })}
            />
            <RangeField
              label={t('Lautstärke')}
              value={settings.soundVolume}
              min={0}
              max={1}
              step={0.05}
              disabled={!settings.sounds}
              format={(value) => `${Math.round(value * 100)} %`}
              onChange={(soundVolume) => write({ soundVolume })}
            />
          </Section>

          <Section title={t('Makros')}>
            {macros.length === 0 ? (
              <p className="settings-empty">{t('Noch keine Makros gespeichert.')}</p>
            ) : (
              <ul className="settings-macro-list">
                {macros.map((macro) => (
                  <li key={macro.id} className="settings-macro">
                    <span className="settings-macro-name">{macroLabel(macro)}</span>
                    <span className="settings-macro-steps">
                      {t('{count} Schritte', { count: macro.steps.length })}
                    </span>
                    {macro.shortcut ? (
                      <kbd className="settings-macro-keys">{macroShortcutText(macro.shortcut)}</kbd>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <ul className="settings-command-list">
              <CommandRow
                label={t('Makro aufzeichnen')}
                keys={shortcutLabel('macro.toggleRecording')}
              />
              <CommandRow
                label={t('Letztes Makro abspielen')}
                keys={shortcutLabel('macro.playLast')}
              />
            </ul>
            {/* There is one dialog slot, so this closes the settings page rather
              than covering it. That is the right way round: managing macros is
              somewhere you go, not something you glance at. */}
            <button
              type="button"
              className="settings-macro-manage"
              onClick={() => openDialog('macros')}
            >
              {t('Makros verwalten…')}
            </button>
          </Section>

          <Section title={t('Erweiterungen')}>
            {plugins.length === 0 ? (
              <p className="settings-empty">{t('Keine Erweiterungen installiert.')}</p>
            ) : (
              plugins.map((plugin) => (
                <div key={plugin.id} className="settings-plugin">
                  <SwitchField
                    // Name and description are `N_()` constants in the plugin's own
                    // module; the registry's contract is that the UI translates them.
                    label={t(plugin.name)}
                    hint={t(plugin.description)}
                    checked={pluginEnabled(plugin.id)}
                    onChange={(on) => setPluginEnabled(plugin.id, on)}
                  />
                  {/* `plugin.commands`, not `pluginCommands()`: that one filters by
                    what is enabled, and the question this list answers is what
                    turning the switch on would give you. */}
                  {plugin.commands && plugin.commands.length > 0 ? (
                    <ul className="settings-command-list">
                      {plugin.commands.map((command) => (
                        <CommandRow key={command.id} label={command.title()} keys={undefined} />
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))
            )}
          </Section>

          <footer className="settings-footer">
            <p className="settings-footer-note">
              {t('Änderungen gelten sofort. Es gibt nichts zu bestätigen.')}
            </p>
            <button type="button" className="settings-reset" onClick={() => void resetEverything()}>
              {t('Alles zurücksetzen')}
            </button>
          </footer>
        </div>
      </Modal>
      {/* A sibling rather than a child, so the focus trap stacks it on top of
        this dialog: the theme editor is the overlay Escape should answer while
        it is open, and the settings page is still there underneath. */}
      {editingTheme ? (
        <ThemeEditor themeId={editingTheme.id} onClose={() => setEditingTheme(null)} />
      ) : null}
    </>
  );
}

/* ── Odds and ends the sections need ───────────────────── */

/**
 * The built-in themes and the user's own, redrawn when one of the latter
 * changes.
 *
 * `useUserThemes()` is here for its subscription as much as its value: the list
 * it returns is replaced on every change, so it is also the only dependency
 * `allThemes()` has.
 */
function useEditorThemes(): EditorTheme[] {
  const mine = useUserThemes();
  return useMemo(() => allThemes(), [mine]);
}

/** `Settings.defaultEol` is narrower than `Eol`: a new file is never CR-only. */
const NEW_FILE_EOLS = EOLS.filter((eol): eol is 'lf' | 'crlf' => eol !== 'cr');

function autosaveLabel(seconds: number): string {
  if (seconds === 0) return t('Aus');
  if (seconds === 30) return t('Alle 30 Sekunden');
  if (seconds === 60) return t('Jede Minute');
  return t('Alle 5 Minuten');
}

function pluginSignature(): string {
  return allPlugins()
    .map((plugin) => `${plugin.id}:${pluginEnabled(plugin.id) ? '1' : '0'}`)
    .join(' ');
}

/**
 * The registry's plugins, redrawn when one is registered or toggled.
 *
 * The snapshot is a string rather than the array, because `allPlugins()` hands
 * back a fresh copy every call and `useSyncExternalStore` compares snapshots by
 * identity — a new array every time is an infinite render loop.
 */
function usePlugins(): UwuPlugin[] {
  const signature = useSyncExternalStore(subscribePlugins, pluginSignature);
  return useMemo(() => allPlugins(), [signature]);
}

/* ── The controls ──────────────────────────────────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function Hint({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null;
  return (
    <p className="settings-hint" id={id}>
      {text}
    </p>
  );
}

/** A command the user might not know about, and the keys it sits on. */
function CommandRow({ label, keys }: { label: string; keys: string | undefined }) {
  return (
    <li className="settings-command">
      <span className="settings-command-name">{label}</span>
      {keys ? <kbd className="settings-command-keys">{keys}</kbd> : null}
    </li>
  );
}

type ThemeFieldProps = {
  value: string;
  themes: readonly EditorTheme[];
  onChange: (id: string) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onImport: () => void;
};

/**
 * The theme picker, plus the three ways to end up with one of your own.
 *
 * Its own field rather than a {@link SelectField}, because the two halves of
 * the list need saying apart: a theme called "UwU Paper 2" that somebody made
 * last Tuesday sitting unmarked between two we ship is a support question.
 *
 * "Bearbeiten…" is never disabled, even on a built-in. The theme editor answers
 * that case with an offer to copy it, which is what the user wanted anyway and
 * one button rather than a greyed-out one and a sentence explaining itself.
 */
function ThemeField({ value, themes, onChange, onEdit, onDuplicate, onImport }: ThemeFieldProps) {
  const id = useId();
  const custom = themes.filter((theme) => !THEMES.some((shipped) => shipped.id === theme.id));

  return (
    <div className="settings-field settings-field-theme">
      <label className="settings-label" htmlFor={id}>
        {t('Editor-Theme')}
      </label>
      <select
        id={id}
        className="settings-select"
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      >
        <optgroup label={t('Mitgeliefert')}>
          {THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </optgroup>
        {custom.length > 0 ? (
          <optgroup label={t('Eigene')}>
            {custom.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name || t('Theme ohne Namen')}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <div className="settings-theme-actions">
        <button type="button" className="settings-theme-edit" onClick={onEdit}>
          {t('Bearbeiten…')}
        </button>
        <button type="button" className="settings-theme-duplicate" onClick={onDuplicate}>
          {t('Duplizieren')}
        </button>
        <button type="button" className="settings-theme-import" onClick={onImport}>
          {t('Importieren…')}
        </button>
      </div>
      <Hint id={`${id}-hint`} text={t('Färbt nur den Text, nicht die Oberfläche.')} />
    </div>
  );
}

type FieldOption<T extends string | number> = { value: T; label: string };

type SelectFieldProps<T extends string | number> = {
  label: string;
  hint?: string;
  value: T;
  options: readonly FieldOption<T>[];
  onChange: (value: T) => void;
};

function SelectField<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div className="settings-field">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="settings-select"
        value={String(value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          // Back through the option list, because a `<select>` only ever hands
          // out strings and half of these preferences are numbers.
          const picked = options.find((option) => String(option.value) === event.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      <Hint id={`${id}-hint`} text={hint} />
    </div>
  );
}

type ChoiceFieldProps<T extends string> = {
  label: string;
  hint?: string;
  value: T;
  options: readonly FieldOption<T>[];
  onChange: (value: T) => void;
};

/** Two to four options, side by side. Real radios, so the arrow keys work. */
function ChoiceField<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: ChoiceFieldProps<T>) {
  const id = useId();
  return (
    <fieldset className="settings-field settings-field-choice">
      <legend className="settings-label">{label}</legend>
      <div className="settings-choice">
        {options.map((option) => (
          <label
            key={option.value}
            className={`settings-choice-option${
              option.value === value ? ' settings-choice-option-active' : ''
            }`}
          >
            <input
              type="radio"
              className="settings-choice-input"
              name={id}
              value={option.value}
              checked={option.value === value}
              aria-describedby={hint ? `${id}-hint` : undefined}
              onChange={() => onChange(option.value)}
            />
            <span className="settings-choice-label">{option.label}</span>
          </label>
        ))}
      </div>
      <Hint id={`${id}-hint`} text={hint} />
    </fieldset>
  );
}

type SwitchFieldProps = {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

function SwitchField({ label, hint, checked, disabled, onChange }: SwitchFieldProps) {
  const id = useId();
  return (
    <div className="settings-field settings-field-switch">
      <span className="settings-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="settings-switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="settings-switch-knob" aria-hidden="true" />
      </button>
      <Hint id={`${id}-hint`} text={hint} />
    </div>
  );
}

type NumberFieldProps = {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: NumberFieldProps) {
  const id = useId();
  return (
    <div className="settings-field">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <span className="settings-number">
        <input
          id={id}
          type="number"
          className="settings-number-input"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => {
            const next = Number(event.target.value);
            // An empty field parses as 0 and would clamp to the minimum on
            // every keystroke; `sanitize()` catches the rest.
            if (event.target.value !== '' && Number.isFinite(next)) onChange(next);
          }}
        />
        {unit && <span className="settings-number-unit">{unit}</span>}
      </span>
      <Hint id={`${id}-hint`} text={hint} />
    </div>
  );
}

type RangeFieldProps = {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  format: (value: number) => string;
  onChange: (value: number) => void;
};

function RangeField({
  label,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  format,
  onChange,
}: RangeFieldProps) {
  const id = useId();
  return (
    <div className="settings-field">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <span className="settings-range">
        <input
          id={id}
          type="range"
          className="settings-range-input"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-valuetext={format(value)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output className="settings-range-value" htmlFor={id}>
          {format(value)}
        </output>
      </span>
      <Hint id={`${id}-hint`} text={hint} />
    </div>
  );
}

function FontField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="settings-field">
      <label className="settings-label" htmlFor={id}>
        {t('Schriftart')}
      </label>
      <input
        id={id}
        className="settings-text-input"
        list={`${id}-fonts`}
        value={value}
        spellCheck={false}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={`${id}-fonts`}>
        {BUNDLED_FONTS.map((font) => (
          <option key={font} value={font} />
        ))}
      </datalist>
      <Hint
        id={`${id}-hint`}
        text={t('Mitgeliefert oder eine Schrift vom System — der Name, wie ihn das System kennt.')}
      />
    </div>
  );
}

function EncodingField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const groups = useMemo(() => groupEncodings(), []);
  // A label that arrived from a BOM or from detection is not in the menu list;
  // showing it anyway beats silently selecting something else on the user's
  // behalf.
  const exotic = !ENCODINGS.some((entry) => entry.label === value);

  return (
    <div className="settings-field">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="settings-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {exotic && <option value={value}>{encodingName(value)}</option>}
        {groups.map(([group, entries]) => (
          <optgroup key={group} label={encodingGroupName(group)}>
            {entries.map((entry) => (
              <option key={entry.label} value={entry.label}>
                {entry.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** The encoding list as `<optgroup>`s, in the order `lib/encodings.ts` lists them. */
function groupEncodings(): [EncodingGroup, EncodingEntry[]][] {
  const byGroup = new Map<EncodingGroup, EncodingEntry[]>();
  for (const entry of ENCODINGS) {
    const known = byGroup.get(entry.group);
    if (known) known.push(entry);
    else byGroup.set(entry.group, [entry]);
  }
  return [...byGroup];
}
