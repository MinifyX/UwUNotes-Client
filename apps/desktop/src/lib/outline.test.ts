/**
 * The outline, per kind of source: Markdown headings by line, sections and
 * keys by pattern, symbols from the real Lezer grammars the editor ships.
 *
 * The grammars are the real ones on purpose. The tree walk keys off node
 * names, and a grammar update that renames `FunctionDeclaration` is exactly
 * the regression a hand-built fake tree would hide.
 */

import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { EditorState, type Extension } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { currentOutlineIndex, extractOutline, filterOutline, type OutlineItem } from './outline';

function outline(doc: string, languageId: string | null, language: Extension = []) {
  return extractOutline(EditorState.create({ doc, extensions: language }), languageId);
}

/** `depth:label`, the shape a person reads the sidebar in. */
function shape(items: OutlineItem[]): string[] {
  return items.map((item) => `${item.depth}:${item.label}`);
}

describe('Markdown', () => {
  it('nests ATX and setext headings by level', () => {
    const items = outline(
      '# Title\n\nintro\n\n## One\n\n### One.a\n\nSecond\n------\n\nTop again\n=========\n',
      'markdown',
    );
    expect(shape(items)).toEqual(['0:Title', '1:One', '2:One.a', '1:Second', '0:Top again']);
    expect(items.map((item) => item.line)).toEqual([1, 5, 7, 9, 12]);
  });

  it('ignores headings inside fenced code, and closing hashes', () => {
    const items = outline(
      '# Real ##\n\n```sh\n# not a heading\n```\n\n~~~\n## nor this\n~~~\n## Also real',
      'markdown',
    );
    expect(shape(items)).toEqual(['0:Real', '1:Also real']);
  });

  it('does not take a list item or a rule for a setext heading', () => {
    expect(shape(outline('- item\n---\n\ntext\n\n---\n', 'markdown'))).toEqual([]);
  });

  it('does not indent a document that starts below level one', () => {
    expect(shape(outline('### a\n#### b\n### c', 'markdown'))).toEqual(['0:a', '1:b', '0:c']);
  });

  it('ends a section where the next one of the same or higher level starts', () => {
    const doc = '# A\ntext\n## B\nmore\n# C\n';
    const items = outline(doc, 'markdown');
    expect(items[0]?.to).toBe(doc.indexOf('# C') - 1);
    expect(items[1]?.to).toBe(doc.indexOf('# C') - 1);
    expect(items[2]?.to).toBe(doc.length);
  });
});

describe('line-oriented formats', () => {
  it('lists INI and TOML sections', () => {
    expect(shape(outline('a=1\n[server]\nport=1\n[[bin]]\nname="x"\n; [no]\n', 'toml'))).toEqual([
      '0:server',
      '0:bin',
    ]);
    expect(shape(outline('[core]\neditor = vim\n', 'properties-files'))).toEqual(['0:core']);
  });

  it('lists YAML top-level keys and nothing nested', () => {
    const doc =
      'name: app\n# comment: no\nservices:\n  web:\n    image: x\n- item: no\n"quoted key": 1\n';
    expect(shape(outline(doc, 'yaml'))).toEqual(['0:name', '0:services', '0:"quoted key"']);
  });
});

describe('code', () => {
  it('finds functions, classes and methods in TypeScript, nested', () => {
    const doc = [
      'function top() {}',
      'export class Box {',
      '  open() {}',
      '  close() {}',
      '}',
      'const handler = () => 1;',
      'const value = 3;',
      'interface Shape { x: number }',
    ].join('\n');
    expect(shape(outline(doc, 'typescript', javascript({ typescript: true })))).toEqual([
      '0:top',
      '0:Box',
      '1:open',
      '1:close',
      '0:handler',
      '0:Shape',
    ]);
  });

  it('finds Python functions and classes', () => {
    const doc = 'def a():\n    pass\n\nclass B:\n    def c(self):\n        pass\n';
    expect(shape(outline(doc, 'python', python()))).toEqual(['0:a', '0:B', '1:c']);
  });

  it('finds Rust items, impl blocks by their header', () => {
    const doc =
      'struct Point { x: i32 }\nimpl Point {\n    fn new() -> Self { todo!() }\n}\nfn main() {}\n';
    expect(shape(outline(doc, 'rust', rust()))).toEqual([
      '0:Point',
      '0:impl Point',
      '1:new',
      '0:main',
    ]);
  });

  it('lists only the top-level keys of a JSON document', () => {
    const doc = '{\n  "name": "x",\n  "scripts": { "build": "vite" },\n  "private": true\n}';
    expect(shape(outline(doc, 'json', json()))).toEqual(['0:name', '0:scripts', '0:private']);
  });

  it('has nothing to say about plain text', () => {
    expect(outline('# not markdown', 'text')).toEqual([]);
    expect(outline('# not markdown', null)).toEqual([]);
  });
});

describe('following the caret', () => {
  const doc = '# A\ntext\n## B\nmore\n# C\nend';
  const items = outline(doc, 'markdown');

  it('picks the innermost section the caret is in', () => {
    expect(currentOutlineIndex(items, doc.indexOf('more'))).toBe(1);
    expect(currentOutlineIndex(items, doc.indexOf('text'))).toBe(0);
    expect(currentOutlineIndex(items, doc.indexOf('end'))).toBe(2);
  });

  it('is nothing above the first entry', () => {
    const later = outline('intro\n# A', 'markdown');
    expect(currentOutlineIndex(later, 0)).toBe(-1);
  });
});

describe('filtering', () => {
  it('matches anywhere in the label, ignoring case', () => {
    const items = outline('# Install\n# Usage\n## Installing plugins', 'markdown');
    expect(filterOutline(items, 'INSTALL').map((item) => item.label)).toEqual([
      'Install',
      'Installing plugins',
    ]);
    expect(filterOutline(items, '  ')).toHaveLength(3);
  });
});
