/**
 * The two ways the find bar can stop answering.
 *
 * Both are about work with no ceiling on it, and both are reachable by typing
 * into the bar rather than by anything exotic: a regular expression that
 * backtracks for hours, and a "replace all" that builds one change object per
 * offset in the document. Neither is a hypothetical — see
 * `docs/security-review-2026-09.md`.
 *
 * `lib/find.ts` keeps its state in module-level variables and starts an
 * interval when the bar opens, so every test takes a fresh module graph and
 * closes the bar again on the way out.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
// Statically, so the CodeMirror module graph is built while the file is
// collected rather than inside the first test's own clock.
import { compileSearch } from './find';

vi.mock('./toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./toast')>();
  return { ...actual, toast: vi.fn(() => 0) };
});

let close: (() => void) | null = null;

afterEach(() => {
  close?.();
  close = null;
  vi.clearAllMocks();
});

/** A module graph that has never seen another test, with one document open. */
async function freshFind(text: string) {
  vi.resetModules();
  window.localStorage.clear();

  const find = await import('./find');
  const { openDoc } = await import('./documents');
  const { showDocNext, resetWorkspace } = await import('./workspace');
  const { toast } = await import('./toast');

  resetWorkspace();
  const id = openDoc({ path: null, name: 'Neu 1', text });
  showDocNext(id);
  close = () => find.closeFind();

  return { find, id, toast: vi.mocked(toast), getDoc: (await import('./documents')).getDoc };
}

describe('compiling a search expression', () => {
  it('refuses one that would freeze the window', () => {
    // Each of these backtracks exponentially. `(a+)+b` against twenty-four `a`
    // characters already takes about a tenth of a second, thirty is minutes and
    // forty is hours — and nothing on this thread can interrupt the `exec` once
    // it has started, which is why the pattern has to be turned away before it
    // is handed over.
    for (const query of ['(a+)+b', '(a|a)*b', '(a*)*b', '(\\s*\\s*)*$']) {
      const refused = compileSearch({
        query,
        regex: true,
        caseSensitive: true,
        wholeWord: false,
      });
      expect(refused.query, query).toBeNull();
      expect(refused.error, query).toBeTruthy();
    }
  });

  it('still accepts the expressions people actually type', () => {
    for (const query of [
      '^import ',
      '\\s+$',
      '\\bfoo\\b',
      '#.*$',
      '(\\w+)\\s*=\\s*(\\w+)',
      '^\\s+',
      'TODO|FIXME',
      '[A-Z][a-z]+',
    ]) {
      const compiled = compileSearch({
        query,
        regex: true,
        caseSensitive: false,
        wholeWord: false,
      });
      expect(compiled.error, query).toBeNull();
      expect(compiled.query, query).not.toBeNull();
    }
  });

  it('leaves a plain search alone, however odd it looks', () => {
    // The probe is only for the regex toggle: a literal search is escaped
    // before it becomes a pattern and cannot backtrack.
    const compiled = compileSearch({
      query: '(a+)+b',
      regex: false,
      caseSensitive: false,
      wholeWord: false,
    });
    expect(compiled.error).toBeNull();
    expect(compiled.query).not.toBeNull();
  });
});

describe('replacing everything', () => {
  it('refuses a pattern that matches at every offset, and changes nothing', async () => {
    // A quarter of a million characters and not one digit in them, so `\d*` —
    // a plausible slip for `\d+` — matches the empty string at every single
    // offset. Left alone that is one change object per offset and about a
    // gigabyte of heap before the renderer gives up.
    const text = Array.from({ length: 2_500 }, () => 'abc def ghi'.repeat(9)).join('\n');
    const { find, id, toast, getDoc } = await freshFind(text);

    find.openFind(true);
    find.updateFind({ query: '\\d*', regex: true, replacement: 'X' });
    find.replaceAll();

    expect(getDoc(id)?.state.doc.toString()).toBe(text);
    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('200000'));
  });

  it('still appends to every line for a zero-width match at the end of one', async () => {
    // The obvious cheap fix — skip every empty match — would break this, and
    // `$` → `;` on a block of code is a thing people do on purpose.
    const { find, id, getDoc } = await freshFind('alpha\nbeta\ngamma');

    find.openFind(true);
    find.updateFind({ query: '$', regex: true, replacement: ';' });
    find.replaceAll();

    expect(getDoc(id)?.state.doc.toString()).toBe('alpha;\nbeta;\ngamma;');
  });

  it('replaces an ordinary word without complaint', async () => {
    const { find, id, getDoc } = await freshFind('foo bar foo');

    find.openFind(true);
    find.updateFind({ query: 'foo', regex: false, replacement: 'baz' });
    find.replaceAll();

    expect(getDoc(id)?.state.doc.toString()).toBe('baz bar baz');
  });
});
