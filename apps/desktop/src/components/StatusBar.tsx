/**
 * The strip along the bottom, and the reason this editor exists.
 *
 * Every item on the right is a control, not a label: encoding, line endings,
 * language, indentation and the caret position are each one click from being
 * changed. Most editors bury these in a submenu three levels down, and the ones
 * that show them show them as text you cannot touch.
 *
 * The left half is the transient one — a file that changed underneath us, a
 * file that mixed its line endings, or Nyu noticing that something saved. One
 * message at a time, most urgent first, because a status bar that stacks
 * notices is a status bar nobody reads.
 *
 * ## How it follows the caret
 *
 * By listening to the store: every editor transaction is written back to
 * `lib/documents.ts`, which says so through `subscribeDocState`, and switching
 * tabs or panes goes through the workspace. Each time the active document's
 * state is read, five numbers compared to the last five, and React only hears
 * about it when one of them moved. No extension in every document, and no
 * loop: a window nobody types into does no work at all.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { openDialog } from '../lib/commands';
import { documentsVersion, getMeta, subscribeDocuments, type DocId } from '../lib/documents';
import { describe, EOL_LABELS, EOLS, eolName } from '../lib/encodings';
import { setDocEol } from '../lib/files';
import { refreshGitStatus, useGitBranch } from '../lib/git';
import { t, useLanguage } from '../lib/i18n';
import { TAB_SIZES, updateSettings, useSettings } from '../lib/settings';
import { activeDocId, useWorkspace } from '../lib/workspace';
import { PLAIN_TEXT, resolveLanguage } from '../editor/languages';
import { NyuCompanion } from './nyu/companion/NyuCompanion';
import { PomodoroItem } from './nyu/companion/PomodoroItem';
import { pickGreeting } from './nyu/greetings';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { EncodingMenu } from './EncodingMenu';
import { Icon } from './Icon';
import { LanguagePicker } from './LanguagePicker';
import {
  activeState,
  followActiveState,
  TextStatsPopover,
  useTextStats,
  wordCountLabel,
} from './TextStats';

/** Long enough to read, short enough to be gone before it is in the way. */
const SAVED_MESSAGE_MS = 4_000;

/**
 * How long a just-closed menu refuses to be opened again by the same button.
 *
 * A menu closes on the pointerdown that lands outside it, and the click that
 * follows that pointerdown is the one that would toggle it back open — so
 * without this, clicking the open menu's own button reopens it and the menu
 * appears to be stuck.
 */
const REOPEN_GUARD_MS = 300;

/** For an item with nothing to show: no document, or no caret yet. */
const NOTHING = '—';

type Caret = {
  line: number;
  column: number;
  /** Characters inside the selection, across all ranges. */
  selected: number;
  /** Lines the selection touches; 1 when it stays on one. */
  selectedLines: number;
};

/**
 * The caret and selection of whichever editor is active.
 *
 * `null` when there is no editor — an empty pane, or the moment before the
 * first document mounts.
 */
function useCaret(): Caret | null {
  const [caret, setCaret] = useState<Caret | null>(null);

  useEffect(() => {
    let previous = '';

    const look = () => {
      const state = activeState();
      if (!state) {
        if (previous !== '') {
          previous = '';
          setCaret(null);
        }
        return;
      }

      const main = state.selection.main;
      const signature = `${main.anchor}:${main.head}:${state.selection.ranges.length}:${state.doc.length}`;
      if (signature === previous) return;
      previous = signature;

      const line = state.doc.lineAt(main.head);
      const selected = state.selection.ranges.reduce(
        (total, range) => total + range.to - range.from,
        0,
      );
      setCaret({
        line: line.number,
        column: main.head - line.from + 1,
        selected,
        selectedLines: state.doc.lineAt(main.to).number - state.doc.lineAt(main.from).number + 1,
      });
    };

    look();
    return followActiveState(look);
  }, []);

  return caret;
}

/**
 * Nyu's line after a save, for a few seconds.
 *
 * A save is not an event anybody announces, so it is spotted here: the dirty
 * flag going from set to clear on a document that has a path is a write that
 * went through. A reload clears it too, and being congratulated for a reload is
 * a small enough sin to live with.
 */
function useSavedMessage(docId: DocId | null, dirty: boolean): string | null {
  const [message, setMessage] = useState<string | null>(null);
  const wasDirty = useRef(false);
  const forDoc = useRef<DocId | null>(null);
  // The timer outlives this effect on purpose: typing again a keystroke after
  // saving re-runs the effect, and a timer cleared by that cleanup would leave
  // the message on screen for the rest of the session.
  const timer = useRef(0);

  useEffect(() => {
    const switched = forDoc.current !== docId;
    forDoc.current = docId;
    const saved = !switched && wasDirty.current && !dirty;
    wasDirty.current = dirty;
    if (!saved) return;

    window.clearTimeout(timer.current);
    // `pickGreeting` returns nothing when the tone is set to neutral, and the
    // plain sentence is what that setting is asking for.
    setMessage(pickGreeting('saved') || t('Gespeichert.'));
    timer.current = window.setTimeout(() => setMessage(null), SAVED_MESSAGE_MS);
  }, [docId, dirty]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return message;
}

type Popover = 'language' | 'encoding' | 'eol' | 'indent' | 'stats' | null;

export function StatusBar() {
  useLanguage();
  useWorkspace();
  useSyncExternalStore(subscribeDocuments, documentsVersion);
  const settings = useSettings();
  const branch = useGitBranch();
  const caret = useCaret();
  const stats = useTextStats(settings.statusWordCount);

  const docId = activeDocId();
  const meta = docId ? getMeta(docId) : undefined;
  const savedMessage = useSavedMessage(docId, meta?.dirty ?? false);

  const [popover, setPopover] = useState<Popover>(null);
  // Where the menus that this component owns should open: just above the item
  // that was clicked, since there is never room below the bottom edge.
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const lastClosed = useRef<{ which: Popover; at: number }>({ which: null, at: 0 });

  const close = (which: Popover) => {
    lastClosed.current = { which, at: performance.now() };
    setPopover(null);
  };

  const toggle = (which: Exclude<Popover, null>, element: HTMLElement) => {
    if (popover === which) return close(which);
    const guard = lastClosed.current;
    if (guard.which === which && performance.now() - guard.at < REOPEN_GUARD_MS) return;
    const box = element.getBoundingClientRect();
    setAnchor({ x: box.left, y: box.top - 4 });
    setPopover(which);
  };

  const language = meta ? resolveLanguage(meta) : null;
  // No grammar matched is not the same as "we have no idea": the editor is
  // treating the file as plain text, so that is what the field should say. A
  // brand new buffer called `Neu 1` is the common case, and "Unbekannt" there
  // reads like something went wrong.
  const languageName = (language ?? PLAIN_TEXT).name;

  return (
    <footer className="statusbar">
      <NyuCompanion />
      <div className="statusbar-message" aria-live="polite">
        {meta?.staleOnDisk ? (
          <span className="statusbar-notice" data-tone="warning">
            <Icon name="warning" size={13} />
            {t('Auf dem Datenträger geändert')}
          </span>
        ) : savedMessage ? (
          <span className="statusbar-notice" data-tone="calm">
            {savedMessage}
          </span>
        ) : meta?.mixedEol ? (
          <span className="statusbar-notice" data-tone="calm">
            {t('Gemischte Zeilenenden — gespeichert wird als {eol}', {
              eol: EOL_LABELS[meta.eol],
            })}
          </span>
        ) : null}
      </div>

      <div className="statusbar-items">
        <PomodoroItem />
        <button
          type="button"
          className="statusbar-item"
          onClick={() => openDialog('gotoLine')}
          disabled={!caret}
          title={t('Gehe zu Zeile…')}
        >
          {/* The word count says what is selected in more detail; with it on,
              the caret item goes back to being just the position. */}
          {caret ? caretLabel(caret, stats !== null) : NOTHING}
        </button>

        {stats ? (
          <button
            type="button"
            className="statusbar-item statusbar-words"
            aria-haspopup="dialog"
            aria-expanded={popover === 'stats'}
            onClick={(event) => toggle('stats', event.currentTarget)}
            title={t('Textstatistik')}
          >
            {wordCountLabel(stats)}
          </button>
        ) : null}

        <button
          type="button"
          className="statusbar-item"
          disabled={!meta}
          aria-haspopup="menu"
          aria-expanded={popover === 'indent'}
          onClick={(event) => toggle('indent', event.currentTarget)}
          title={t('Einrückung')}
        >
          {settings.insertSpaces
            ? t('Leerzeichen: {count}', { count: settings.tabSize })
            : t('Tabs: {count}', { count: settings.tabSize })}
        </button>

        <button
          type="button"
          className="statusbar-item"
          disabled={!meta}
          aria-haspopup="menu"
          aria-expanded={popover === 'eol'}
          onClick={(event) => toggle('eol', event.currentTarget)}
          title={t('Zeilenenden')}
        >
          {meta ? EOL_LABELS[meta.eol] : NOTHING}
        </button>

        <button
          type="button"
          className="statusbar-item"
          disabled={!meta}
          aria-haspopup="menu"
          aria-expanded={popover === 'encoding'}
          onClick={(event) => toggle('encoding', event.currentTarget)}
          title={t('Kodierung')}
        >
          {meta ? describe(meta.encoding, meta.bom) : NOTHING}
        </button>

        <button
          type="button"
          className="statusbar-item"
          disabled={!meta}
          aria-haspopup="menu"
          aria-expanded={popover === 'language'}
          onClick={(event) => toggle('language', event.currentTarget)}
          title={t('Sprache')}
        >
          {meta ? languageName : NOTHING}
        </button>

        {branch ? (
          <button
            type="button"
            className="statusbar-item statusbar-branch"
            onClick={() => refreshGitStatus()}
            title={t('Git-Status aktualisieren')}
          >
            <Icon name="gitBranch" size={13} />
            <span className="statusbar-branch-name">{branch}</span>
          </button>
        ) : null}
      </div>

      {popover === 'indent' ? (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          grow="up"
          label={t('Einrückung')}
          items={indentItems(settings.tabSize, settings.insertSpaces)}
          onClose={() => close('indent')}
        />
      ) : null}

      {popover === 'eol' && docId && meta ? (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          grow="up"
          label={t('Zeilenenden')}
          items={EOLS.map((eol) => ({
            id: eol,
            label: eolName(eol),
            checked: meta.eol === eol,
            run: () => setDocEol(docId, eol),
          }))}
          onClose={() => close('eol')}
        />
      ) : null}

      {popover === 'encoding' && docId ? (
        <EncodingMenu docId={docId} anchor={anchor} onClose={() => close('encoding')} />
      ) : null}
      {popover === 'stats' && stats ? (
        <TextStatsPopover stats={stats} anchor={anchor} onClose={() => close('stats')} />
      ) : null}
      {popover === 'language' && docId ? (
        <LanguagePicker docId={docId} anchor={anchor} onClose={() => close('language')} />
      ) : null}
    </footer>
  );
}

/**
 * `Z. 12, Sp. 4`, and what is selected when something is.
 *
 * Three whole sentences rather than one built from fragments: a translator
 * needs to see the comma and the middle dot in context to punctuate the other
 * language correctly, and German and English do not agree about either.
 */
function caretLabel(caret: Caret, positionOnly = false): string {
  if (caret.selected === 0 || positionOnly) {
    return t('Z. {line}, Sp. {column}', { line: caret.line, column: caret.column });
  }
  if (caret.selectedLines > 1) {
    return t('Z. {line}, Sp. {column} · {count} Zeichen in {lines} Zeilen', {
      line: caret.line,
      column: caret.column,
      count: caret.selected,
      lines: caret.selectedLines,
    });
  }
  return t('Z. {line}, Sp. {column} · {count} Zeichen', {
    line: caret.line,
    column: caret.column,
    count: caret.selected,
  });
}

/** Tab width and tabs-versus-spaces in one short menu, because they are one decision. */
function indentItems(tabSize: number, insertSpaces: boolean): ContextMenuItem[] {
  const items: ContextMenuItem[] = TAB_SIZES.map((size) => ({
    id: `size-${size}`,
    label: t('Breite {count}', { count: size }),
    checked: tabSize === size,
    run: () => updateSettings({ tabSize: size }),
  }));
  items.push({
    id: 'spaces',
    label: t('Mit Leerzeichen einrücken'),
    checked: insertSpaces,
    run: () => updateSettings({ insertSpaces: true }),
  });
  items.push({
    id: 'tabs',
    label: t('Mit Tabs einrücken'),
    checked: !insertSpaces,
    run: () => updateSettings({ insertSpaces: false }),
  });
  return items;
}
