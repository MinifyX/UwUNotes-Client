/**
 * The word count in the status bar, and the popover behind it.
 *
 * ## When it counts
 *
 * Like the caret position in `StatusBar.tsx`: when the active document's state
 * changes (`subscribeDocState`) or another tab becomes the active one, and not
 * otherwise. The look only compares two references — CodeMirror's `Text` and
 * selection are immutable, so "did anything change" is `!==` — and the
 * counting itself waits until typing pauses. A short document is counted almost at once; a long one
 * waits longer, and anything past `EXACT_LIMIT` is estimated from a sample
 * (`lib/text-stats.ts`), so a 50 MB log never costs more than a small file
 * does. Moving the caret alone never recounts the document, only the
 * selection.
 */

import type { EditorState, Text } from '@codemirror/state';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { locale, N_, t } from '../lib/i18n';
import {
  estimateStats,
  EXACT_LIMIT,
  minutesFor,
  READING_WPM,
  SAMPLE_SIZE,
  SPEAKING_WPM,
  textStats,
  type TextStats,
} from '../lib/text-stats';
import { getDoc, subscribeDocState, subscribeDocuments } from '../lib/documents';
import { focusActiveView } from '../lib/views';
import { activeDocId, subscribeWorkspace } from '../lib/workspace';
import { usePopoverPosition } from './LanguagePicker';

export type LiveStats = {
  doc: TextStats;
  /** `null` when nothing is selected. */
  selection: TextStats | null;
};

/** Under this many characters the count follows typing almost immediately. */
const SMALL_DOC = 50_000;
const SMALL_DELAY_MS = 80;
const LARGE_DELAY_MS = 350;
/** A selection being dragged out changes every frame; count where it stops. */
const SELECTION_DELAY_MS = 120;

function docStats(doc: Text): TextStats {
  if (doc.length <= EXACT_LIMIT) return textStats(doc.toString());
  return estimateStats(doc.sliceString(0, SAMPLE_SIZE), doc.length, doc.lines);
}

/**
 * The selection, all ranges together. Lines are counted per range the way the
 * caret label counts them — lines touched, not newlines inside — and ranges
 * are joined by a blank line so two selected halves of one paragraph are not
 * glued into a single word at the seam.
 */
function selectionStats(state: EditorState): TextStats | null {
  const ranges = state.selection.ranges.filter((range) => !range.empty);
  if (ranges.length === 0) return null;
  let length = 0;
  let lines = 0;
  for (const range of ranges) {
    length += range.to - range.from;
    lines += state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number + 1;
  }
  if (length > EXACT_LIMIT) {
    const first = ranges[0]!;
    const sample = state.sliceDoc(first.from, Math.min(first.to, first.from + SAMPLE_SIZE));
    return { ...estimateStats(sample, length, lines), lines };
  }
  const text = ranges.map((range) => state.sliceDoc(range.from, range.to)).join('\n\n');
  return { ...textStats(text), lines };
}

/** The active document's state, from the store: it holds every transaction. */
export function activeState(): EditorState | undefined {
  const id = activeDocId();
  return id ? getDoc(id)?.state : undefined;
}

/**
 * Calls `look` whenever the active document's state may have changed: its own
 * transactions, another tab or pane becoming active, a document closing. Not
 * on a timer and not per frame — an idle window costs nothing.
 */
export function followActiveState(look: () => void): () => void {
  const stopState = subscribeDocState((id) => {
    if (id === activeDocId()) look();
  });
  const stopWorkspace = subscribeWorkspace(look);
  const stopDocuments = subscribeDocuments(look);
  return () => {
    stopState();
    stopWorkspace();
    stopDocuments();
  };
}

/** Counts for the active editor, or `null` while switched off or with no editor. */
export function useTextStats(enabled: boolean): LiveStats | null {
  const [stats, setStats] = useState<LiveStats | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      return;
    }
    let timer = 0;
    let seenDoc: Text | null = null;
    let seenSelection: EditorState['selection'] | null = null;
    // The document's counts are kept per `Text`, so a selection change reuses
    // them instead of counting the whole file again.
    let countedDoc: Text | null = null;
    let counted: TextStats | null = null;

    const count = () => {
      const state = activeState();
      if (!state) return;
      if (countedDoc !== state.doc) {
        counted = docStats(state.doc);
        countedDoc = state.doc;
      }
      setStats({ doc: counted!, selection: selectionStats(state) });
    };

    const look = () => {
      const state = activeState();
      if (!state) {
        if (seenDoc !== null) {
          seenDoc = null;
          seenSelection = null;
          window.clearTimeout(timer);
          setStats(null);
        }
        return;
      }
      const { doc, selection } = state;
      if (doc === seenDoc && seenSelection !== null && selection.eq(seenSelection)) return;
      const docChanged = doc !== seenDoc;
      seenDoc = doc;
      seenSelection = selection;
      window.clearTimeout(timer);
      const delay = !docChanged
        ? SELECTION_DELAY_MS
        : doc.length < SMALL_DOC
          ? SMALL_DELAY_MS
          : LARGE_DELAY_MS;
      timer = window.setTimeout(count, delay);
    };

    look();
    const stop = followActiveState(look);
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [enabled]);

  return stats;
}

/* ── Words ─────────────────────────────────────────────── */

const number = (value: number) => value.toLocaleString(locale());

/**
 * The plural fragments. Built up from pieces rather than one sentence per
 * combination because a selection label has three counts in it, and eight
 * whole sentences per language for "1 Wort, 1 Zeichen, 1 Zeile" and its
 * relatives would be eight chances to translate them inconsistently.
 */
function words(count: number): string {
  return count === 1 ? t('1 Wort') : t('{count} Wörter', { count: number(count) });
}

function characters(count: number): string {
  return count === 1 ? t('1 Zeichen') : t('{count} Zeichen', { count: number(count) });
}

function lines(count: number): string {
  return count === 1 ? t('1 Zeile') : t('{count} Zeilen', { count: number(count) });
}

/** What the status bar item says: the document's words, or the whole selection. */
export function wordCountLabel(stats: LiveStats): string {
  const { selection } = stats;
  if (selection) {
    return t('{words}, {characters}, {lines} ausgewählt', {
      words: words(selection.words),
      characters: characters(selection.characters),
      lines: lines(selection.lines),
    });
  }
  return stats.doc.approximate
    ? t('≈ {words}', { words: words(stats.doc.words) })
    : words(stats.doc.words);
}

function duration(minutes: number): string {
  if (minutes <= 0) return '—';
  if (minutes < 60) return t('{count} Min.', { count: minutes });
  return t('{hours} Std. {minutes} Min.', {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

/* ── The popover ───────────────────────────────────────── */

type Row = { label: string; value: (stats: TextStats) => string };

/** `N_()` because the list is built before a language is; `t()` where it is drawn. */
const ROWS: Row[] = [
  { label: N_('Zeilen'), value: (stats) => number(stats.lines) },
  { label: N_('Wörter'), value: (stats) => number(stats.words) },
  { label: N_('Zeichen mit Leerzeichen'), value: (stats) => number(stats.characters) },
  { label: N_('Zeichen ohne Leerzeichen'), value: (stats) => number(stats.charactersNoSpaces) },
  { label: N_('Absätze'), value: (stats) => number(stats.paragraphs) },
  { label: N_('Lesezeit'), value: (stats) => duration(minutesFor(stats.words, READING_WPM)) },
  { label: N_('Sprechzeit'), value: (stats) => duration(minutesFor(stats.words, SPEAKING_WPM)) },
];

export type TextStatsPopoverProps = {
  stats: LiveStats;
  anchor: { x: number; y: number };
  onClose: () => void;
};

/**
 * Lines, words, characters, paragraphs and the two times, for the document
 * and — when there is one — the selection beside it. Live: it reads the same
 * counts the status bar does, so selecting more text with the popover open
 * updates it.
 */
export function TextStatsPopover({ stats, anchor, onClose }: TextStatsPopoverProps) {
  const popover = useRef<HTMLDivElement | null>(null);
  const placement = usePopoverPosition(popover as RefObject<HTMLElement>, anchor);

  // Focus inside, so Escape reaches it without a click first.
  useEffect(() => {
    popover.current?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!popover.current?.contains(event.target)) onClose();
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [onClose]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
    focusActiveView();
  };

  const { doc, selection } = stats;
  const approximate = doc.approximate || selection?.approximate === true;

  return (
    <div
      className="textstats"
      role="dialog"
      aria-label={t('Textstatistik')}
      ref={popover}
      style={placement}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <h3 className="textstats-title">{t('Textstatistik')}</h3>
      <table className="textstats-table">
        <thead>
          <tr>
            <td />
            <th scope="col">{t('Dokument')}</th>
            {selection ? <th scope="col">{t('Auswahl')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row">{t(row.label)}</th>
              <td>{row.value(doc)}</td>
              {selection ? <td>{row.value(selection)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="textstats-note">
        {t('Lesezeit bei {reading} Wörtern pro Minute, Sprechzeit bei {speaking}.', {
          reading: READING_WPM,
          speaking: SPEAKING_WPM,
        })}
      </p>
      {approximate ? (
        <p className="textstats-note">
          {t('Sehr große Datei: Wörter, Zeichen und Absätze sind geschätzt.')}
        </p>
      ) : null}
    </div>
  );
}
