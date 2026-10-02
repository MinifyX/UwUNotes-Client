/**
 * The small pure pieces under the preview: task boxes, link sorting, heading
 * slugs and the scroll-sync interpolation. None of them needs a renderer, an
 * editor or a layout engine, which is exactly why they are their own modules.
 */

import { describe, expect, it } from 'vitest';
import { classifyLink, resolveRelative } from './links';
import { dedupeAnchors, previewOffsetForLine } from './scroll-sync';
import { createSlugger, slugBase } from './slug';
import { findTaskBox, taskToggleChange } from './tasks';

describe('task boxes', () => {
  it('finds the box after any list marker', () => {
    expect(findTaskBox('- [ ] milk')).toEqual({ start: 2, checked: false });
    expect(findTaskBox('* [x] milk')).toEqual({ start: 2, checked: true });
    expect(findTaskBox('+ [X] milk')).toEqual({ start: 2, checked: true });
    expect(findTaskBox('12. [ ] milk')).toEqual({ start: 4, checked: false });
    expect(findTaskBox('3) [ ] milk')).toEqual({ start: 3, checked: false });
    expect(findTaskBox('    - [ ] nested')).toEqual({ start: 6, checked: false });
    expect(findTaskBox('> - [ ] quoted')).toEqual({ start: 4, checked: false });
    expect(findTaskBox('- [ ]')).toEqual({ start: 2, checked: false });
  });

  it('refuses what GitHub would not draw as a checkbox', () => {
    expect(findTaskBox('[ ] no marker')).toBeNull();
    expect(findTaskBox('-[ ] no space')).toBeNull();
    expect(findTaskBox('- [ ]glued')).toBeNull();
    expect(findTaskBox('- [y] wrong letter')).toBeNull();
    expect(findTaskBox('- [  ] two spaces')).toBeNull();
    expect(findTaskBox('text - [ ] later')).toBeNull();
  });

  it('flips exactly the character inside the brackets', () => {
    expect(taskToggleChange('- [ ] milk', 100)).toEqual({ from: 103, to: 104, insert: 'x' });
    expect(taskToggleChange('- [x] milk', 0)).toEqual({ from: 3, to: 4, insert: ' ' });
    expect(taskToggleChange('- [X] milk', 0)).toEqual({ from: 3, to: 4, insert: ' ' });
    expect(taskToggleChange('just text', 0)).toBeNull();
  });
});

describe('links', () => {
  const doc = '/home/someone/notes/today.md';

  it('sends http, https and mailto to the browser', () => {
    expect(classifyLink('https://example.com/a', doc)).toEqual({
      kind: 'external',
      url: 'https://example.com/a',
    });
    expect(classifyLink('mailto:someone@example.com', doc).kind).toBe('external');
  });

  it('blocks every other scheme, however it is spelled', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JAVASCRIPT:alert(1)',
      'java\nscript:alert(1)',
      'java\u0000script:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'tauri://localhost',
      'ipc://localhost',
      'vbscript:x',
    ]) {
      expect(classifyLink(href, doc)).toEqual({ kind: 'blocked' });
    }
  });

  it('blocks a URL with whitespace inside, as the Rust side does', () => {
    expect(classifyLink('https://example.com/a b', doc)).toEqual({ kind: 'blocked' });
  });

  it('scrolls to an anchor, decoded', () => {
    expect(classifyLink('#%C3%BCber-uns', doc)).toEqual({ kind: 'anchor', id: 'über-uns' });
  });

  it('opens a relative Markdown or text file as a tab', () => {
    expect(classifyLink('other.md', doc)).toEqual({
      kind: 'local',
      path: '/home/someone/notes/other.md',
    });
    expect(classifyLink('../todo.txt#top', doc)).toEqual({
      kind: 'local',
      path: '/home/someone/todo.txt',
    });
    expect(classifyLink('sub%20dir/a.md?x=1', doc)).toEqual({
      kind: 'local',
      path: '/home/someone/notes/sub dir/a.md',
    });
  });

  it('blocks relative links to anything that is not Markdown or text', () => {
    expect(classifyLink('setup.exe', doc)).toEqual({ kind: 'blocked' });
    expect(classifyLink('folder/', doc)).toEqual({ kind: 'blocked' });
    expect(classifyLink('script.sh', doc)).toEqual({ kind: 'blocked' });
  });

  it('blocks absolute and protocol-relative paths', () => {
    expect(classifyLink('/etc/motd.txt', doc)).toEqual({ kind: 'blocked' });
    expect(classifyLink('//example.com/a.md', doc)).toEqual({ kind: 'blocked' });
    expect(classifyLink('\\\\server\\share\\a.md', doc)).toEqual({ kind: 'blocked' });
  });

  it('has nothing to resolve against in an unsaved buffer', () => {
    expect(classifyLink('other.md', null)).toEqual({ kind: 'blocked' });
  });

  it('keeps Windows separators, and never climbs above the drive', () => {
    expect(resolveRelative('C:\\notes\\a.md', '..\\b.md')).toBe('C:\\b.md');
    expect(resolveRelative('C:\\notes\\a.md', '../../../b.md')).toBeNull();
  });
});

describe('heading slugs', () => {
  it('follows GitHub', () => {
    expect(slugBase('Hello, World!')).toBe('hello-world');
    expect(slugBase('  Über uns  ')).toBe('über-uns');
    expect(slugBase('a_b c-d')).toBe('a_b-c-d');
    expect(slugBase('`code` here')).toBe('code-here');
  });

  it('counts duplicates, and does not collide with a heading named like a duplicate', () => {
    const slug = createSlugger();
    expect([slug('A'), slug('A'), slug('A-1'), slug('A')]).toEqual(['a', 'a-1', 'a-1-1', 'a-2']);
  });
});

describe('scroll sync', () => {
  const anchors = [
    { line: 0, top: 0 },
    { line: 10, top: 200 },
    { line: 20, top: 1000 },
  ];

  it('lands exactly on an anchor', () => {
    expect(previewOffsetForLine(anchors, 10)).toBe(200);
  });

  it('interpolates between anchors', () => {
    expect(previewOffsetForLine(anchors, 15)).toBe(600);
  });

  it('stays on the last anchor past the end', () => {
    expect(previewOffsetForLine(anchors, 99)).toBe(1000);
  });

  it('runs from the top down to a first block that is not on line 0', () => {
    expect(previewOffsetForLine([{ line: 4, top: 80 }], 2)).toBe(40);
  });

  it('has nowhere to go without anchors', () => {
    expect(previewOffsetForLine([], 12)).toBe(0);
  });

  it('folds anchors on the same line, and drops one that runs backwards', () => {
    expect(
      dedupeAnchors([
        { line: 3, top: 50 },
        { line: 3, top: 60 },
        { line: 1, top: 10 },
        { line: 5, top: 40 },
        { line: 6, top: 90 },
      ]),
    ).toEqual([
      { line: 1, top: 10 },
      { line: 3, top: 50 },
      { line: 6, top: 90 },
    ]);
  });
});
