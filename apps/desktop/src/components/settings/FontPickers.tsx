/**
 * The two font pickers in the settings: one for the interface, one for the
 * editor. Deliberately separate — the interface reads best in a proportional
 * face, code and columns of text need a monospace one.
 *
 * - {@link UiFontPicker}: the suite's choices (`FONT_CHOICES` from
 *   @uwusuite/design: UwU Sans, Manrope, Rubik, DM Sans, System), each shown in
 *   itself, applied to the whole window the moment it is clicked.
 * - {@link EditorFontPicker}: the bundled faces and every family installed on
 *   this computer, monospace ones first, each name drawn in its own font, with
 *   a search. Any name can still be typed: a value saved before this picker
 *   existed, or a font the scan could not see, keeps working.
 */

import {
  FONT_CHOICES,
  FONT_NAMES,
  FONT_STACKS,
  FONT_TRACKING,
  Icon,
  type FontChoice,
} from '@uwusuite/design';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { groupFonts, previewStack, useSystemFonts } from '../../lib/editor-fonts';
import { t } from '../../lib/i18n';
import { ICONS } from '@uwusuite/design';
import { scrollToShow } from '../../lib/menu-placement';

export function UiFontPicker({
  value,
  onChange,
}: {
  value: FontChoice;
  onChange: (value: FontChoice) => void;
}) {
  const id = useId();
  return (
    <fieldset className="settings-field settings-field-uifont">
      <legend className="settings-label">{t('Schrift der Oberfläche')}</legend>
      <div className="uifont-choices" role="radiogroup" aria-describedby={`${id}-hint`}>
        {FONT_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={value === choice}
            className="uifont-choice"
            style={{ fontFamily: FONT_STACKS[choice], letterSpacing: FONT_TRACKING[choice] }}
            onClick={() => onChange(choice)}
          >
            <span className="uifont-choice-name">
              {choice === 'system' ? t('System') : FONT_NAMES[choice]}
            </span>
            <span className="uifont-choice-sample">{t('Menüs, Dialoge und Nyu: 0123 ♥')}</span>
          </button>
        ))}
      </div>
      <p className="settings-hint" id={`${id}-hint`}>
        {t(
          'Für Menüs, Dialoge, Seitenleiste und Statusleiste. Der Text im Editor hat seine eigene Schrift.',
        )}
      </p>
    </fieldset>
  );
}

/** One row of the editor font list. */
type Option = { key: string; family: string; custom?: boolean };

export function EditorFontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const system = useSystemFonts();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());

  const groups = useMemo(() => groupFonts(system ?? [], query), [system, query]);
  const typed = query.trim();
  const exact = [...groups.bundled, ...groups.monospace, ...groups.other].some(
    (family) => family.toLocaleLowerCase() === typed.toLocaleLowerCase(),
  );

  const sections: { title: string; options: Option[] }[] = [];
  const section = (title: string, families: string[], prefix: string) => {
    if (families.length > 0) {
      sections.push({
        title,
        options: families.map((family) => ({ key: `${prefix}:${family}`, family })),
      });
    }
  };
  section(t('Mitgeliefert'), groups.bundled, 'bundled');
  section(t('Monospace auf diesem System'), groups.monospace, 'mono');
  section(t('Weitere Schriften auf diesem System'), groups.other, 'other');
  // Last, so Enter on a search picks the first real match, not the typed text.
  if (typed && !exact) {
    sections.push({
      title: t('Eigener Name'),
      options: [{ key: `custom:${typed}`, family: typed, custom: true }],
    });
  }
  const options = sections.flatMap((entry) => entry.options);

  // The highlight follows the list: a search that hides it moves it to the
  // first match, so Enter always picks something visible.
  const activeKey = options.some((option) => option.key === active)
    ? active
    : (options[0]?.key ?? null);

  useEffect(() => {
    const list = listRef.current;
    const option = activeKey ? optionRefs.current.get(activeKey) : undefined;
    if (!list || !option) return;
    const next = scrollToShow(
      { top: option.offsetTop, height: option.offsetHeight },
      { scrollTop: list.scrollTop, clientHeight: list.clientHeight },
    );
    if (next !== list.scrollTop) list.scrollTop = next;
  }, [activeKey]);

  const move = (delta: number) => {
    if (options.length === 0) return;
    const at = options.findIndex((option) => option.key === activeKey);
    const next = options[Math.min(options.length - 1, Math.max(0, at + delta))];
    if (next) setActive(next.key);
  };

  const pick = (option: Option) => {
    onChange(option.family);
    if (option.custom) setQuery('');
  };

  const current = value.toLocaleLowerCase();

  return (
    <div className="settings-field settings-field-editorfont">
      <span className="settings-label" id={`${id}-label`}>
        {t('Schriftart')}
      </span>
      <span
        className="editorfont-current"
        style={{ fontFamily: previewStack(value) }}
        title={value}
      >
        {value}
      </span>
      <p className="settings-hint" id={`${id}-hint`}>
        {t('Mitgeliefert oder eine Schrift vom System. Monospace-Schriften stehen oben.')}
      </p>

      <div className="editorfont">
        <div className="editorfont-search">
          <Icon icon={ICONS.search} size="xs" className="editorfont-search-icon" />
          <input
            type="search"
            className="editorfont-search-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-hint`}
            aria-activedescendant={activeKey ? `${id}-${activeKey}` : undefined}
            placeholder={t('Schriften durchsuchen oder Namen eingeben')}
            value={query}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') move(1);
              else if (event.key === 'ArrowUp') move(-1);
              else if (event.key === 'PageDown') move(8);
              else if (event.key === 'PageUp') move(-8);
              else if (event.key === 'Enter') {
                const option = options.find((entry) => entry.key === activeKey);
                if (option) pick(option);
              } else if (event.key === 'Escape' && query) {
                event.stopPropagation();
                setQuery('');
              } else return;
              event.preventDefault();
            }}
          />
        </div>

        <div
          ref={listRef}
          className="editorfont-list"
          id={`${id}-list`}
          role="listbox"
          aria-labelledby={`${id}-label`}
        >
          {sections.map((entry) => (
            <div key={entry.title} role="group" aria-label={entry.title}>
              <div className="editorfont-group" aria-hidden>
                {entry.title}
              </div>
              {entry.options.map((option) => {
                const selected = !option.custom && option.family.toLocaleLowerCase() === current;
                return (
                  <div
                    key={option.key}
                    ref={(element) => {
                      if (element) optionRefs.current.set(option.key, element);
                      else optionRefs.current.delete(option.key);
                    }}
                    id={`${id}-${option.key}`}
                    role="option"
                    aria-selected={selected}
                    className="editorfont-option"
                    data-active={option.key === activeKey ? true : undefined}
                    onPointerMove={() => {
                      if (option.key !== activeKey) setActive(option.key);
                    }}
                    onClick={() => pick(option)}
                  >
                    <span className="editorfont-tick" aria-hidden>
                      {selected ? <Icon icon={ICONS.done} size="xs" /> : null}
                    </span>
                    <span
                      className="editorfont-name"
                      style={{ fontFamily: previewStack(option.family) }}
                    >
                      {option.custom
                        ? t('„{name}“ verwenden', { name: option.family })
                        : option.family}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {system === null ? (
            <p className="editorfont-note">{t('Schriften des Systems werden gelesen …')}</p>
          ) : null}
          {system !== null && options.length === 0 ? (
            <p className="editorfont-note">{t('Nichts gefunden.')}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
