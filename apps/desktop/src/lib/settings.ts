/**
 * The settings, kept in the page's own storage.
 *
 * Only preferences live here — how things look and behave. Nothing about a
 * file: open documents, the layout and the drafts are the session's business
 * (`lib/session.ts`) and live on the Rust side.
 *
 * Read with {@link useSettings} in a component, {@link getSettings} outside
 * React. Everything that comes back from storage goes through
 * {@link sanitize} first: the file is JSON on the user's disk, and a hand-edit
 * that turned `fontSize` into `"big"` must not brick the editor.
 */

import { useSyncExternalStore } from 'react';
import pkg from '../../package.json';
import { language } from './i18n';

export type ThemeSetting = 'system' | 'light' | 'dark';
/** German or English; "system" follows what the system prefers. */
export type LanguageSetting = 'system' | 'de' | 'en';
/** Animations: follow the system's reduced-motion setting, or override it. */
export type MotionSetting = 'system' | 'on' | 'off';
/** How much of Nyu there is. `neutral` keeps the cat but drops the chatter. */
export type ToneSetting = 'playful' | 'neutral';
export type WrapSetting = 'off' | 'window';
/** What the caret looks like — the terminal habit, carried into the editor. */
export type CaretStyle = 'line' | 'block' | 'underline';

export type Settings = {
  language: LanguageSetting;
  theme: ThemeSetting;
  /** The id of a theme from `editor/themes.ts`; the UwU one by default. */
  editorTheme: string;
  motion: MotionSetting;
  tone: ToneSetting;

  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** Ligatures are off by default: Fira Code is lovely and not everyone agrees. */
  ligatures: boolean;

  tabSize: number;
  /** Tab inserts spaces. Off writes a real tab, which is what a Makefile needs. */
  insertSpaces: boolean;
  wrap: WrapSetting;
  caretStyle: CaretStyle;
  caretBlink: boolean;

  lineNumbers: boolean;
  minimap: boolean;
  indentGuides: boolean;
  highlightActiveLine: boolean;
  /** Dots for spaces, arrows for tabs. */
  showWhitespace: boolean;
  /** A thin line at `printMarginColumn`. */
  printMargin: boolean;
  printMarginColumn: number;
  bracketMatching: boolean;
  closeBrackets: boolean;
  autocomplete: boolean;
  /** Every other occurrence of the word under the caret gets a soft box. */
  highlightSelectionMatches: boolean;

  trimTrailingWhitespaceOnSave: boolean;
  ensureFinalNewlineOnSave: boolean;
  /** Seconds between automatic saves of a file that has a path; 0 is off. */
  autosaveSeconds: number;

  /** What a new, never-saved file is written as. */
  defaultEncoding: string;
  defaultEol: 'lf' | 'crlf';

  restoreSession: boolean;
  /** A coloured bar on the tab and in the gutter, from `git status`. */
  gitIndicators: boolean;
  /** Little sounds on save and on error. Off by default — see docs/design.md. */
  sounds: boolean;
  soundVolume: number;

  /** Folded-away folders in the file tree, as absolute paths. */
  collapsedFolders: string[];
};

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 36;
export const TAB_SIZES = [2, 4, 8] as const;
export const AUTOSAVE_CHOICES = [0, 30, 60, 300] as const;

/** The monospace faces bundled with the app, plus whatever the system has. */
export const BUNDLED_FONTS = ['JetBrains Mono Variable', 'Fira Code Variable'] as const;

export const DEFAULT_SETTINGS: Settings = {
  language: 'system',
  // Dark by default, unlike its siblings: an editor is stared at for hours.
  theme: 'dark',
  editorTheme: 'uwu',
  motion: 'system',
  tone: 'playful',

  fontFamily: 'JetBrains Mono Variable',
  fontSize: 14,
  lineHeight: 1.55,
  ligatures: false,

  tabSize: 2,
  insertSpaces: true,
  wrap: 'off',
  caretStyle: 'line',
  caretBlink: true,

  lineNumbers: true,
  minimap: false,
  indentGuides: true,
  highlightActiveLine: true,
  showWhitespace: false,
  printMargin: false,
  printMarginColumn: 100,
  bracketMatching: true,
  closeBrackets: true,
  autocomplete: true,
  highlightSelectionMatches: true,

  trimTrailingWhitespaceOnSave: false,
  ensureFinalNewlineOnSave: false,
  autosaveSeconds: 0,

  defaultEncoding: 'UTF-8',
  defaultEol: 'crlf',

  restoreSession: true,
  gitIndicators: true,
  sounds: false,
  soundVolume: 0.35,

  collapsedFolders: [],
};

const KEY = 'uwunotes.settings';

/** Stored values are checked one by one; anything unexpected falls back to its default. */
export function sanitize(raw: unknown): Settings {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  const oneOf = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;
  const int = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback;
  const num = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  const text = (value: unknown, fallback: string, max = 80) =>
    typeof value === 'string' && value.trim() ? value.slice(0, max) : fallback;

  return {
    language: oneOf(input.language, ['system', 'de', 'en'] as const, d.language),
    theme: oneOf(input.theme, ['system', 'light', 'dark'] as const, d.theme),
    editorTheme: text(input.editorTheme, d.editorTheme, 40),
    motion: oneOf(input.motion, ['system', 'on', 'off'] as const, d.motion),
    tone: oneOf(input.tone, ['playful', 'neutral'] as const, d.tone),

    fontFamily: text(input.fontFamily, d.fontFamily),
    fontSize: int(input.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, d.fontSize),
    lineHeight: num(input.lineHeight, 1, 3, d.lineHeight),
    ligatures: bool(input.ligatures, d.ligatures),

    tabSize: int(input.tabSize, 1, 16, d.tabSize),
    insertSpaces: bool(input.insertSpaces, d.insertSpaces),
    wrap: oneOf(input.wrap, ['off', 'window'] as const, d.wrap),
    caretStyle: oneOf(input.caretStyle, ['line', 'block', 'underline'] as const, d.caretStyle),
    caretBlink: bool(input.caretBlink, d.caretBlink),

    lineNumbers: bool(input.lineNumbers, d.lineNumbers),
    minimap: bool(input.minimap, d.minimap),
    indentGuides: bool(input.indentGuides, d.indentGuides),
    highlightActiveLine: bool(input.highlightActiveLine, d.highlightActiveLine),
    showWhitespace: bool(input.showWhitespace, d.showWhitespace),
    printMargin: bool(input.printMargin, d.printMargin),
    printMarginColumn: int(input.printMarginColumn, 20, 400, d.printMarginColumn),
    bracketMatching: bool(input.bracketMatching, d.bracketMatching),
    closeBrackets: bool(input.closeBrackets, d.closeBrackets),
    autocomplete: bool(input.autocomplete, d.autocomplete),
    highlightSelectionMatches: bool(input.highlightSelectionMatches, d.highlightSelectionMatches),

    trimTrailingWhitespaceOnSave: bool(
      input.trimTrailingWhitespaceOnSave,
      d.trimTrailingWhitespaceOnSave,
    ),
    ensureFinalNewlineOnSave: bool(input.ensureFinalNewlineOnSave, d.ensureFinalNewlineOnSave),
    autosaveSeconds: oneOf(input.autosaveSeconds, AUTOSAVE_CHOICES, d.autosaveSeconds),

    defaultEncoding: text(input.defaultEncoding, d.defaultEncoding, 40),
    defaultEol: oneOf(input.defaultEol, ['lf', 'crlf'] as const, d.defaultEol),

    restoreSession: bool(input.restoreSession, d.restoreSession),
    gitIndicators: bool(input.gitIndicators, d.gitIndicators),
    sounds: bool(input.sounds, d.sounds),
    soundVolume: num(input.soundVolume, 0, 1, d.soundVolume),

    collapsedFolders: Array.isArray(input.collapsedFolders)
      ? input.collapsedFolders
          .filter((path): path is string => typeof path === 'string')
          .map((path) => path.slice(0, 400))
          .slice(0, 500)
      : [],
  };
}

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : {});
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = sanitize({ ...current, ...patch });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private storage can be unavailable; the change still holds for this run.
  }
  for (const listener of listeners) listener();
}

export function resetSettings() {
  current = DEFAULT_SETTINGS;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Same as above: the reset still holds for this run.
  }
  for (const listener of listeners) listener();
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}

/** The app's own version, for the About box and the session file. */
export const APP_VERSION: string = pkg.version;

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');
const reducedQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');

/** Whether animations should play right now, by setting and system. */
export function motionAllowed(settings: Settings = current): boolean {
  const { motion } = settings;
  return motion === 'on' || (motion === 'system' && !reducedQuery().matches);
}

/** Whether the dark palette applies right now, by setting and system. */
export function darkActive(settings: Settings = current): boolean {
  return settings.theme === 'dark' || (settings.theme === 'system' && darkQuery().matches);
}

/**
 * Puts theme, language and motion on `<html>`, now and whenever the setting or
 * the system changes. Called once from `main.tsx` before React mounts, so the
 * first paint is already the right colour.
 */
export function applyAppearance() {
  const apply = () => {
    document.documentElement.dataset.theme = darkActive() ? 'dark' : 'light';
    document.documentElement.lang = language(current);
    if (motionAllowed()) delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = 'reduced';
  };
  apply();
  subscribeSettings(apply);
  darkQuery().addEventListener('change', apply);
  reducedQuery().addEventListener('change', apply);
}
