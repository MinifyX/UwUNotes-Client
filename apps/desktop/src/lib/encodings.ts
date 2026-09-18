/**
 * The character encodings the UI offers, and how to name one in a status bar.
 *
 * This list mirrors what `encoding_rs` accepts on the Rust side, trimmed to the
 * ones a person might plausibly pick by hand. It is not the full WHATWG table:
 * forty entries in a menu is a worse experience than twenty, and anything
 * missing can still arrive from a file's BOM or from detection, in which case
 * {@link encodingName} falls back to printing the label as-is.
 *
 * The BOM is not an encoding here, it is a flag next to one — "UTF-8 with BOM"
 * is a checkbox, not a separate code page. See `lib/api.ts`.
 */

import type { EncodingLabel, Eol } from './api';
import { N_, t } from './i18n';

export type EncodingGroup =
  'unicode' | 'western' | 'central' | 'cyrillic' | 'greek' | 'turkish' | 'baltic' | 'eastAsian';

export type EncodingEntry = {
  /** The label Rust expects, spelled exactly as `encoding_rs` knows it. */
  label: EncodingLabel;
  /** How it is written in a menu. Proper nouns, so not translated. */
  name: string;
  group: EncodingGroup;
};

const GROUP_NAMES: Record<EncodingGroup, string> = {
  unicode: N_('Unicode'),
  western: N_('Westeuropäisch'),
  central: N_('Mitteleuropäisch'),
  cyrillic: N_('Kyrillisch'),
  greek: N_('Griechisch'),
  turkish: N_('Türkisch'),
  baltic: N_('Baltisch'),
  eastAsian: N_('Ostasiatisch'),
};

export function encodingGroupName(group: EncodingGroup): string {
  return t(GROUP_NAMES[group]);
}

export const ENCODINGS: readonly EncodingEntry[] = [
  { label: 'UTF-8', name: 'UTF-8', group: 'unicode' },
  { label: 'UTF-16LE', name: 'UTF-16 LE', group: 'unicode' },
  { label: 'UTF-16BE', name: 'UTF-16 BE', group: 'unicode' },

  { label: 'windows-1252', name: 'Windows-1252', group: 'western' },
  { label: 'ISO-8859-15', name: 'ISO-8859-15', group: 'western' },
  { label: 'macintosh', name: 'Mac OS Roman', group: 'western' },

  { label: 'windows-1250', name: 'Windows-1250', group: 'central' },
  { label: 'ISO-8859-2', name: 'ISO-8859-2', group: 'central' },

  { label: 'windows-1251', name: 'Windows-1251', group: 'cyrillic' },
  { label: 'KOI8-R', name: 'KOI8-R', group: 'cyrillic' },
  { label: 'IBM866', name: 'IBM866', group: 'cyrillic' },

  { label: 'windows-1253', name: 'Windows-1253', group: 'greek' },
  { label: 'ISO-8859-7', name: 'ISO-8859-7', group: 'greek' },

  { label: 'windows-1254', name: 'Windows-1254', group: 'turkish' },
  { label: 'windows-1257', name: 'Windows-1257', group: 'baltic' },

  { label: 'Shift_JIS', name: 'Shift-JIS', group: 'eastAsian' },
  { label: 'EUC-JP', name: 'EUC-JP', group: 'eastAsian' },
  { label: 'GBK', name: 'GBK', group: 'eastAsian' },
  { label: 'Big5', name: 'Big5', group: 'eastAsian' },
  { label: 'EUC-KR', name: 'EUC-KR', group: 'eastAsian' },
];

/**
 * The short list offered when a file came out garbled.
 *
 * Reopening is a guessing game and a long menu makes it a worse one; these are
 * the encodings that actually produce mojibake in the wild.
 */
export const COMMON_ENCODINGS: readonly EncodingLabel[] = [
  'UTF-8',
  'UTF-16LE',
  'UTF-16BE',
  'windows-1252',
  'windows-1250',
  'windows-1251',
  'Shift_JIS',
];

const BY_LABEL = new Map(ENCODINGS.map((entry) => [entry.label.toLowerCase(), entry]));

export function encodingEntry(label: string): EncodingEntry | undefined {
  return BY_LABEL.get(label.toLowerCase());
}

/** The menu name, or the raw label when detection produced something exotic. */
export function encodingName(label: string): string {
  return encodingEntry(label)?.name ?? label;
}

/** `UTF-8`, `UTF-8 (BOM)`, `Windows-1252` — what the status bar shows. */
export function describe(encoding: string, bom: boolean): string {
  return bom ? `${encodingName(encoding)} (BOM)` : encodingName(encoding);
}

/** The two or three letters on the status bar. Not translated: they are acronyms. */
export const EOL_LABELS: Record<Eol, string> = {
  lf: 'LF',
  crlf: 'CRLF',
  cr: 'CR',
};

const EOL_NAMES: Record<Eol, string> = {
  lf: N_('Unix (LF)'),
  crlf: N_('Windows (CRLF)'),
  cr: N_('Klassisches Mac (CR)'),
};

/** The spelled-out version, for menus and for the settings page. */
export function eolName(eol: Eol): string {
  return t(EOL_NAMES[eol]);
}

export const EOLS: readonly Eol[] = ['lf', 'crlf', 'cr'];
