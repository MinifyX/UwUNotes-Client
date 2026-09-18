/**
 * The encoding, the byte order mark and the line endings for one document.
 *
 * The whole reason this app exists is in the first two sections, and they are
 * two sections and not one list on purpose:
 *
 * - **Erneut öffnen mit** throws away what is in the buffer and decodes the
 *   bytes on disk again. For a file that came out as question marks because
 *   the guess was wrong.
 * - **Konvertieren zu** leaves the text exactly as it is and changes what will
 *   be written next time. For a file that is fine and has to go somewhere that
 *   wants Windows-1252.
 *
 * Every editor that puts those two in one menu teaches its users to lose work
 * once and then never touch the menu again. So they are separated, labelled
 * with what they do to the text, and the destructive one needs a second click.
 *
 * A popover, positioned by the status bar that opens it; see
 * {@link usePopoverPosition} for the geometry.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { Eol } from '../lib/api';
import { documentsVersion, getMeta, subscribeDocuments, type DocId } from '../lib/documents';
import {
  ENCODINGS,
  encodingGroupName,
  encodingName,
  EOLS,
  eolName,
  describe,
  type EncodingEntry,
  type EncodingGroup,
} from '../lib/encodings';
import { reopenWithEncoding, setDocBom, setDocEncoding, setDocEol } from '../lib/files';
import { t } from '../lib/i18n';
import { activeDocId } from '../lib/workspace';
// Same geometry as the language popover, which is the other thing the status
// bar opens. Neither file is a good home for a third module, and a second copy
// of the same twelve lines is worse than one import across the pair.
import { usePopoverPosition } from './LanguagePicker';

export type EncodingMenuProps = {
  /** Defaults to the document in the active pane. */
  docId?: DocId;
  /** Viewport coordinates of the top-left corner of the control that opened it. */
  anchor?: { x: number; y: number };
  onClose: () => void;
};

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled])';

export function EncodingMenu({ docId, anchor, onClose }: EncodingMenuProps) {
  useSyncExternalStore(subscribeDocuments, documentsVersion);
  const forDoc = docId ?? activeDocId();
  const meta = forDoc ? getMeta(forDoc) : undefined;

  const [reopenAs, setReopenAs] = useState(meta?.encoding ?? 'UTF-8');
  const popover = useRef<HTMLDivElement | null>(null);
  const placement = usePopoverPosition(popover, anchor);
  const ids = useId();

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!popover.current?.contains(event.target)) onClose();
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [onClose]);

  // Both at once, so everything below sees a document id and not a maybe-null.
  if (!forDoc || !meta) return null;

  const onDisk = meta.path !== null;
  // A byte order mark is a Unicode thing. Offering it for Shift-JIS would be
  // offering to write three bytes that nothing on earth expects.
  const bomApplies = /^utf/i.test(meta.encoding);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = [...(popover.current?.querySelectorAll(FOCUSABLE) ?? [])].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    if (stops.length === 0) return;
    const at = stops.findIndex((element) => element === document.activeElement);
    const next = stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <div
      className="encmenu"
      role="dialog"
      aria-label={t('Kodierung und Zeilenenden')}
      ref={popover}
      style={placement}
      onKeyDown={onKeyDown}
    >
      <p className="encmenu-current">
        {t('Zurzeit: {encoding}, {eol}', {
          encoding: describe(meta.encoding, meta.bom),
          eol: eolName(meta.eol),
        })}
      </p>

      <section className="encmenu-section encmenu-section-reopen">
        <h3 className="encmenu-title" id={`${ids}-reopen`}>
          {t('Erneut öffnen mit')}
        </h3>
        <p className="encmenu-note encmenu-note-danger" id={`${ids}-reopen-note`}>
          {t(
            'Liest die Datei noch einmal vom Datenträger. Ungespeicherte Änderungen gehen dabei verloren — danach wird nachgefragt.',
          )}
        </p>
        <div className="encmenu-row">
          <EncodingSelect
            id={`${ids}-reopen-select`}
            label={t('Kodierung zum erneuten Öffnen')}
            value={reopenAs}
            disabled={!onDisk}
            describedBy={`${ids}-reopen-note`}
            onChange={setReopenAs}
          />
          <button
            type="button"
            className="encmenu-reopen-button"
            disabled={!onDisk}
            aria-describedby={`${ids}-reopen-note`}
            onClick={() => {
              void reopenWithEncoding(forDoc, reopenAs);
              onClose();
            }}
          >
            {t('Erneut öffnen')}
          </button>
        </div>
        {!onDisk && (
          <p className="encmenu-note">
            {t('Diese Datei war noch nie auf dem Datenträger, es gibt nichts neu zu lesen.')}
          </p>
        )}
      </section>

      <section className="encmenu-section encmenu-section-convert">
        <h3 className="encmenu-title" id={`${ids}-convert`}>
          {t('Konvertieren zu')}
        </h3>
        <p className="encmenu-note" id={`${ids}-convert-note`}>
          {t(
            'Der Text bleibt unverändert. Erst beim nächsten Speichern werden andere Bytes geschrieben.',
          )}
        </p>
        <EncodingSelect
          id={`${ids}-convert-select`}
          label={t('Kodierung zum Speichern')}
          value={meta.encoding}
          describedBy={`${ids}-convert-note`}
          onChange={(encoding) => setDocEncoding(forDoc, encoding)}
        />
      </section>

      <section className="encmenu-section encmenu-section-bom">
        <div className="encmenu-row">
          <span className="encmenu-title" id={`${ids}-bom`}>
            {t('Byte-Order-Mark')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={meta.bom}
            aria-labelledby={`${ids}-bom`}
            aria-describedby={`${ids}-bom-note`}
            className="encmenu-switch"
            disabled={!bomApplies}
            onClick={() => setDocBom(forDoc, !meta.bom)}
          >
            <span className="encmenu-switch-knob" aria-hidden="true" />
          </button>
        </div>
        <p className="encmenu-note" id={`${ids}-bom-note`}>
          {bomApplies
            ? t('Drei Bytes am Dateianfang, die die Kodierung ankündigen.')
            : t('Nur bei Unicode-Kodierungen sinnvoll.')}
        </p>
      </section>

      <fieldset className="encmenu-section encmenu-section-eol">
        <legend className="encmenu-title">{t('Zeilenenden')}</legend>
        <div className="encmenu-choice">
          {EOLS.map((eol: Eol) => (
            <label
              key={eol}
              className={`encmenu-choice-option${
                meta.eol === eol ? ' encmenu-choice-option-active' : ''
              }`}
            >
              <input
                type="radio"
                className="encmenu-choice-input"
                name={`${ids}-eol`}
                value={eol}
                checked={meta.eol === eol}
                onChange={() => setDocEol(forDoc, eol)}
              />
              <span className="encmenu-choice-label">{eolName(eol)}</span>
            </label>
          ))}
        </div>
        {meta.mixedEol && (
          <p className="encmenu-note encmenu-note-warning">
            {t(
              'Die Datei mischt Zeilenenden. Beim Speichern wird eines davon für alle Zeilen genommen.',
            )}
          </p>
        )}
      </fieldset>
    </div>
  );
}

function EncodingSelect({
  id,
  label,
  value,
  disabled,
  describedBy,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  describedBy: string;
  onChange: (value: string) => void;
}) {
  // A label the detector produced is not always in the menu; dropping it would
  // silently change the document's encoding just by opening this popover.
  const exotic = !ENCODINGS.some((entry) => entry.label === value);
  return (
    <select
      id={id}
      className="encmenu-select"
      aria-label={label}
      aria-describedby={describedBy}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {exotic && <option value={value}>{encodingName(value)}</option>}
      {groupEncodings().map(([group, entries]) => (
        <optgroup key={group} label={encodingGroupName(group)}>
          {entries.map((entry) => (
            <option key={entry.label} value={entry.label}>
              {entry.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
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
