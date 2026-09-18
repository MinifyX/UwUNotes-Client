/**
 * The themes the user can pick from, and the proof that adding one is cheap.
 *
 * Exactly one of these writes any CSS: `uwu`, which is `editor/theme.ts` and
 * follows the app's light/dark because it is nothing but `var()` lookups. The
 * other two are the same theme with a block of custom properties set on
 * `.cm-editor` — no second `HighlightStyle`, no second set of selectors, no
 * second place to forget the matching-bracket colour. A variant that wants a
 * different comment colour changes one line here; a variant that wants a
 * different *structure* has picked the wrong tool and should say so out loud.
 *
 * The names stay English and untranslated on purpose: a theme name is closer
 * to a font name than to a sentence, and "Mitternacht" in the picker next to
 * "uwu" would look like a bug. What this module does not do: persist the
 * choice (that is `Settings.editorTheme`) or apply it (that is `setup.ts`).
 */

import type { Extension } from '@codemirror/state';
import { tokenOverride, uwuTheme } from './theme';

export type EditorTheme = {
  id: string;
  name: string;
  /** Whether the theme paints on a dark ground — the minimap asks. */
  dark: boolean;
  extension: Extension;
};

/**
 * Deeper and cooler than the house dark: the blue-black end of the palette,
 * for people who work at night with the lights off. The pink survives, one
 * notch quieter, because a caret that glows at 2 a.m. is a complaint waiting
 * to happen.
 */
const midnight: Extension = [
  uwuTheme,
  tokenOverride({
    '--uwu-deep': '#08090f',
    '--uwu-deep-gutter': '#0c0e16',
    '--uwu-code-keyword': '#f272a0',
    '--uwu-code-string': '#8fd8c0',
    '--uwu-code-number': '#e8c470',
    '--uwu-code-comment': '#5f6478',
    '--uwu-code-function': '#a8cdf5',
    '--uwu-code-type': '#b9a9ea',
    '--uwu-code-variable': '#e6e9f5',
    '--uwu-code-constant': '#f09bb8',
    '--uwu-code-operator': '#8b90a6',
    '--uwu-code-tag': '#f07fa8',
    '--uwu-code-attribute': '#b9a9ea',
    '--uwu-code-cursor': '#ff4d8d',
    '--uwu-code-selection': '#2a2f4a',
    '--uwu-code-selection-blur': '#1b1f30',
    '--uwu-code-match': '#1f2438',
    '--uwu-code-match-active': '#3c4468',
    '--uwu-code-active-line': '#0d0f1a',
    '--uwu-code-line-number': '#454a5e',
    '--uwu-code-line-number-active': '#f09bb8',
    '--uwu-code-indent-guide': '#171a27',
    '--uwu-code-matching-bracket': '#3c4468',
  }),
];

/**
 * Warm paper, for daylight and for printing a screenshot into a document. It
 * ignores `data-theme` entirely — a light theme that flips to dark with the
 * app would not be a theme, it would be a suggestion.
 */
const paper: Extension = [
  uwuTheme,
  tokenOverride({
    '--uwu-deep': '#fdfbf6',
    '--uwu-deep-gutter': '#f6f1e8',
    '--uwu-ink': '#2b2621',
    '--uwu-hairline': '#e7ded0',
    '--uwu-code-keyword': '#a8175c',
    '--uwu-code-string': '#3f6b34',
    '--uwu-code-number': '#8a5a00',
    '--uwu-code-comment': '#8d8375',
    '--uwu-code-function': '#1a5b8f',
    '--uwu-code-type': '#6a3bb8',
    '--uwu-code-variable': '#2b2621',
    '--uwu-code-constant': '#9c1449',
    '--uwu-code-operator': '#7a7064',
    '--uwu-code-tag': '#a8175c',
    '--uwu-code-attribute': '#6a3bb8',
    '--uwu-code-heading': '#9c1449',
    '--uwu-code-link': '#1a5b8f',
    '--uwu-code-cursor': '#c2185b',
    '--uwu-code-selection': '#f5ddc9',
    '--uwu-code-selection-blur': '#ece5d8',
    '--uwu-code-match': '#f7e9d6',
    '--uwu-code-match-active': '#eccba1',
    '--uwu-code-active-line': '#f8f3ea',
    '--uwu-code-line-number': '#b5ab9b',
    '--uwu-code-line-number-active': '#9c1449',
    '--uwu-code-indent-guide': '#ece3d4',
    '--uwu-code-matching-bracket': '#eccba1',
  }),
];

const house: EditorTheme = {
  id: 'uwu',
  name: 'UwU',
  // Nominally dark because the app's default is, but this one follows
  // `data-theme`: in a light window it is a light theme, live.
  dark: true,
  extension: uwuTheme,
};

/** Insertion order is the order the settings picker shows them in. */
export const THEMES: EditorTheme[] = [
  house,
  { id: 'uwu-midnight', name: 'UwU Midnight', dark: true, extension: midnight },
  { id: 'uwu-paper', name: 'UwU Paper', dark: false, extension: paper },
];

/**
 * An unknown id falls back to the house theme rather than to no theme at all —
 * a settings file carried over from a version that shipped a theme we since
 * dropped must not leave the editor unstyled.
 */
export function themeById(id: string): EditorTheme {
  return THEMES.find((theme) => theme.id === id) ?? house;
}
