/**
 * Themes the user made, kept in the page's own storage.
 *
 * Phase 1 discovered that an editor theme is nothing but a block of custom
 * properties set on `.cm-editor` — no second `HighlightStyle`, no second set of
 * selectors. This module turns that trick into a feature: a user theme is a
 * name, a `dark` flag and a map of token to colour, and `editor/themes.ts`
 * turns it into the same kind of extension the three built-ins already are.
 *
 * Everything that comes back out of storage goes through {@link sanitizeTheme}
 * first, for the same reason `lib/settings.ts` does it: this is JSON on a
 * user's disk that a curious person will eventually open in the very editor it
 * configures. An unknown property name is dropped rather than written into the
 * page, and every value has to be a colour the browser itself admits to
 * understanding — `CSS.supports('color', value)` is the only honest test,
 * because the browser is the thing that has to render it.
 *
 * What this module does not do: build extensions (`editor/themes.ts`), decide
 * which theme is active (`Settings.editorTheme`), apply one (`editor/setup.ts`)
 * or draw anything (`components/ThemeEditor.tsx`).
 */

import { useSyncExternalStore } from 'react';
import { CODE_TOKENS, readToken, type CodeToken } from '@uwu/tokens';
import { N_ } from './i18n';

/**
 * The four base tokens a theme is allowed to move, on top of every code token.
 *
 * `CODE_TOKENS` alone would mean a user theme could recolour the syntax but not
 * the paper it sits on, and "start from UwU Paper" would hand back UwU Paper's
 * syntax on the app's own dark ground. These four are exactly the ones the
 * built-in variants already override, and they stop at the editor element —
 * nothing here can repaint the app's chrome.
 */
const GROUND_TOKENS = ['--uwu-deep', '--uwu-deep-gutter', '--uwu-ink', '--uwu-hairline'] as const;

export type ThemeToken = CodeToken | (typeof GROUND_TOKENS)[number];

/** Derived from the tokens package, so a token added there cannot go missing here. */
export const THEME_TOKENS: readonly ThemeToken[] = [...CODE_TOKENS, ...GROUND_TOKENS];

export type ThemeValues = Partial<Record<ThemeToken, string>>;

export type UserTheme = {
  /** Stable: it is what `Settings.editorTheme` stores. */
  id: string;
  /** User data. Never translated, never validated beyond a length. */
  name: string;
  /** Whether it paints on a dark ground. Description only — see `editor/themes.ts`. */
  dark: boolean;
  values: ThemeValues;
};

/**
 * Enough of a theme to copy: an `EditorTheme` from `editor/themes.ts` fits
 * without being named here.
 *
 * Passed in rather than looked up, because `editor/themes.ts` already imports
 * this module to merge user themes into its list, and a cycle between the two
 * would make whichever one loaded second see an empty list at module init.
 */
export type ThemeSource = { name: string; dark: boolean; values?: Readonly<ThemeValues> };

export type TokenGroup = { id: string; title: string; tokens: readonly ThemeToken[] };

const LISTED_GROUPS: readonly TokenGroup[] = [
  {
    id: 'syntax',
    title: N_('Syntax'),
    tokens: [
      '--uwu-code-keyword',
      '--uwu-code-string',
      '--uwu-code-number',
      '--uwu-code-comment',
      '--uwu-code-function',
      '--uwu-code-type',
      '--uwu-code-variable',
      '--uwu-code-constant',
      '--uwu-code-operator',
      '--uwu-code-tag',
      '--uwu-code-attribute',
      '--uwu-code-heading',
      '--uwu-code-link',
      '--uwu-code-invalid',
    ],
  },
  {
    id: 'furniture',
    title: N_('Editorfläche'),
    tokens: [
      '--uwu-deep',
      '--uwu-deep-gutter',
      '--uwu-ink',
      '--uwu-hairline',
      '--uwu-code-cursor',
      '--uwu-code-selection',
      '--uwu-code-selection-blur',
      '--uwu-code-match',
      '--uwu-code-match-active',
      '--uwu-code-active-line',
      '--uwu-code-line-number',
      '--uwu-code-line-number-active',
      '--uwu-code-indent-guide',
      '--uwu-code-matching-bracket',
    ],
  },
  {
    id: 'git',
    title: N_('Git'),
    tokens: ['--uwu-code-added', '--uwu-code-modified', '--uwu-code-deleted'],
  },
];

/**
 * The groups the theme editor draws, plus whatever is left over.
 *
 * A token added to `@uwu/tokens` and forgotten here would otherwise be storable
 * and invisible — editable data with no control, which is the worst of both.
 * The leftover group means the next token to arrive is ugly rather than absent.
 */
export const TOKEN_GROUPS: readonly TokenGroup[] = buildGroups();

function buildGroups(): readonly TokenGroup[] {
  const listed = new Set<string>(LISTED_GROUPS.flatMap((group) => group.tokens));
  const rest = THEME_TOKENS.filter((token) => !listed.has(token));
  if (rest.length === 0) return LISTED_GROUPS;
  return [...LISTED_GROUPS, { id: 'rest', title: N_('Sonstiges'), tokens: rest }];
}

/** German, via `N_()`; the theme editor translates them where it draws them. */
export const TOKEN_LABELS: Record<ThemeToken, string> = {
  '--uwu-code-keyword': N_('Schlüsselwort'),
  '--uwu-code-string': N_('Zeichenkette'),
  '--uwu-code-number': N_('Zahl'),
  '--uwu-code-comment': N_('Kommentar'),
  '--uwu-code-function': N_('Funktion'),
  '--uwu-code-type': N_('Typ'),
  '--uwu-code-variable': N_('Variable'),
  '--uwu-code-constant': N_('Konstante'),
  '--uwu-code-operator': N_('Operator'),
  '--uwu-code-tag': N_('Tag'),
  '--uwu-code-attribute': N_('Attribut'),
  '--uwu-code-heading': N_('Überschrift'),
  '--uwu-code-link': N_('Link'),
  '--uwu-code-invalid': N_('Ungültiges Zeichen'),
  '--uwu-code-cursor': N_('Cursor'),
  '--uwu-code-selection': N_('Auswahl'),
  '--uwu-code-selection-blur': N_('Auswahl ohne Fokus'),
  '--uwu-code-match': N_('Treffer'),
  '--uwu-code-match-active': N_('Aktueller Treffer'),
  '--uwu-code-active-line': N_('Aktive Zeile'),
  '--uwu-code-line-number': N_('Zeilennummer'),
  '--uwu-code-line-number-active': N_('Aktive Zeilennummer'),
  '--uwu-code-indent-guide': N_('Einrückungslinie'),
  '--uwu-code-matching-bracket': N_('Passende Klammer'),
  '--uwu-code-added': N_('Hinzugefügt'),
  '--uwu-code-modified': N_('Geändert'),
  '--uwu-code-deleted': N_('Gelöscht'),
  '--uwu-deep': N_('Hintergrund'),
  '--uwu-deep-gutter': N_('Hintergrund der Leiste'),
  '--uwu-ink': N_('Textfarbe'),
  '--uwu-hairline': N_('Trennlinie'),
};

const KEY = 'uwunotes.user-themes';

/** Ceilings, so a hand-edited store cannot turn into a settings page that never ends. */
const MAX_THEMES = 100;
const MAX_NAME = 60;
const MAX_VALUE = 64;

const EDITABLE = new Set<string>(THEME_TOKENS);

/* ── The colour test ───────────────────────────────────── */

/**
 * Whether the browser would accept `value` as a colour.
 *
 * Deliberately not a hex regex: `oklch(62% 0.22 350)` and `color-mix(…)` are
 * colours too, and a theme editor that refuses the notation the user actually
 * thinks in is a worse editor than one that lets the browser decide. `var(…)`
 * passes as well, which is a small feature — a theme can point a token at the
 * brand pink and follow it. A self-referential `var()` makes the property
 * invalid at computed-value time and the token falls back to the app's own,
 * which is a wrong colour rather than a blank editor.
 */
export function isColourValue(value: string): boolean {
  if (!value || value.length > MAX_VALUE) return false;
  try {
    return CSS.supports('color', value);
  } catch {
    // No `CSS.supports` means no way to tell, and guessing would let anything
    // through. A theme that refuses to take a value is recoverable.
    return false;
  }
}

/* ── Storage ───────────────────────────────────────────── */

let themes: UserTheme[] = load();
let version = 0;
const listeners = new Set<() => void>();

function load(): UserTheme[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    return sanitizeAll(JSON.parse(raw));
  } catch {
    // A locked-down or hand-mangled store means "no user themes", which is an
    // app with three themes rather than an app that will not start.
    return [];
  }
}

function sanitizeAll(raw: unknown): UserTheme[] {
  if (!Array.isArray(raw)) return [];
  const clean: UserTheme[] = [];
  const takenIds = new Set<string>();
  for (const entry of raw.slice(0, MAX_THEMES)) {
    const theme = sanitizeTheme(entry);
    if (!theme || takenIds.has(theme.id)) continue;
    takenIds.add(theme.id);
    clean.push(theme);
  }
  return clean;
}

/** One theme, or `null` when there is not enough left of it to be one. */
function sanitizeTheme(raw: unknown): UserTheme | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' && record.id ? record.id.slice(0, 60) : '';
  if (!id) return null;
  return {
    id,
    name: typeof record.name === 'string' ? record.name.slice(0, MAX_NAME) : '',
    dark: record.dark !== false,
    values: sanitizeValues(record.values),
  };
}

/** Unknown names and values the browser would not paint are dropped, not stored. */
function sanitizeValues(raw: unknown): ThemeValues {
  if (typeof raw !== 'object' || raw === null) return {};
  const values: ThemeValues = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!EDITABLE.has(name) || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (isColourValue(trimmed)) values[name as ThemeToken] = trimmed;
  }
  return values;
}

function persist() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(themes));
  } catch {
    // The themes are lost on restart and work for this run, which beats
    // refusing to let somebody pick a colour.
  }
}

function commit(next: UserTheme[]) {
  themes = next;
  persist();
  version += 1;
  for (const listener of listeners) listener();
}

/* ── Reading ───────────────────────────────────────────── */

/**
 * The list itself, not a copy: every change replaces the array, so identity is
 * already the right thing for `useSyncExternalStore` to compare.
 */
export function userThemes(): UserTheme[] {
  return themes;
}

export function userThemeById(id: string): UserTheme | undefined {
  return themes.find((theme) => theme.id === id);
}

export function subscribeUserThemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For anyone who wants a cheap number to compare instead of the list. */
export function userThemesVersion(): number {
  return version;
}

export function useUserThemes(): UserTheme[] {
  return useSyncExternalStore(subscribeUserThemes, userThemes);
}

/**
 * What a token is worth in this theme right now.
 *
 * Falls back to what the page currently resolves, so a theme carried over from
 * a version that did not know a token yet still draws something.
 */
export function themeValue(theme: UserTheme, token: ThemeToken): string {
  return theme.values[token] ?? readToken(token);
}

/* ── Writing ───────────────────────────────────────────── */

/**
 * A new theme, seeded from what the editor looks like at this moment.
 *
 * Never blank. A theme editor that opens on thirty empty fields is a form, not
 * a starting point, and the colours on screen are the ones the user already
 * decided they could live with.
 */
export function createUserTheme(name: string): string {
  return duplicateTheme({ name, dark: document.documentElement.dataset.theme !== 'light' }, name);
}

/**
 * A full, editable copy of `source` — built-in or not.
 *
 * Every token the source does not declare is filled in from what the page
 * resolves it to right now, which is what makes "start from UwU Midnight" mean
 * the whole of UwU Midnight and not the eight lines it happens to override.
 */
export function duplicateTheme(source: ThemeSource, name: string): string {
  const values: ThemeValues = {};
  for (const token of THEME_TOKENS) {
    const value = source.values?.[token] ?? readToken(token);
    if (isColourValue(value)) values[token] = value;
  }
  return insert({ id: newThemeId(), name: uniqueName(name), dark: source.dark, values });
}

export function renameUserTheme(id: string, name: string): void {
  patch(id, (theme) => ({ ...theme, name: name.slice(0, MAX_NAME) }));
}

export function setUserThemeDark(id: string, dark: boolean): void {
  patch(id, (theme) => ({ ...theme, dark }));
}

/**
 * One token, one colour. `false` means the browser would not have it.
 *
 * A rejected value is not stored and not reported anywhere else — the caller is
 * a text field with a half-typed `#ff` in it, and the right answer there is to
 * mark the field, not to raise an error.
 */
export function updateUserTheme(id: string, token: ThemeToken, value: string): boolean {
  const trimmed = value.trim();
  if (!EDITABLE.has(token) || !isColourValue(trimmed)) return false;
  patch(id, (theme) => ({ ...theme, values: { ...theme.values, [token]: trimmed } }));
  return true;
}

/** Back to whatever the app's own palette says. */
export function clearUserThemeToken(id: string, token: ThemeToken): void {
  patch(id, (theme) => {
    const values = { ...theme.values };
    delete values[token];
    return { ...theme, values };
  });
}

export function deleteUserTheme(id: string): void {
  if (!themes.some((theme) => theme.id === id)) return;
  commit(themes.filter((theme) => theme.id !== id));
}

/* ── One theme as one blob ─────────────────────────────── */

/**
 * The theme as JSON, formatted to be pasted into an issue and read by a human.
 *
 * The `uwunotes` marker is not a checksum and is not treated as one: it is
 * there so somebody looking at the blob a year later knows what it belongs to.
 * {@link importTheme} accepts a bare `{ name, dark, values }` just as happily.
 */
export function exportTheme(id: string): string {
  const theme = userThemeById(id);
  if (!theme) return '';
  return JSON.stringify(
    { uwunotes: 'theme', version: 1, name: theme.name, dark: theme.dark, values: theme.values },
    null,
    2,
  );
}

/**
 * A pasted blob as a new theme, or `null` when there was nothing usable in it.
 *
 * Always a new id, never an overwrite. Importing the same blob twice gives two
 * themes, which is mildly untidy; importing it once over the theme somebody
 * spent an evening on would not be.
 */
export function importTheme(json: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const values = sanitizeValues(record.values);
  // A blob with no colour the browser recognises is a blob of something else.
  if (Object.keys(values).length === 0) return null;
  const name = typeof record.name === 'string' ? record.name.slice(0, MAX_NAME) : '';
  return insert({
    id: newThemeId(),
    name: uniqueName(name || 'Theme'),
    dark: record.dark !== false,
    values,
  });
}

/* ── Odds and ends ─────────────────────────────────────── */

function insert(theme: UserTheme): string {
  // Oldest first out, so the cap cannot stop somebody from making one more.
  const kept = themes.slice(Math.max(0, themes.length - (MAX_THEMES - 1)));
  commit([...kept, theme]);
  return theme.id;
}

function patch(id: string, change: (theme: UserTheme) => UserTheme) {
  if (!themes.some((theme) => theme.id === id)) return;
  commit(themes.map((theme) => (theme.id === id ? change(theme) : theme)));
}

/** `Nachtblau`, `Nachtblau (2)`, `Nachtblau (3)` — a picker of identical names helps nobody. */
function uniqueName(wanted: string): string {
  const base = wanted.trim().slice(0, MAX_NAME) || 'Theme';
  if (!themes.some((theme) => theme.name === base)) return base;
  for (let counter = 2; counter < 100; counter += 1) {
    const candidate = `${base} (${counter})`;
    if (!themes.some((theme) => theme.name === candidate)) return candidate;
  }
  return base;
}

function newThemeId(): string {
  let id = '';
  do {
    id = `theme-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  } while (themes.some((theme) => theme.id === id));
  return id;
}
