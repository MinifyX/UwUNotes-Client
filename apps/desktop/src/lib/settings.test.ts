/**
 * The settings validator.
 *
 * `sanitize()` is the only thing standing between `uwunotes.settings` — a JSON
 * string in the page's storage, which anyone can open and edit — and an editor
 * that tries to render text at a font size of `"big"`. Its promise is absolute:
 * whatever goes in, a complete and usable {@link Settings} comes out. So these
 * tests hand it the things a person would never write on purpose and check
 * every field, rather than the three that looked interesting.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOSAVE_CHOICES,
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  getSettings,
  resetSettings,
  sanitize,
  updateSettings,
} from './settings';

beforeEach(() => {
  window.localStorage.clear();
  resetSettings();
});

describe('sanitising nonsense', () => {
  it('takes anything that is not an object as nothing stored at all', () => {
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize('everything, please')).toEqual(DEFAULT_SETTINGS);
    expect(sanitize(42)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize([])).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back field by field when every one of them is the wrong type', () => {
    const garbage = {
      language: 7,
      theme: null,
      editorTheme: 0,
      motion: [],
      tone: {},
      fontFamily: 12,
      fontSize: 'big',
      lineHeight: 'tall',
      ligatures: 'yes',
      tabSize: null,
      insertSpaces: 1,
      wrap: 0,
      caretStyle: false,
      caretBlink: 'on',
      lineNumbers: 'true',
      minimap: 'false',
      indentGuides: [],
      highlightActiveLine: {},
      showWhitespace: 3,
      printMargin: 'maybe',
      printMarginColumn: '100',
      bracketMatching: null,
      closeBrackets: undefined,
      autocomplete: 'sometimes',
      highlightSelectionMatches: 0,
      trimTrailingWhitespaceOnSave: 'no',
      ensureFinalNewlineOnSave: 1,
      autosaveSeconds: 'never',
      defaultEncoding: 5,
      defaultEol: 'nel',
      restoreSession: 'always',
      gitIndicators: [],
      gitGutter: {},
      sounds: 'loud',
      soundVolume: 'quiet',
      collapsedFolders: 'C:/one',
    };

    expect(sanitize(garbage)).toEqual(DEFAULT_SETTINGS);
  });

  it('takes a number that is not one as no number at all', () => {
    const settings = sanitize({ fontSize: Number.NaN, soundVolume: Number.POSITIVE_INFINITY });

    expect(settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settings.soundVolume).toBe(DEFAULT_SETTINGS.soundVolume);
  });

  it('pulls a number outside its range back into it', () => {
    const huge = sanitize({
      fontSize: 9000,
      lineHeight: 40,
      tabSize: 64,
      printMarginColumn: 5000,
      soundVolume: 12,
    });
    const tiny = sanitize({
      fontSize: -20,
      lineHeight: 0,
      tabSize: 0,
      printMarginColumn: 1,
      soundVolume: -12,
    });

    expect(huge).toMatchObject({
      fontSize: FONT_SIZE_MAX,
      lineHeight: 3,
      tabSize: 16,
      printMarginColumn: 400,
      soundVolume: 1,
    });
    expect(tiny).toMatchObject({
      fontSize: FONT_SIZE_MIN,
      lineHeight: 1,
      tabSize: 1,
      printMarginColumn: 20,
      soundVolume: 0,
    });
  });

  it('rounds a font size somebody typed a fraction into', () => {
    expect(sanitize({ fontSize: 14.6 }).fontSize).toBe(15);
    expect(sanitize({ tabSize: 3.2 }).tabSize).toBe(3);
  });

  it('falls back when a choice is not one of the choices', () => {
    const settings = sanitize({
      theme: 'neon',
      language: 'fr',
      motion: 'fast',
      tone: 'stern',
      wrap: 'column',
      caretStyle: 'beam',
      defaultEol: 'cr',
      // A real number, but not one of the offered intervals.
      autosaveSeconds: 45,
    });

    expect(settings).toMatchObject({
      theme: DEFAULT_SETTINGS.theme,
      language: DEFAULT_SETTINGS.language,
      motion: DEFAULT_SETTINGS.motion,
      tone: DEFAULT_SETTINGS.tone,
      wrap: DEFAULT_SETTINGS.wrap,
      caretStyle: DEFAULT_SETTINGS.caretStyle,
      defaultEol: DEFAULT_SETTINGS.defaultEol,
      autosaveSeconds: DEFAULT_SETTINGS.autosaveSeconds,
    });
    expect(AUTOSAVE_CHOICES).toContain(settings.autosaveSeconds);
  });

  it('takes a blank name as no name', () => {
    expect(sanitize({ fontFamily: '   ' }).fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    expect(sanitize({ editorTheme: '' }).editorTheme).toBe(DEFAULT_SETTINGS.editorTheme);
  });

  it('strips the control characters a font name could hide', () => {
    // The field is a single-line `<input>`, which cannot produce a newline —
    // but this blob is a file on disk, and a newline here ends the CSS string
    // `editor/setup.ts` wraps the name in, taking the rest of the typography
    // rule and the rule after it with it.
    expect(sanitize({ fontFamily: 'Cascadia\nMono' }).fontFamily).toBe('CascadiaMono');
    expect(sanitize({ fontFamily: 'a\r\nx' }).fontFamily).toBe('ax');
    expect(sanitize({ fontFamily: '\n\n' }).fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    // Names people really have keep working, umlauts and CJK included.
    expect(sanitize({ fontFamily: 'MS ゴシック' }).fontFamily).toBe('MS ゴシック');
    expect(sanitize({ fontFamily: 'JetBrains Mono NL' }).fontFamily).toBe('JetBrains Mono NL');
  });

  it('cuts a list of collapsed folders down to something a tree can hold', () => {
    const folders = Array.from({ length: 2_000 }, (_, index) => `C:/project/${index}`);

    const settings = sanitize({ collapsedFolders: [...folders, 42, null, { path: 'x' }] });

    expect(settings.collapsedFolders).toHaveLength(500);
    expect(settings.collapsedFolders[0]).toBe('C:/project/0');
  });

  it('cuts a single absurd path down as well', () => {
    const settings = sanitize({ collapsedFolders: ['C:/'.padEnd(5_000, 'x')] });

    expect(settings.collapsedFolders[0]).toHaveLength(400);
  });

  it('leaves settings that are already good exactly as they are', () => {
    const chosen = {
      ...DEFAULT_SETTINGS,
      theme: 'light' as const,
      fontSize: 18,
      lineHeight: 1.8,
      tabSize: 4,
      wrap: 'window' as const,
      autosaveSeconds: 60,
      collapsedFolders: ['C:/project/src'],
    };

    expect(sanitize(chosen)).toEqual(chosen);
  });
});

describe('the stored settings', () => {
  it('sanitises what it is asked to store, not only what it reads', () => {
    updateSettings({ fontSize: 9000 });

    expect(getSettings().fontSize).toBe(FONT_SIZE_MAX);
    expect(JSON.parse(window.localStorage.getItem('uwunotes.settings') ?? '{}')).toMatchObject({
      fontSize: FONT_SIZE_MAX,
    });
  });

  it('goes back to the defaults and forgets what was stored', () => {
    updateSettings({ fontSize: 20 });

    resetSettings();

    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(window.localStorage.getItem('uwunotes.settings')).toBeNull();
  });
});
