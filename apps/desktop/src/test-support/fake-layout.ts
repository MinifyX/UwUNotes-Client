/**
 * Enough page layout for CodeMirror to answer geometry questions in jsdom.
 *
 * jsdom has no layout engine. Every element rectangle is zeroes, and
 * `Range.prototype.getClientRects` — which is how CodeMirror measures text —
 * does not exist at all. That matters more than it sounds: vertical cursor
 * motion is *defined* in terms of the screen. `cursorLineDown` asks where the
 * caret is in pixels, then asks what document position sits one line height
 * below that point. In a bare jsdom it throws on the first question.
 *
 * Writing the macro tests around that would mean not testing the one command
 * that proves a macro walks down a file, so instead this installs a screen:
 * every character is {@link CHAR_WIDTH} wide, every line is
 * {@link LINE_HEIGHT} tall, and the content box starts at the origin. A
 * monospace editor is what this app is, so the fiction is a small one.
 *
 * It is a fake *screen*, not a fake editor. CodeMirror still walks its own DOM,
 * runs its own binary searches over these rectangles and reaches its own
 * conclusions; nothing here knows what a macro or a command is. If CodeMirror
 * changes how it measures, these tests will notice.
 */

/** A character cell. The numbers are arbitrary; only their consistency matters. */
const CHAR_WIDTH = 8;
const LINE_HEIGHT = 16;

let installed = false;

/**
 * Patches the geometry methods on `Range` and `Element`.
 *
 * Global and once per test file, which is the same lifetime jsdom itself has:
 * the environment is rebuilt per file, so nothing leaks between them.
 */
export function installFakeLayout(): void {
  if (installed) return;
  installed = true;

  Range.prototype.getClientRects = function (this: Range): DOMRectList {
    return rectList(rangeRect(this));
  };
  Range.prototype.getBoundingClientRect = function (this: Range): DOMRect {
    return rangeRect(this) ?? new DOMRect();
  };
  Element.prototype.getClientRects = function (this: Element): DOMRectList {
    return rectList(elementRect(this));
  };
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    // Everything outside the editor keeps jsdom's answer, which is zeroes.
    return elementRect(this) ?? new DOMRect();
  };
}

/**
 * CodeMirror only ever measures a range inside a single text node — see
 * `textRange()` in `@codemirror/view`. Anything else is not something this
 * shim has been asked for, and guessing would hide the day it is.
 */
function rangeRect(range: Range): DOMRect | null {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || range.endContainer !== node) return null;
  const line = node.parentElement?.closest('.cm-line');
  if (!line) return null;
  const start = columnOf(line, node) * CHAR_WIDTH;
  return new DOMRect(
    start + range.startOffset * CHAR_WIDTH,
    lineTop(line),
    (range.endOffset - range.startOffset) * CHAR_WIDTH,
    LINE_HEIGHT,
  );
}

function elementRect(element: Element): DOMRect | null {
  const line = element.closest('.cm-line');
  if (line === element) {
    return new DOMRect(0, lineTop(line), textLength(line) * CHAR_WIDTH, LINE_HEIGHT);
  }
  if (line) {
    // A styled span inside a line: same row, offset by the text before it.
    return new DOMRect(
      columnOf(line, element) * CHAR_WIDTH,
      lineTop(line),
      textLength(element) * CHAR_WIDTH,
      LINE_HEIGHT,
    );
  }
  const content = element.classList.contains('cm-content')
    ? element
    : element.querySelector('.cm-content');
  return content ? contentRect(content) : null;
}

/**
 * The content box, and with it the editor and the scroller: in a test there is
 * nothing to scroll, so all three are the whole document.
 */
function contentRect(content: Element): DOMRect {
  const lines = [...content.children].filter((child) => child.classList.contains('cm-line'));
  const widest = lines.reduce((longest, line) => Math.max(longest, textLength(line)), 1);
  return new DOMRect(0, 0, widest * CHAR_WIDTH, Math.max(LINE_HEIGHT, lines.length * LINE_HEIGHT));
}

function lineTop(line: Element): number {
  const content = line.parentElement;
  if (!content) return 0;
  return Math.max(0, [...content.children].indexOf(line)) * LINE_HEIGHT;
}

function textLength(node: Node): number {
  return (node.textContent ?? '').length;
}

/** How many characters of the line come before `node`. */
function columnOf(line: Element, node: Node): number {
  let column = 0;
  const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text === node || node.contains(text)) return column;
    column += textLength(text);
  }
  return column;
}

/**
 * A `DOMRectList` cannot be constructed, and CodeMirror uses one as an array
 * with a `length` — so an array with `item()` bolted on is exactly as much of
 * one as anybody here reads. The double assertion is the price of saying so.
 */
function rectList(rect: DOMRect | null): DOMRectList {
  const rects: DOMRect[] = rect ? [rect] : [];
  const list = Object.assign(rects, { item: (index: number) => rects[index] ?? null });
  return list as unknown as DOMRectList;
}
