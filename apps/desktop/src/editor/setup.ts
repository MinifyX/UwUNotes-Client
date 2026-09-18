/**
 * The extension stack, and the one place that changes it.
 *
 * ## Why compartments
 *
 * A document's text, selection, undo history *and configuration* all live in
 * its `EditorState`, and an `EditorState` is immutable: the only way in is a
 * transaction. So "the user changed the font size" is not an assignment
 * anywhere — it is a transaction dispatched into every open document, one at a
 * time. A `Compartment` is the placeholder that makes that possible: the stack
 * is built once with two holes in it, and a reconfigure effect swaps what sits
 * in a hole without disturbing anything else in the state.
 *
 * Two holes, because they change for different reasons. `languageCompartment`
 * changes per document, when a file is opened or its language is picked by
 * hand. `settingsCompartment` changes for every document at once, when a
 * preference changes.
 *
 * ## The part that is easy to get wrong
 *
 * {@link reconfigureAllDocs} walks *every* document in the store, not the ones
 * currently on screen. A tab that is open in a background pane, or not
 * displayed at all, still holds its own state with its own configuration in
 * it, and it will happily keep the old font forever. That bug does not look
 * like a bug when you write the code — it looks like one three days later,
 * when a user switches tabs and the window changes size for no reason.
 *
 * A document that *is* on screen is reconfigured through its `EditorView`,
 * because the view owns the authoritative state while it is mounted; anything
 * dispatched into the store copy would be overwritten by the next keystroke.
 *
 * What this module does not do: create views (the pane components do), or
 * decide what a setting means (that is `lib/settings.ts`).
 */

import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { history } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, indentUnit } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import { Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { allDocs, getDoc, setBaseExtensions, setDocState, type DocId } from '../lib/documents';
import { getSettings, subscribeSettings, type Settings } from '../lib/settings';
import { viewFor } from '../lib/views';
import { getWorkspace } from '../lib/workspace';
import { indentGuides, printMargin, whitespaceMarkers } from './decorations';
import { registerBuiltinPlugins } from './extensions/builtin';
import { enabledPluginIds, pluginExtensions, subscribePlugins } from './extensions/registry';
import { editorKeymap } from './keymap';
import { resolveLanguage } from './languages';
import { minimap } from './minimap';
import { caretAppearance } from './theme';
import { themeById } from './themes';

/** Per document: the grammar, loaded lazily and swapped in when it arrives. */
export const languageCompartment = new Compartment();

/** Every document at once: everything derived from `Settings`. */
export const settingsCompartment = new Compartment();

// Before any state exists, so the registry's order is the source order rather
// than whatever order Vite evaluated the imports in.
registerBuiltinPlugins();

/**
 * What never changes for the life of a document.
 *
 * Handed to `documents.setBaseExtensions()` so a state can be built from a
 * file without the session loader importing the whole CodeMirror stack. It is
 * a factory rather than a value because each state needs its own instances of
 * the stateful pieces — `history()` in particular, which would otherwise share
 * one undo stack across every open file.
 */
export function baseExtensions(): Extension {
  return [
    history(),
    // Multiple carets are opt-in in CodeMirror, and an editor without
    // Ctrl+click-to-add-a-caret feels broken to anyone coming from any other
    // editor written this decade.
    EditorState.allowMultipleSelections.of(true),
    dropCursor(),
    rectangularSelection(),
    indentOnInput(),
    highlightSpecialChars(),
    editorKeymap,
    languageCompartment.of([]),
    settingsCompartment.of(settingsExtensions(getSettings())),
  ];
}

/** A user font name goes into a CSS string, so it may not carry quotes out. */
function fontStack(family: string): string {
  const safe = family.replace(/["\\;{}]/g, '').trim();
  return safe ? `"${safe}", var(--uwu-mono)` : 'var(--uwu-mono)';
}

/**
 * Everything the settings decide, as one extension.
 *
 * Each feature is included only when it is on, rather than included always and
 * configured off. A disabled extension still costs a view plugin, a facet read
 * and a slot in the update cycle; leaving it out costs nothing, and the
 * compartment means switching it back on is one transaction away.
 */
export function settingsExtensions(settings: Settings): Extension {
  const extensions: Extension[] = [
    themeById(settings.editorTheme).extension,
    EditorState.tabSize.of(settings.tabSize),
    indentUnit.of(settings.insertSpaces ? ' '.repeat(settings.tabSize) : '\t'),
    // Typography lives here rather than in the theme: the theme is colour, and
    // it must not fight the user's font choice for specificity.
    typography(settings),
    // `cursorBlinkRate: 0` is CodeMirror's own way of saying "do not blink",
    // and it is a real accessibility setting — a blinking caret is a documented
    // migraine and seizure trigger, not a preference about taste.
    drawSelection({ cursorBlinkRate: settings.caretBlink ? 1200 : 0 }),
    caretAppearance(settings.caretStyle),
  ];

  if (settings.lineNumbers) {
    extensions.push(lineNumbers());
    // The fold arrows have no setting of their own on purpose: a fold column
    // floating next to text with no line-number column looks like a glitch.
    extensions.push(foldGutter());
  }
  if (settings.highlightActiveLine) {
    extensions.push(highlightActiveLine());
    if (settings.lineNumbers) extensions.push(highlightActiveLineGutter());
  }
  if (settings.wrap === 'window') extensions.push(EditorView.lineWrapping);
  if (settings.bracketMatching) extensions.push(bracketMatching());
  if (settings.closeBrackets) extensions.push(closeBrackets());
  if (settings.autocomplete) extensions.push(autocompletion());
  if (settings.highlightSelectionMatches) extensions.push(highlightSelectionMatches());
  if (settings.indentGuides) extensions.push(indentGuides);
  if (settings.showWhitespace) extensions.push(whitespaceMarkers);
  if (settings.printMargin) extensions.push(printMargin(settings.printMarginColumn));
  if (settings.minimap) extensions.push(minimap);

  extensions.push(pluginExtensions(enabledPluginIds()));
  return extensions;
}

/**
 * Reconfigures every open document, on screen or not.
 *
 * Cheap enough to call on any settings change: a reconfigure transaction
 * changes no text, so it costs a state rebuild and a redraw of the visible
 * lines, and documents in background tabs are not drawn at all.
 */
export function reconfigureAllDocs(): void {
  const effect = settingsCompartment.reconfigure(settingsExtensions(getSettings()));
  for (const doc of allDocs()) dispatchToDoc(doc.meta.id, [effect]);
}

/**
 * The grammar for a document, resolved and loaded.
 *
 * Safe to call as often as you like: the same language twice is a no-op, and a
 * newer call wins over one still waiting for its `import()` to land. Without
 * that generation check, opening a `.rs` file and immediately switching the
 * language to Python would leave you with whichever parser happened to
 * download second — which on a cold cache is the wrong one about half the
 * time.
 */
export async function applyDocLanguage(docId: DocId): Promise<void> {
  const doc = getDoc(docId);
  if (!doc) {
    forgetDoc(docId);
    return;
  }

  const entry = resolveLanguage(doc.meta);
  const wanted = entry?.id ?? '';
  const current = languageCompartment.get(doc.state);
  // The applied-extension check catches a document whose state was rebuilt
  // underneath us: same id, fresh empty compartment, so the cached id alone
  // would wrongly say "already done".
  if (appliedLanguages.get(docId) === wanted && current === appliedExtensions.get(docId)) return;

  const generation = (generations.get(docId) ?? 0) + 1;
  generations.set(docId, generation);

  let extension: Extension = [];
  if (entry) {
    try {
      extension = await entry.load();
    } catch (error) {
      // A grammar that fails to load leaves the file readable in plain text,
      // which is a far better outcome than an empty pane.
      console.error(`Language ${entry.id} failed to load`, error);
      extension = [];
    }
  }

  if (generations.get(docId) !== generation) return;
  if (!getDoc(docId)) {
    forgetDoc(docId);
    return;
  }

  appliedLanguages.set(docId, wanted);
  appliedExtensions.set(docId, extension);
  dispatchToDoc(docId, [languageCompartment.reconfigure(extension)]);
}

const generations = new Map<DocId, number>();
const appliedLanguages = new Map<DocId, string>();
const appliedExtensions = new Map<DocId, Extension>();

/** Called when a document turns out to be gone, so the maps do not grow forever. */
function forgetDoc(docId: DocId) {
  generations.delete(docId);
  appliedLanguages.delete(docId);
  appliedExtensions.delete(docId);
}

/**
 * The live view showing a document, if there is one.
 *
 * A document is in at most one pane, and only the pane's active tab has a
 * view — the others are states waiting their turn.
 */
function liveViewFor(docId: DocId): EditorView | undefined {
  const { panes } = getWorkspace();
  for (const [paneId, pane] of Object.entries(panes)) {
    if (pane.active === docId) return viewFor(paneId);
  }
  return undefined;
}

/**
 * Puts effects into a document wherever its authoritative state currently
 * lives: the view when it is mounted, the store when it is not.
 */
function dispatchToDoc(docId: DocId, effects: StateEffect<unknown>[]) {
  const view = liveViewFor(docId);
  if (view) {
    view.dispatch({ effects });
    return;
  }
  const doc = getDoc(docId);
  if (!doc) return;
  setDocState(docId, doc.state.update({ effects }).state);
}

/**
 * Typography, as its own theme layer.
 *
 * Keyed and kept, for the same reason as the caret and the print margin: a new
 * `EditorView.theme()` is a new class and a new rule in the document, and font
 * size is the setting people drag back and forth the most.
 */
const typographies = new Map<string, Extension>();

function typography(settings: Settings): Extension {
  const key = [
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.ligatures,
  ].join(' ');
  const known = typographies.get(key);
  if (known) return known;
  const built = buildTypography(settings);
  typographies.set(key, built);
  return built;
}

function buildTypography(settings: Settings): Extension {
  return EditorView.theme({
    '&': {
      fontSize: `${settings.fontSize}px`,
    },
    '.cm-scroller': {
      fontFamily: fontStack(settings.fontFamily),
      lineHeight: `${settings.lineHeight}`,
    },
    '.cm-content, .cm-gutters': {
      // Ligatures are a per-user decision and a per-font capability; `none`
      // is the safe default because `!=` rendered as `≠` has confused at least
      // one person in every code review ever held.
      fontVariantLigatures: settings.ligatures ? 'contextual' : 'none',
    },
  });
}

/**
 * The editor-relevant fields, as one string.
 *
 * `Settings` also carries things the editor does not care about — which
 * folders are collapsed in the sidebar, the recent-files list — and those
 * change often. Comparing a signature keeps a folder being collapsed from
 * reconfiguring every open document.
 */
function editorSignature(settings: Settings): string {
  return [
    settings.editorTheme,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.ligatures,
    settings.tabSize,
    settings.insertSpaces,
    settings.wrap,
    settings.caretStyle,
    settings.caretBlink,
    settings.lineNumbers,
    settings.minimap,
    settings.indentGuides,
    settings.highlightActiveLine,
    settings.showWhitespace,
    settings.printMargin,
    settings.printMarginColumn,
    settings.bracketMatching,
    settings.closeBrackets,
    settings.autocomplete,
    settings.highlightSelectionMatches,
  ].join('\u0000');
}

let lastSignature = editorSignature(getSettings());
let syncing = false;

/**
 * Wires the store to the editors, once.
 *
 * Done here rather than in `main.tsx` because this module is the only one that
 * knows which settings the editor actually reads — and because a setting that
 * does not reach an off-screen tab is precisely the bug this file exists to
 * prevent. Calling it twice is harmless; the second subscription is dropped.
 */
export function startEditorConfigSync(): () => void {
  if (syncing) return () => undefined;
  syncing = true;

  const stopSettings = subscribeSettings(() => {
    const signature = editorSignature(getSettings());
    if (signature === lastSignature) return;
    lastSignature = signature;
    reconfigureAllDocs();
  });
  // A plugin toggle has no signature to compare: the registry only announces
  // when something actually changed.
  const stopPlugins = subscribePlugins(reconfigureAllDocs);

  return () => {
    stopSettings();
    stopPlugins();
    syncing = false;
  };
}

// The store needs the factory before the first document is opened, and the
// session loader may open documents before React has mounted anything.
setBaseExtensions(baseExtensions);
startEditorConfigSync();
