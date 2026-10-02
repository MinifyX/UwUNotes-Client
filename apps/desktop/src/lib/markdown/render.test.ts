/**
 * The preview renderer, held to what it must never produce.
 *
 * Most of this file is hostile input: the point of the renderer is that a
 * Markdown file from anywhere can be shown inside a webview that talks to Rust
 * without anything in it running, loading or navigating. The assertions look
 * at the parsed DOM rather than at strings, because "the string contains
 * `onerror`" is also true of a paragraph that merely mentions it — which is
 * the correct, escaped outcome.
 */

import { describe, expect, it } from 'vitest';
import { createRenderer } from './render';

const render = createRenderer({
  labels: { remoteImage: 'Bild', localImage: 'Lokales Bild', headingLink: 'Link' },
});

function dom(source: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = render(source);
  return host;
}

/** Every attribute anywhere in the tree whose name starts with `on`. */
function eventHandlers(root: HTMLElement): string[] {
  const found: string[] = [];
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      if (attribute.name.toLowerCase().startsWith('on')) found.push(attribute.name);
    }
  }
  return found;
}

describe('raw HTML', () => {
  it('comes out as text, not as elements', () => {
    const root = dom('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(eventHandlers(root)).toEqual([]);
  });

  it('does not let an iframe, an object or a form through', () => {
    const root = dom(
      '<iframe src="https://example.com"></iframe>\n<object data="x"></object>\n<form action="https://example.com"><button>go</button></form>',
    );
    expect(root.querySelector('iframe, object, embed, form, button')).toBeNull();
  });

  it('keeps inline HTML in a paragraph as text too', () => {
    const root = dom('hello <b onclick="alert(1)">there</b> <svg onload=alert(1)>');
    expect(root.querySelector('b, svg')).toBeNull();
    expect(eventHandlers(root)).toEqual([]);
  });
});

describe('links', () => {
  it('refuses javascript: in every spelling, leaving the Markdown as text', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)']) {
      const root = dom(`[x](${href})`);
      expect(root.querySelector('a')).toBeNull();
    }
    const encoded = dom('[x](&#106;avascript:alert(1))');
    for (const link of encoded.querySelectorAll('a')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\s*javascript/i);
    }
  });

  it('refuses data:, file:, vbscript: and the app’s own schemes', () => {
    for (const href of [
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'tauri://localhost',
      'ipc://localhost/x',
    ]) {
      expect(dom(`[x](${href})`).querySelector('a')).toBeNull();
    }
  });

  it('refuses protocol-relative links', () => {
    expect(dom('[x](//example.com/a)').querySelector('a')).toBeNull();
  });

  it('keeps http, https, mailto, anchors and relative paths', () => {
    const root = dom(
      '[a](https://example.com) [b](http://example.com) [c](mailto:someone@example.com) [d](#usage) [e](docs/notes.md)',
    );
    const hrefs = [...root.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://example.com',
      'http://example.com',
      'mailto:someone@example.com',
      '#usage',
      'docs/notes.md',
    ]);
  });

  it('links bare URLs with a scheme, and only those', () => {
    const root = dom('see https://example.com/page and www.example.com');
    const hrefs = [...root.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/page']);
  });

  it('never sets a target, so nothing can open a window by itself', () => {
    const root = dom('[a](https://example.com)');
    expect(root.querySelector('a')?.hasAttribute('target')).toBe(false);
  });
});

describe('images', () => {
  it('does not load a remote image, but offers it as a link', () => {
    const root = dom('![cat](https://example.com/cat.png)');
    expect(root.querySelector('img')).toBeNull();
    const link = root.querySelector('a.md-image-blocked');
    expect(link?.getAttribute('href')).toBe('https://example.com/cat.png');
    expect(link?.textContent).toContain('cat');
  });

  it('does not load a local image', () => {
    const root = dom('![diagram](./diagram.png)');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.md-image-blocked')?.textContent).toContain('diagram');
  });

  it('shows an inline raster image', () => {
    const root = dom('![dot](data:image/png;base64,iVBORw0KGgo=)');
    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });

  it('refuses an inline SVG, which is a document with scripts of its own', () => {
    const root = dom('![x](data:image/svg+xml;base64,PHN2Zy8+)');
    expect(root.querySelector('img')).toBeNull();
  });

  it('escapes an alt text that tries to break out of its attribute', () => {
    const root = dom('![" onerror="alert(1)](data:image/png;base64,iVBORw0KGgo=)');
    expect(eventHandlers(root)).toEqual([]);
  });
});

describe('GitHub flavour', () => {
  it('draws tables, with alignment as a class rather than a style', () => {
    const root = dom('| a | b |\n|:--|--:|\n| 1 | 2 |');
    expect(root.querySelector('table')).not.toBeNull();
    expect(root.querySelector('td.md-align-right')?.textContent).toBe('2');
    expect(root.querySelector('[style]')).toBeNull();
  });

  it('strikes through', () => {
    expect(dom('~~gone~~').querySelector('s, del')?.textContent).toBe('gone');
  });

  it('turns task items into checkboxes that know their source line', () => {
    const root = dom('intro\n\n- [ ] open\n- [x] done\n- not a task\n- [y] neither');
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input.md-task')];
    expect(boxes.map((box) => [box.type, box.checked, box.dataset.line])).toEqual([
      ['checkbox', false, '2'],
      ['checkbox', true, '3'],
    ]);
    expect(root.querySelectorAll('li.md-task-item')).toHaveLength(2);
    expect(root.textContent).toContain('[y] neither');
  });

  it('does not let a task item smuggle markup into the checkbox', () => {
    const root = dom('- [ ] <img src=x onerror=alert(1)>');
    expect(root.querySelector('img')).toBeNull();
    expect(eventHandlers(root)).toEqual([]);
  });

  it('gives headings GitHub-style anchors, prefixed so they collide with nothing', () => {
    const root = dom('# Hello World\n\n## Über uns\n\n## Hello World');
    const ids = [...root.querySelectorAll('h1, h2')].map((heading) => heading.id);
    expect(ids).toEqual(['md-hello-world', 'md-über-uns', 'md-hello-world-1']);
    expect(root.querySelector('h1 a.md-heading-anchor')?.getAttribute('href')).toBe('#hello-world');
  });

  it('marks blocks with the line they start on', () => {
    const root = dom('# Title\n\ntext\n\n```js\nlet a;\n```');
    expect(root.querySelector('h1')?.getAttribute('data-line')).toBe('0');
    expect(root.querySelector('p')?.getAttribute('data-line')).toBe('2');
    expect(root.querySelector('pre')?.getAttribute('data-line')).toBe('4');
  });

  it('escapes code, highlighted or not', () => {
    const root = dom('```html\n<script>alert(1)</script>\n```');
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('pre code')?.textContent).toContain('<script>');
  });
});

describe('a highlighter that misbehaves', () => {
  it('is still sanitized afterwards', () => {
    const evil = createRenderer({
      labels: { remoteImage: '', localImage: '', headingLink: '' },
      highlight: () => '<img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>',
    });
    const host = document.createElement('div');
    host.innerHTML = evil('```js\nx\n```');
    expect(host.querySelector('img')?.hasAttribute('src') ?? false).toBe(false);
    expect(host.querySelector('a')?.getAttribute('href') ?? null).toBeNull();
    expect(eventHandlers(host)).toEqual([]);
  });
});
