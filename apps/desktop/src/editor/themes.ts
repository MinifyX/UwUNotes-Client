/**
 * The themes the user can pick from — the four we ship and however many they
 * made — and the proof that adding one is cheap.
 *
 * Exactly one of these writes any CSS: `uwu`, which is `editor/theme.ts` and
 * follows the app's light/dark because it is nothing but `var()` lookups. Every
 * other one is the same theme with a block of custom properties set on
 * `.cm-editor` — no second `HighlightStyle`, no second set of selectors, no
 * second place to forget the matching-bracket colour. A variant that wants a
 * different comment colour changes one line here; a variant that wants a
 * different *structure* has picked the wrong tool and should say so out loud.
 *
 * Because that is all a theme is, a theme the user made is the same shape as
 * one we shipped: `lib/user-themes.ts` stores the block of properties and this
 * module wraps it. The built-ins carry their {@link ThemeValues} around with
 * them for the same reason — duplicating one has to hand back the whole theme,
 * not the handful of lines it happens to override.
 *
 * The names of the built-ins stay English and untranslated on purpose: a theme
 * name is closer to a font name than to a sentence, and "Mitternacht" in the
 * picker next to "uwu" would look like a bug. A user theme's name is user data
 * and is never translated either.
 *
 * What this module does not do: persist the choice (that is
 * `Settings.editorTheme`) or apply it (that is `setup.ts`).
 */

import type { Extension } from '@codemirror/state';
import { tokenOverride, uwuTheme } from './theme';
import { userThemes, type ThemeValues, type UserTheme } from '../lib/user-themes';

export type EditorTheme = {
  id: string;
  name: string;
  /**
   * Whether the theme paints on a dark ground.
   *
   * Description, not configuration: nothing in the app branches on it today,
   * because everything that needs a colour — the minimap included — reads the
   * tokens off the editor element and gets the right answer without being told.
   * It is here so a theme that travels as JSON says which half of the world it
   * belongs to.
   */
  dark: boolean;
  extension: Extension;
  /**
   * The overrides it is made of, for anyone copying it. Absent on the house
   * theme, which has none: it *is* the palette.
   */
  values?: Readonly<ThemeValues>;
};

/**
 * Deeper and cooler than the house dark: the blue-black end of the palette,
 * for people who work at night with the lights off. The pink survives, one
 * notch quieter, because a caret that glows at 2 a.m. is a complaint waiting
 * to happen.
 */
const MIDNIGHT: ThemeValues = {
  '--uwu-deep': '#08090f',
  '--uwu-deep-gutter': '#0c0e16',
  '--uwu-ink': '#e6e9f5',
  '--uwu-hairline': '#171a27',
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
  '--uwu-code-heading': '#f09bb8',
  '--uwu-code-link': '#a8cdf5',
  '--uwu-code-invalid': '#ff8080',
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
  '--uwu-code-added': '#5cc7ac',
  '--uwu-code-modified': '#d8a25c',
  '--uwu-code-deleted': '#ff8080',
};

/**
 * Warm paper, for daylight and for printing a screenshot into a document. It
 * ignores `data-theme` entirely — a light theme that flips to dark with the
 * app would not be a theme, it would be a suggestion.
 */
const PAPER: ThemeValues = {
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
  '--uwu-code-invalid': '#c62828',
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
  '--uwu-code-added': '#17796a',
  '--uwu-code-modified': '#8e5510',
  '--uwu-code-deleted': '#c62828',
};

/**
 * Pure black, and nothing dimmed.
 *
 * The one theme here with a requirement instead of a mood: every colour is
 * picked to clear 7:1 against `#000`, which is WCAG's AAA threshold for body
 * text, and that includes the comment colour and the inactive line numbers.
 * Both of those are traditionally the first things a theme greys out, and both
 * of them are text somebody has to read — a comment nobody can read is a
 * comment nobody writes.
 *
 * Pink is still only "this one": keyword, tag, caret, selection, active line
 * number. Green and amber still only mean git.
 */
const HIGH_CONTRAST: ThemeValues = {
  '--uwu-deep': '#000000',
  '--uwu-deep-gutter': '#0a0a0c',
  '--uwu-ink': '#ffffff',
  '--uwu-hairline': '#5c5c66',
  '--uwu-code-keyword': '#ff8ab8',
  '--uwu-code-string': '#7dffc4',
  '--uwu-code-number': '#ffd75f',
  '--uwu-code-comment': '#bcbcc8',
  '--uwu-code-function': '#8ed4ff',
  '--uwu-code-type': '#d7b8ff',
  '--uwu-code-variable': '#ffffff',
  '--uwu-code-constant': '#ffa3c8',
  '--uwu-code-operator': '#e6e6ee',
  '--uwu-code-tag': '#ff8ab8',
  '--uwu-code-attribute': '#d7b8ff',
  '--uwu-code-heading': '#ffa3c8',
  '--uwu-code-link': '#8ed4ff',
  '--uwu-code-invalid': '#ff7a7a',
  '--uwu-code-cursor': '#ff5c9e',
  // Dark enough that white text stays at 12:1 on top of it, which is what a
  // selection has to be: a highlight you cannot read through is a redaction.
  '--uwu-code-selection': '#6b0d38',
  '--uwu-code-selection-blur': '#33202a',
  '--uwu-code-match': '#2e2e34',
  '--uwu-code-match-active': '#7d1046',
  '--uwu-code-active-line': '#17171b',
  '--uwu-code-line-number': '#a0a0ac',
  '--uwu-code-line-number-active': '#ff8ab8',
  '--uwu-code-indent-guide': '#3d3d45',
  '--uwu-code-matching-bracket': '#7d1046',
  '--uwu-code-added': '#5cffbe',
  '--uwu-code-modified': '#ffc45c',
  '--uwu-code-deleted': '#ff8f8f',
};

function builtIn(id: string, name: string, dark: boolean, values: ThemeValues): EditorTheme {
  return { id, name, dark, values, extension: [uwuTheme, tokenOverride(values)] };
}

const HOUSE: EditorTheme = {
  id: 'uwu',
  name: 'UwU',
  // Nominally dark because the app's default is, but this one follows
  // `data-theme`: in a light window it is a light theme, live.
  dark: true,
  extension: uwuTheme,
};

/** Insertion order is the order the settings picker shows them in. */
export const THEMES: EditorTheme[] = [
  HOUSE,
  builtIn('uwu-midnight', 'UwU Midnight', true, MIDNIGHT),
  builtIn('uwu-paper', 'UwU Paper', false, PAPER),
  builtIn('uwu-high-contrast', 'UwU High Contrast', true, HIGH_CONTRAST),
];

/**
 * The built-ins followed by the user's own, which is the list a picker wants.
 *
 * Built-ins come first and {@link themeById} looks at them first, so a
 * hand-edited store claiming the id `uwu` shadows nothing.
 */
export function allThemes(): EditorTheme[] {
  const mine = userThemes();
  prune(mine);
  return [...THEMES, ...mine.map(asEditorTheme)];
}

/**
 * An unknown id falls back to the house theme rather than to no theme at all —
 * a settings file naming a theme that has since been deleted, or one we
 * dropped between versions, must not leave the editor unstyled.
 */
export function themeById(id: string): EditorTheme {
  const shipped = THEMES.find((theme) => theme.id === id);
  if (shipped) return shipped;
  const mine = userThemes().find((theme) => theme.id === id);
  return mine ? asEditorTheme(mine) : HOUSE;
}

/**
 * Built extensions, kept until the theme they came from changes.
 *
 * `EditorView.theme()` mints a class name and injects a rule into the document
 * every time it is called, and `settingsExtensions()` calls this on every
 * reconfigure — which is every keystroke in a font-size field. Without the
 * cache, an afternoon of fiddling with the line height leaves a few hundred
 * dead stylesheet rules behind.
 */
const built = new Map<string, { signature: string; theme: EditorTheme }>();

function asEditorTheme(theme: UserTheme): EditorTheme {
  const signature = JSON.stringify([theme.name, theme.dark, theme.values]);
  const known = built.get(theme.id);
  if (known && known.signature === signature) return known.theme;
  const made: EditorTheme = {
    id: theme.id,
    name: theme.name,
    dark: theme.dark,
    values: theme.values,
    extension: [uwuTheme, tokenOverride(theme.values)],
  };
  built.set(theme.id, { signature, theme: made });
  return made;
}

function prune(live: readonly UserTheme[]) {
  if (built.size <= live.length) return;
  const alive = new Set(live.map((theme) => theme.id));
  for (const id of [...built.keys()]) if (!alive.has(id)) built.delete(id);
}
