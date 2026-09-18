/**
 * The minimap: the shape of the file, drawn small on the right.
 *
 * A canvas rather than DOM, and no dependency. One thin row per line, as wide
 * as the line is long and coloured by how deep it is indented — which is
 * enough to recognise a function, a block comment or a long string table from
 * across the file without reading a character of it. Drawing real text at that
 * size would be unreadable anyway, so we do not pretend.
 *
 * Three things keep it honest on large files:
 *
 * - **Sampling.** Above {@link MAX_ROWS} lines it draws every nth line rather
 *   than all of them. A 200 000 line file has no room for 200 000 rows on a
 *   900 pixel canvas regardless, so the rows would be lost to rounding — this
 *   just skips the work instead of doing it invisibly.
 * - **Device pixels.** The canvas is sized in device pixels and scaled back
 *   down in CSS, or every hairline is a blurry grey smear on a HiDPI screen.
 * - **Repaint discipline.** It redraws on edits, on scrolls and on resizes,
 *   and otherwise not at all.
 *
 * Colours come from {@link readToken} because a canvas cannot take a `var()`.
 * They are read from the editor element rather than from `<html>`, so a theme
 * that overrides `--uwu-code-*` on `.cm-editor` — which is how every variant
 * theme in `themes.ts` works — reaches the minimap too. They are re-read when
 * `data-theme` flips, since that is the one colour change nothing else here
 * would notice.
 */

import { readToken, type Token } from '@uwu/tokens';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** CSS pixels. Wide enough for ~130 columns at the horizontal scale below. */
const WIDTH = 84;
/** Horizontal scale: one column of text to this many CSS pixels. */
const COLUMN_SCALE = 0.62;
/** Longer lines are clipped rather than squeezed; past this it is all wall anyway. */
const MAX_COLUMNS = 130;
/** Above this many lines the map samples instead of drawing every row. */
const MAX_ROWS = 4000;
const ROW_HEIGHT_MAX = 3;
const ROW_GAP = 1;

/**
 * Indentation depth to colour. Four steps is what the eye can separate at one
 * pixel tall; deeper code all shares the last one, which is fine — by then the
 * information is "deeply nested", not "exactly six levels".
 */
const DEPTH_TOKENS: Token[] = [
  '--uwu-code-variable',
  '--uwu-code-function',
  '--uwu-code-type',
  '--uwu-code-comment',
];

type Palette = {
  background: string;
  depths: string[];
  viewport: string;
};

/**
 * A token that resolves to nothing means the stylesheet has not arrived yet,
 * which happens exactly once, on the very first paint. A neutral grey for that
 * one frame beats an invisible minimap or a thrown exception.
 */
function colorOf(name: Token, element: Element): string {
  return readToken(name, element) || '#808080';
}

function readPalette(element: Element): Palette {
  return {
    background: colorOf('--uwu-deep-gutter', element),
    depths: DEPTH_TOKENS.map((name) => colorOf(name, element)),
    viewport: colorOf('--uwu-pink', element),
  };
}

/** Leading whitespace in columns, and where the visible text ends. */
function measureLine(text: string, tabSize: number): { indent: number; length: number } {
  let indent = 0;
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code === 32) indent += 1;
    else if (code === 9) indent += tabSize - (indent % tabSize);
    else break;
    index += 1;
  }
  return { indent, length: Math.max(indent, text.trimEnd().length) };
}

class MinimapView {
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null;
  private palette: Palette;
  private readonly themeWatcher: MutationObserver;
  private readonly sizeWatcher: ResizeObserver;
  private dragging = false;
  private frame = 0;

  constructor(private readonly view: EditorView) {
    this.canvas.className = 'cm-uwuMinimap';
    // Not a control and not content: a blind user gets nothing from a picture
    // of a file, and the scrollbar next to it does the same job accessibly.
    this.canvas.setAttribute('aria-hidden', 'true');
    this.context = this.canvas.getContext('2d');
    this.palette = readPalette(view.dom);

    view.dom.appendChild(this.canvas);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    view.scrollDOM.addEventListener('scroll', this.schedule, { passive: true });

    this.themeWatcher = new MutationObserver(() => {
      this.palette = readPalette(this.view.dom);
      this.schedule();
    });
    this.themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    this.sizeWatcher = new ResizeObserver(this.schedule);
    this.sizeWatcher.observe(view.scrollDOM);

    this.schedule();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) this.schedule();
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.view.scrollDOM.removeEventListener('scroll', this.schedule);
    this.themeWatcher.disconnect();
    this.sizeWatcher.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.canvas.remove();
  }

  /** Several reasons to redraw in one frame cost one redraw. */
  private schedule = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  };

  /**
   * How tall the drawn map is, and how many document lines one row stands for.
   * The map always represents the whole file, never a window onto it — a
   * minimap that itself has to be scrolled has stopped being a map.
   */
  private geometry(height: number) {
    const lines = this.view.state.doc.lines;
    const step = Math.max(1, Math.ceil(lines / MAX_ROWS));
    const rows = Math.ceil(lines / step);
    const rowHeight = Math.min(ROW_HEIGHT_MAX, Math.max(1, height / Math.max(rows, 1)));
    return { lines, step, rows, rowHeight, drawn: Math.min(height, rows * rowHeight) };
  }

  private draw() {
    const { context } = this;
    if (!context) return;

    const scroller = this.view.scrollDOM;
    const height = scroller.clientHeight;
    if (height <= 0) return;

    // The vertical scrollbar keeps its own strip; covering it with a canvas
    // would make it undraggable, and someone always drags it.
    const scrollbar = Math.max(0, scroller.offsetWidth - scroller.clientWidth);
    this.canvas.style.top = `${scroller.offsetTop}px`;
    this.canvas.style.right = `${scrollbar}px`;
    this.canvas.style.width = `${WIDTH}px`;
    this.canvas.style.height = `${height}px`;

    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(WIDTH * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, WIDTH, height);
    context.fillStyle = this.palette.background;
    context.fillRect(0, 0, WIDTH, height);

    const { doc, tabSize } = this.view.state;
    const { lines, step, rowHeight } = this.geometry(height);
    const barHeight = Math.max(1, rowHeight - ROW_GAP);

    for (let number = 1, row = 0; number <= lines; number += step, row += 1) {
      const line = doc.line(number);
      if (!line.text) continue;
      const { indent, length } = measureLine(line.text, tabSize);
      if (length <= indent) continue;

      const depth = Math.min(DEPTH_TOKENS.length - 1, Math.floor(indent / Math.max(1, tabSize)));
      context.fillStyle = this.palette.depths[depth] ?? this.palette.background;
      const x = 3 + Math.min(indent, MAX_COLUMNS) * COLUMN_SCALE;
      const width = Math.min(length - indent, MAX_COLUMNS - indent) * COLUMN_SCALE;
      if (width <= 0) continue;
      context.fillRect(x, row * rowHeight, width, barHeight);
    }

    this.drawViewportBox(context, height);
  }

  private drawViewportBox(context: CanvasRenderingContext2D, height: number) {
    const scroller = this.view.scrollDOM;
    const total = scroller.scrollHeight;
    if (total <= 0) return;
    const { drawn } = this.geometry(height);

    const top = (scroller.scrollTop / total) * drawn;
    const boxHeight = Math.max(8, (scroller.clientHeight / total) * drawn);

    context.globalAlpha = 0.16;
    context.fillStyle = this.palette.viewport;
    context.fillRect(0, top, WIDTH, boxHeight);
    context.globalAlpha = 0.5;
    context.strokeStyle = this.palette.viewport;
    context.lineWidth = 1;
    // The half pixel puts the stroke on the pixel rather than across two of
    // them, which is the difference between a line and a grey blur.
    context.strokeRect(0.5, top + 0.5, WIDTH - 1, Math.max(1, boxHeight - 1));
    context.globalAlpha = 1;
  }

  /** Click or drag: the point under the pointer becomes the middle of the view. */
  private scrollTo(clientY: number) {
    const scroller = this.view.scrollDOM;
    const rect = this.canvas.getBoundingClientRect();
    const { drawn } = this.geometry(scroller.clientHeight);
    if (drawn <= 0) return;
    const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / drawn));
    scroller.scrollTop = fraction * scroller.scrollHeight - scroller.clientHeight / 2;
  }

  private onPointerDown = (event: PointerEvent) => {
    this.dragging = true;
    this.canvas.setPointerCapture(event.pointerId);
    this.scrollTo(event.clientY);
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.dragging) this.scrollTo(event.clientY);
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  };
}

export const minimap: Extension = [
  ViewPlugin.fromClass(MinimapView),
  EditorView.theme({
    // CodeMirror positions the editor itself, but the canvas is placed by
    // `offsetTop` against it — so say so rather than inherit the assumption.
    '&': {
      position: 'relative',
    },
    '.cm-uwuMinimap': {
      position: 'absolute',
      zIndex: '2',
      cursor: 'pointer',
      // The map is decoration over the text's own strip; a border would be a
      // second vertical line next to the scrollbar.
      borderLeft: '1px solid var(--uwu-hairline)',
    },
    // Text stops where the map starts, so nothing disappears underneath it.
    '.cm-scroller': {
      paddingRight: `${WIDTH}px`,
    },
  }),
];
