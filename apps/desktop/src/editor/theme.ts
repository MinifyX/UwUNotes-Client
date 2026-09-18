/**
 * The editor's colours, written entirely in custom properties.
 *
 * Not one hex value appears below. Every colour is `var(--uwu-code-*)` or
 * `var(--uwu-*)`, which means the whole editor re-colours the instant
 * `applyAppearance()` flips `data-theme` on `<html>` — no JavaScript runs, no
 * extension is rebuilt, no document is reconfigured. The browser does it in the
 * same frame it repaints the rest of the window, so the chrome and the code
 * never disagree about which theme is on.
 *
 * That is also why {@link tokenOverride} exists: a second or third theme is a
 * block of custom properties set on `.cm-editor`, not a second copy of this
 * file. See `editor/themes.ts`.
 *
 * What this module deliberately does not do: pick which theme is active (that
 * is `themes.ts`), decide when to apply it (that is `setup.ts`), or style
 * anything outside the editor — the app's own chrome is plain CSS.
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';
import type { Token } from '@uwu/tokens';
import type { CaretStyle } from '../lib/settings';

/**
 * Syntax colour, mapped tag by tag.
 *
 * Pink is spent on keywords and tag names only. Everything else comes from the
 * suite's secondary hues, so a screenful of code reads as structure first and
 * brand second — the opposite order would be exhausting after an hour.
 */
export const uwuHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--uwu-code-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--uwu-code-keyword)', fontWeight: '600' },
  { tag: tags.definitionKeyword, color: 'var(--uwu-code-keyword)', fontWeight: '600' },
  { tag: tags.moduleKeyword, color: 'var(--uwu-code-keyword)' },
  { tag: tags.operatorKeyword, color: 'var(--uwu-code-keyword)' },

  { tag: tags.string, color: 'var(--uwu-code-string)' },
  { tag: tags.special(tags.string), color: 'var(--uwu-code-string)', fontWeight: '600' },
  { tag: tags.regexp, color: 'var(--uwu-code-string)' },
  { tag: tags.escape, color: 'var(--uwu-code-constant)' },

  { tag: tags.number, color: 'var(--uwu-code-number)' },
  { tag: tags.bool, color: 'var(--uwu-code-constant)' },
  { tag: tags.null, color: 'var(--uwu-code-constant)' },
  { tag: tags.atom, color: 'var(--uwu-code-constant)' },
  { tag: tags.constant(tags.variableName), color: 'var(--uwu-code-constant)' },

  // Italics only on comments. Anywhere else the mixed metrics of a variable
  // monospace face start to wobble against the indent guides.
  { tag: tags.comment, color: 'var(--uwu-code-comment)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--uwu-code-comment)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--uwu-code-comment)', fontStyle: 'italic' },
  { tag: tags.docComment, color: 'var(--uwu-code-comment)', fontStyle: 'italic' },

  { tag: tags.function(tags.variableName), color: 'var(--uwu-code-function)' },
  {
    tag: tags.definition(tags.function(tags.variableName)),
    color: 'var(--uwu-code-function)',
    fontWeight: '600',
  },
  { tag: tags.typeName, color: 'var(--uwu-code-type)' },
  { tag: tags.className, color: 'var(--uwu-code-type)' },
  { tag: tags.namespace, color: 'var(--uwu-code-type)' },

  { tag: tags.tagName, color: 'var(--uwu-code-tag)' },
  { tag: tags.attributeName, color: 'var(--uwu-code-attribute)' },
  { tag: tags.propertyName, color: 'var(--uwu-code-variable)' },
  { tag: tags.variableName, color: 'var(--uwu-code-variable)' },

  { tag: tags.operator, color: 'var(--uwu-code-operator)' },
  { tag: tags.punctuation, color: 'var(--uwu-code-operator)' },
  { tag: tags.bracket, color: 'var(--uwu-code-operator)' },
  { tag: tags.meta, color: 'var(--uwu-code-comment)' },

  { tag: tags.heading, color: 'var(--uwu-code-heading)', fontWeight: '700' },
  { tag: tags.heading1, color: 'var(--uwu-code-heading)', fontWeight: '700', fontSize: '1.3em' },
  { tag: tags.heading2, color: 'var(--uwu-code-heading)', fontWeight: '700', fontSize: '1.15em' },
  { tag: tags.heading3, color: 'var(--uwu-code-heading)', fontWeight: '700', fontSize: '1.05em' },
  { tag: tags.link, color: 'var(--uwu-code-link)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--uwu-code-link)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },

  // Not red-on-red: the invalid colour is picked against --uwu-deep, so a
  // broken token stays legible instead of turning into a smear.
  { tag: tags.invalid, color: 'var(--uwu-code-invalid)', textDecoration: 'underline wavy' },
]);

/**
 * The furniture: gutters, selection, brackets, popups.
 *
 * `dark: true` is a claim about CodeMirror's own built-in defaults, not about
 * the palette. Every colour those defaults would supply is overridden below,
 * so the flag only decides which of CodeMirror's two baseline stylesheets sits
 * underneath — and the dark one loses fewer fights with a dark canvas while a
 * light `data-theme` is painting over the top of it anyway.
 */
export const uwuChrome: Extension = EditorView.theme(
  {
    '&': {
      color: 'var(--uwu-ink)',
      backgroundColor: 'var(--uwu-deep)',
      height: '100%',
    },
    '&.cm-focused': {
      // The app draws focus on the pane, not on the text area; two rings for
      // one focus is noise.
      outline: 'none',
    },
    // Nothing here sets a font. Typography is `settingsExtensions()`' job, and
    // two themes reaching for `.cm-scroller { font-family }` would be decided
    // by which one CodeMirror happened to insert into the stylesheet last.
    '.cm-content': {
      caretColor: 'var(--uwu-code-cursor)',
    },

    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--uwu-code-cursor)',
      borderLeftWidth: '2px',
    },

    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--uwu-code-selection-blur)',
    },
    '&.cm-focused .cm-selectionBackground, &.cm-focused .cm-content ::selection': {
      backgroundColor: 'var(--uwu-code-selection)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'var(--uwu-code-match)',
      borderRadius: '2px',
    },
    '.cm-searchMatch': {
      backgroundColor: 'var(--uwu-code-match)',
      borderRadius: '2px',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--uwu-code-match-active)',
    },

    '.cm-activeLine': {
      backgroundColor: 'var(--uwu-code-active-line)',
    },

    '.cm-gutters': {
      backgroundColor: 'var(--uwu-deep-gutter)',
      color: 'var(--uwu-code-line-number)',
      border: 'none',
      borderRight: '1px solid var(--uwu-hairline)',
      userSelect: 'none',
    },
    '.cm-gutterElement': {
      padding: '0 6px 0 10px',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--uwu-code-line-number-active)',
    },
    '.cm-foldGutter .cm-gutterElement': {
      padding: '0 4px',
      cursor: 'pointer',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--uwu-pink-tint)',
      color: 'var(--uwu-pink-ink)',
      border: 'none',
      borderRadius: 'var(--uwu-radius-pill)',
      padding: '0 6px',
      margin: '0 2px',
    },

    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--uwu-code-matching-bracket)',
      outline: 'none',
      borderRadius: '2px',
    },
    '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      color: 'var(--uwu-code-invalid)',
      backgroundColor: 'transparent',
    },

    '.cm-panels': {
      backgroundColor: 'var(--uwu-surface)',
      color: 'var(--uwu-ink)',
      borderColor: 'var(--uwu-border)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--uwu-elevated)',
      color: 'var(--uwu-ink)',
      border: '1px solid var(--uwu-border)',
      borderRadius: 'var(--uwu-radius-card)',
      overflow: 'hidden',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'inherit',
      maxHeight: '16em',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: '2px 8px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--uwu-pink-tint)',
      color: 'var(--uwu-pink-ink)',
    },
    '.cm-completionLabel': {
      color: 'inherit',
    },
    '.cm-completionDetail': {
      color: 'var(--uwu-muted)',
      fontStyle: 'normal',
    },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'var(--uwu-pink-solid)',
      fontWeight: '700',
    },
  },
  { dark: true },
);

/**
 * Chrome plus syntax colour: the whole look, in one extension.
 *
 * Registered as a normal style rather than a fallback, because it is the
 * theme: a fallback style steps aside for any other highlighter that turns up,
 * which is precisely what must not happen to the one the user picked.
 */
export const uwuTheme: Extension = [uwuChrome, syntaxHighlighting(uwuHighlightStyle)];

/**
 * Sets custom properties on the editor element.
 *
 * This is the whole theming system. A variant theme overrides a handful of
 * `--uwu-code-*` names on `.cm-editor`, the cascade carries them down to the
 * spans that `uwuHighlightStyle` produced, and the variant needs no rules of
 * its own. Adding a UwU-Suite theme later is a block of properties, not a file.
 */
export function tokenOverride(values: Partial<Record<Token, string>>): Extension {
  return EditorView.theme({ '&': { ...values } });
}

/**
 * The caret, as the user asked for it.
 *
 * `0.6em` is the advance width of the bundled faces (JetBrains Mono and Fira
 * Code are both 600/1000), so a block caret covers exactly one character
 * without measuring anything. A user-chosen proportional font would make the
 * block slightly wrong, which is a trade we take over a measurement pass on
 * every reconfigure.
 *
 * Memoised, because every `EditorView.theme()` call mints a new class name and
 * injects a new rule into the page. Three styles means at most three rules for
 * the life of the app, instead of one more every time a preference changes.
 */
const caretThemes = new Map<CaretStyle, Extension>();

export function caretAppearance(style: CaretStyle): Extension {
  const known = caretThemes.get(style);
  if (known) return known;
  const built = buildCaret(style);
  caretThemes.set(style, built);
  return built;
}

function buildCaret(style: CaretStyle): Extension {
  if (style === 'line') return [];
  if (style === 'block') {
    return EditorView.theme({
      '.cm-cursor, .cm-cursor-primary': {
        borderLeftWidth: '0',
        width: '0.6em',
        backgroundColor: 'var(--uwu-code-cursor)',
        // Opaque would hide the character underneath; 0.45 keeps it readable
        // and still reads as a solid block from a normal viewing distance.
        opacity: '0.45',
      },
    });
  }
  return EditorView.theme({
    '.cm-cursor, .cm-cursor-primary': {
      borderLeftWidth: '0',
      width: '0.6em',
      borderBottom: '2px solid var(--uwu-code-cursor)',
    },
  });
}
