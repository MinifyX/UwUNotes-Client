/**
 * Which grammar this one document is highlighted with.
 *
 * A popover rather than a dialog, because it hangs off the language field in
 * the status bar and the status bar is a control panel, not a label. It takes
 * the position of the thing that opened it and puts itself above it — the
 * status bar is at the bottom of the window, so a menu that opened downwards
 * would open off the screen.
 *
 * The choice is per document and is remembered in the session, which is why it
 * is written through `patchMeta()` and not into `Settings`: "this one log file
 * is not really JavaScript" is a fact about the file, not a preference.
 *
 * The caller keeps the focus it had: this component puts the keyboard in its
 * search field while it is open and calls `onClose` on the way out, and the
 * status bar is expected to focus its own button again afterwards.
 *
 * `docId` and `anchor` are optional because the status bar opens this for
 * whatever is active, from a button it has already measured for its own menus.
 * Passing them is for anything that wants a different document or a different
 * corner; leaving them off means "the active file, above the status bar".
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  documentsVersion,
  getMeta,
  patchMeta,
  subscribeDocuments,
  type DocId,
} from '../lib/documents';
import { t } from '../lib/i18n';
import { activeDocId } from '../lib/workspace';
import { LANGUAGES, languageForFileName, PLAIN_TEXT } from '../editor/languages';
import { applyDocLanguage } from '../editor/setup';

export type LanguagePickerProps = {
  /** Defaults to the document in the active pane. */
  docId?: DocId;
  /** Viewport coordinates of the top-left corner of the control that opened it. */
  anchor?: { x: number; y: number };
  onClose: () => void;
};

/** Distance kept from the anchor and from the window's edges. */
const GAP = 6;

export function LanguagePicker({ docId, anchor, onClose }: LanguagePickerProps) {
  // Meta can change underneath an open popover — a save renames an untitled
  // buffer, and with it what "automatisch" would detect.
  useSyncExternalStore(subscribeDocuments, documentsVersion);

  const forDoc = docId ?? activeDocId();
  const meta = forDoc ? getMeta(forDoc) : undefined;
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const popover = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  const detected = meta ? languageForFileName(meta.path ?? meta.name) : null;
  const chosen = meta?.languageOverride ?? null;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? LANGUAGES.filter(
          (entry) =>
            entry.name.toLowerCase().includes(needle) ||
            entry.extensions.some((extension) => extension.startsWith(needle)),
        )
      : LANGUAGES;
    // Whatever the search says, "decide for me" stays reachable: it is the way
    // back out of a wrong choice.
    return [null, ...matching];
  }, [query]);

  const active = Math.min(index, Math.max(0, rows.length - 1));

  useEffect(() => {
    const element = list.current?.children.item(active);
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' });
  }, [active, rows.length]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!popover.current?.contains(event.target)) onClose();
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [onClose]);

  // No anchor is a legitimate answer, not a missing one: see the hook.
  const placement = usePopoverPosition(popover, anchor);

  const choose = (languageId: string | null) => {
    // `forDoc` and not `docId`: with no document there is nothing to set, and
    // with no `docId` prop the picker is acting on whatever is active.
    if (!forDoc) return onClose();
    patchMeta(forDoc, { languageOverride: languageId });
    void applyDocLanguage(forDoc);
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setIndex(rows.length === 0 ? 0 : (active + 1) % rows.length);
        return;
      case 'ArrowUp':
        event.preventDefault();
        setIndex(rows.length === 0 ? 0 : (active - 1 + rows.length) % rows.length);
        return;
      case 'Home':
        event.preventDefault();
        setIndex(0);
        return;
      case 'End':
        event.preventDefault();
        setIndex(Math.max(0, rows.length - 1));
        return;
      case 'Enter': {
        event.preventDefault();
        const row = rows[active];
        if (row !== undefined) choose(row === null ? null : row.id);
        return;
      }
      case 'Escape':
      case 'Tab':
        // Tab has nowhere to go inside a popover, and leaving it open behind
        // the editor would be a menu nobody can see and nobody can close.
        event.preventDefault();
        onClose();
        return;
      default:
        return;
    }
  };

  return (
    <div
      className="langpicker"
      role="dialog"
      aria-label={t('Sprache wählen')}
      ref={popover}
      style={placement}
      onKeyDown={onKeyDown}
    >
      <input
        className="langpicker-search"
        value={query}
        autoFocus
        spellCheck={false}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={rows[active] !== undefined ? `${listId}-${active}` : undefined}
        aria-label={t('Sprache suchen')}
        placeholder={t('Sprache suchen')}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
      />

      <ul className="langpicker-list" id={listId} role="listbox" ref={list}>
        {rows.map((entry, position) => {
          const selected = entry === null ? chosen === null : chosen === entry.id;
          return (
            <li
              key={entry === null ? 'auto' : entry.id}
              id={`${listId}-${position}`}
              role="option"
              aria-selected={selected}
              className={[
                'langpicker-row',
                position === active ? 'langpicker-row-active' : '',
                selected ? 'langpicker-row-current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseMove={() => setIndex(position)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(entry === null ? null : entry.id);
              }}
            >
              <span className="langpicker-name">
                {entry === null ? t('Automatisch erkennen') : entry.name}
              </span>
              {entry === null && (
                <span className="langpicker-detected">{detected?.name ?? PLAIN_TEXT.name}</span>
              )}
            </li>
          );
        })}

        {rows.length === 1 && (
          <li className="langpicker-nothing" role="presentation">
            {t('Keine Sprache passt dazu.')}
          </li>
        )}
      </ul>
    </div>
  );
}

/**
 * Puts a popover above its anchor and inside the window.
 *
 * Measured after layout rather than guessed, because the width is the
 * stylesheet's business and this file is not allowed to know it. The first
 * frame is drawn at the anchor and corrected before the browser paints, which
 * is what `useLayoutEffect` is for.
 *
 * With no anchor it falls back to the top edge of the bar it was rendered
 * into — the status bar opens both popovers as its own children, and "just
 * above whatever opened me, on the right" is the only sensible default there.
 *
 * The numbers are viewport coordinates, so the stylesheet has to position the
 * popover against the viewport. Same arrangement as `ContextMenu.tsx`.
 */
export function usePopoverPosition(
  element: RefObject<HTMLElement>,
  anchor?: { x: number; y: number },
): { left: string; bottom: string } {
  const [position, setPosition] = useState({ left: anchor?.x ?? 0, bottom: GAP });

  useLayoutEffect(() => {
    const popover = element.current;
    const width = popover?.getBoundingClientRect().width ?? 0;
    const host = popover?.closest('footer')?.getBoundingClientRect();
    const x = anchor?.x ?? window.innerWidth;
    const y = anchor?.y ?? host?.top ?? window.innerHeight;
    setPosition({
      left: Math.max(GAP, Math.min(x, window.innerWidth - width - GAP)),
      bottom: Math.max(GAP, window.innerHeight - y + GAP),
    });
  }, [anchor?.x, anchor?.y, element]);

  return { left: `${position.left}px`, bottom: `${position.bottom}px` };
}
