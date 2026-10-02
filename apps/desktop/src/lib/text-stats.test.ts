/**
 * Word and character counts.
 *
 * The counts go into a status bar that people check against word limits, so
 * the cases here are the ones where naive counting goes wrong in German: an
 * umlaut or ß splitting a word in two, a hyphenated compound counted as three,
 * an apostrophe ending one. Both paths are held to it — the segmenter every
 * shipped webview has, and the regular expression for one that does not.
 */

import { describe, expect, it } from 'vitest';
import {
  countWords,
  defaultSegmenter,
  estimateStats,
  minutesFor,
  textStats,
  type WordSegmenter,
} from './text-stats';

const segmenter = defaultSegmenter();
const paths: [string, WordSegmenter | null][] = [
  ['Intl.Segmenter', segmenter],
  ['the fallback', null],
];

describe.each(paths)('counting words with %s', (_name, using) => {
  const words = (text: string) => countWords(text, using);

  it('has a segmenter to test in the first place', () => {
    // jsdom runs on Node, which ships full ICU. Without this the first half of
    // the table would silently be the fallback twice.
    expect(segmenter).not.toBeNull();
  });

  it('counts nothing in nothing', () => {
    expect(words('')).toBe(0);
    expect(words('   \n\t  ')).toBe(0);
    expect(words('… — !?')).toBe(0);
  });

  it('keeps umlauts and ß inside their words', () => {
    expect(words('Größe Straße Übermaß')).toBe(3);
    expect(words('Ärger über Öl, Fuß und Maß.')).toBe(6);
  });

  it('counts a hyphenated compound once', () => {
    expect(words('Die E-Mail-Adresse ist da.')).toBe(4);
    // U+2010 and the non-breaking U+2011, as typographers type them.
    expect(words('Ärger‐frei und Schritt‑für‑Schritt')).toBe(3);
  });

  it('does not glue words across a dash with spaces around it', () => {
    expect(words('Heute - morgen')).toBe(2);
    expect(words('Heute – morgen')).toBe(2);
  });

  it('keeps an apostrophe inside a word', () => {
    expect(words("Wie geht's dir?")).toBe(3);
  });

  it('counts identifiers in code as single words and skips operators', () => {
    expect(words('const fooBar = 42; foo_bar(x)')).toBe(5);
  });

  it('finds words in text without spaces', () => {
    // The segmenter splits by dictionary and the fallback per character, so
    // the exact number differs; what matters is that it is not one.
    const japanese = words('日本語のテキストです');
    expect(japanese).toBeGreaterThanOrEqual(4);
    expect(japanese).toBeLessThanOrEqual(10);
    expect(words('我爱北京天安门')).toBeGreaterThanOrEqual(4);
  });

  it('separates a CJK run from Latin text beside it', () => {
    expect(words('UwUNotes日本')).toBeGreaterThanOrEqual(2);
  });
});

describe('the fallback in particular', () => {
  it('counts each ideograph and kana as one word, as Word does', () => {
    expect(countWords('日本語', null)).toBe(3);
    expect(countWords('テキスト', null)).toBe(4);
  });
});

describe('the rest of the numbers', () => {
  it('counts characters with and without spaces, never the line breaks', () => {
    const stats = textStats('Grüß dich\r\nWelt', segmenter);
    expect(stats.characters).toBe(13);
    expect(stats.charactersNoSpaces).toBe(12);
    expect(stats.lines).toBe(2);
  });

  it('counts an emoji as one character, not two halves of one', () => {
    expect(textStats('a😺b', segmenter).characters).toBe(3);
  });

  it('counts paragraphs as runs of lines with ink in them', () => {
    const text = [
      'Erster Absatz,',
      'noch derselbe.',
      '',
      '   ',
      'Zweiter.',
      '',
      '',
      'Dritter.',
    ].join('\n');
    const stats = textStats(text, segmenter);
    expect(stats.paragraphs).toBe(3);
    expect(stats.lines).toBe(8);
    expect(stats.approximate).toBe(false);
  });

  it('calls an empty text empty', () => {
    expect(textStats('', segmenter)).toMatchObject({ lines: 0, words: 0, paragraphs: 0 });
  });
});

describe('estimating a huge text', () => {
  it('scales the sample up and keeps the real line count', () => {
    const sample = 'eins zwei drei vier\n'.repeat(100); // 400 words, 2000 units
    const stats = estimateStats(sample, sample.length * 10, 1000, segmenter);
    expect(stats.approximate).toBe(true);
    expect(stats.words).toBe(4000);
    expect(stats.lines).toBe(1000);
    expect(stats.characters).toBe(sample.length * 10 - 999);
  });
});

describe('reading and speaking time', () => {
  it('is at least a minute for anything, and nothing for nothing', () => {
    expect(minutesFor(0, 230)).toBe(0);
    expect(minutesFor(3, 230)).toBe(1);
    expect(minutesFor(2300, 230)).toBe(10);
    expect(minutesFor(1300, 130)).toBe(10);
  });
});
