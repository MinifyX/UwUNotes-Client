/**
 * The editor's font choices: the faces the app brings, and every family the
 * system has (Settings → Schrift → Schriftart).
 *
 * The system's list comes from Rust once per run and is kept here, so opening
 * the settings twice does not scan the font folders twice. A Rust side that
 * cannot list fonts (an older one, or the page in a plain browser) answers
 * with an error, and the picker then simply has only the bundled group — the
 * field still takes any name typed by hand.
 */

import { useEffect, useState } from 'react';
import { systemFonts, type SystemFont } from './api';
import { BUNDLED_FONTS } from './settings';

let asked: Promise<readonly SystemFont[]> | null = null;

export function loadSystemFonts(): Promise<readonly SystemFont[]> {
  asked ??= systemFonts().then(
    (fonts) => (Array.isArray(fonts) ? fonts : []),
    (): readonly SystemFont[] => [],
  );
  return asked;
}

/** The system's families, `null` while they are being read. */
export function useSystemFonts(): readonly SystemFont[] | null {
  const [fonts, setFonts] = useState<readonly SystemFont[] | null>(null);
  useEffect(() => {
    let current = true;
    void loadSystemFonts().then((list) => {
      if (current) setFonts(list);
    });
    return () => {
      current = false;
    };
  }, []);
  return fonts;
}

export type FontGroups = {
  bundled: string[];
  monospace: string[];
  other: string[];
};

/**
 * The picker's three groups for a search. A bundled face the system also has
 * is listed once, under bundled; every word of the query has to be in the
 * name, regardless of case.
 */
export function groupFonts(system: readonly SystemFont[], query: string): FontGroups {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (name: string) => {
    const lower = name.toLocaleLowerCase();
    return words.every((word) => lower.includes(word));
  };
  const bundledKeys = new Set(BUNDLED_FONTS.map((name) => name.toLocaleLowerCase()));
  const seen = new Set<string>();
  const groups: FontGroups = {
    bundled: BUNDLED_FONTS.filter(matches),
    monospace: [],
    other: [],
  };
  for (const font of system) {
    const key = font.family.toLocaleLowerCase();
    if (bundledKeys.has(key) || seen.has(key) || !matches(font.family)) continue;
    seen.add(key);
    (font.monospace ? groups.monospace : groups.other).push(font.family);
  }
  return groups;
}

/** A family as a CSS `font-family` value for showing a name in its own font. */
export function previewStack(family: string, fallback = 'var(--uwu-mono)'): string {
  const safe = family.replace(/["\\;{}]|\p{Cc}/gu, '').trim();
  return safe ? `"${safe}", ${fallback}` : fallback;
}
