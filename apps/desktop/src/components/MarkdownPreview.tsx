/**
 * The Markdown preview, docked to the right of the editor inside its pane.
 *
 * Why docked and not a pane of its own is in `lib/preview.ts`. This file is
 * the drawing: a divider to drag, a header with a close button, and the
 * rendered document, kept in step with the editor three ways.
 *
 * - **Live.** The store says when the document's state changed
 *   (`subscribeDocState`), the way the status bar follows the caret, and the
 *   text is compared by identity — a CodeMirror `Text` is immutable, so "did
 *   it change" costs one comparison. A change re-renders after a short pause,
 *   longer for big documents, so typing never waits for markdown-it.
 * - **Scroll.** Every block carries the source line it starts on. When the
 *   editor scrolls, the line at its top is looked up among those anchors and
 *   the preview follows (`lib/markdown/scroll-sync.ts`). One direction only:
 *   two scroll positions that each chase the other end up fighting.
 * - **Checkboxes.** A click on a task box changes the source, as one undoable
 *   edit, and the preview redraws from the new text. The box itself never
 *   holds a state of its own.
 *
 * The HTML is written with `innerHTML`, which is safe here only because of
 * everything `lib/markdown/render.ts` does first — raw HTML off, links
 * filtered, DOMPurify last. And no click is ever left to the browser: links
 * are intercepted and sorted by `classifyLink()`.
 *
 * The Markdown stack is loaded with `import()` the first time a preview opens,
 * so nobody who never opens one pays for it at start-up.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { toggleTasksOnLines } from '../editor/tasks';
import { asApiError, openExternal } from '../lib/api';
import { getDoc, getMeta, subscribeDocState, type DocId } from '../lib/documents';
import { openPaths } from '../lib/files';
import { t, useLanguage } from '../lib/i18n';
import type { PaneId } from '../lib/layout';
import { classifyLink } from '../lib/markdown/links';
import { dedupeAnchors, previewOffsetForLine, type LineAnchor } from '../lib/markdown/scroll-sync';
import {
  MAX_PREVIEW_RATIO,
  MIN_PREVIEW_RATIO,
  previewRatio,
  setPreviewOpen,
  setPreviewRatio,
  usePreviewRatio,
} from '../lib/preview';
import { toast } from '../lib/toast';
import { viewFor } from '../lib/views';
import { Icon } from './Icon';

type Engine = typeof import('../lib/markdown/engine');

/** One download for every preview in the window, started by the first. */
let engine: Promise<Engine> | null = null;
function loadEngine(): Promise<Engine> {
  engine ??= import('../lib/markdown/engine');
  // A failed import must not stick: the next preview that opens tries again.
  engine.catch(() => {
    engine = null;
  });
  return engine;
}

/** Past this, the preview stops re-rendering on its own: markdown-it on 5 MB is a stall. */
const MAX_PREVIEW_CHARS = 5_000_000;
/** The pause after typing before the preview re-renders, by document size. */
function debounceFor(length: number): number {
  if (length > 1_000_000) return 1_200;
  if (length > 200_000) return 500;
  return 150;
}

/** A heading id with its `md-` prefix, for `#anchor` links; see `render.ts`. */
const HEADING_PREFIX = 'md-';

type Status = 'loading' | 'ready' | 'failed' | 'tooLarge';

export function MarkdownPreview({ pane, docId }: { pane: PaneId; docId: DocId }) {
  const language = useLanguage();
  const [status, setStatus] = useState<Status>('loading');
  const [empty, setEmpty] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<((source: string) => string) | null>(null);
  /** Measured lazily after each render; `null` means "measure before using". */
  const anchorsRef = useRef<LineAnchor[] | null>(null);
  /** Bumped to force a redraw of the same text — a grammar arrived, the language changed. */
  const [generation, setGeneration] = useState(0);

  // The renderer, rebuilt when the UI language changes: its labels are text.
  useEffect(() => {
    let cancelled = false;
    loadEngine().then(
      (module) => {
        if (cancelled) return;
        renderRef.current = module.createPreviewRenderer(
          {
            remoteImage: t('Externes Bild:'),
            localImage: t('Lokales Bild:'),
            headingLink: t('Link zu dieser Überschrift'),
          },
          () => setGeneration((value) => value + 1),
        );
        setStatus('ready');
        setGeneration((value) => value + 1);
      },
      () => {
        if (!cancelled) setStatus('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [language]);

  /** Where the preview should be for the editor's current scroll position. */
  const syncScroll = useCallback(() => {
    const view = viewFor(pane);
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!view || !body || !content) return;

    const scroller = view.scrollDOM;
    // At the very bottom of the editor, the preview goes to its bottom too —
    // the last lines rarely have an anchor far enough down to get it there.
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
      body.scrollTop = body.scrollHeight;
      return;
    }

    if (!anchorsRef.current) {
      const top = content.getBoundingClientRect().top - body.scrollTop;
      const measured: LineAnchor[] = [];
      for (const element of content.querySelectorAll<HTMLElement>('[data-line]')) {
        const line = Number(element.dataset.line);
        if (Number.isFinite(line)) {
          measured.push({ line, top: element.getBoundingClientRect().top - top });
        }
      }
      anchorsRef.current = dedupeAnchors(measured);
    }

    const block = view.lineBlockAtHeight(scroller.scrollTop);
    const lineIndex = view.state.doc.lineAt(block.from).number - 1;
    const within = block.height > 0 ? (scroller.scrollTop - block.top) / block.height : 0;
    body.scrollTop = previewOffsetForLine(
      anchorsRef.current,
      lineIndex + Math.max(0, Math.min(1, within)),
    );
  }, [pane]);

  // Following the text: listen, compare, debounce, render.
  useEffect(() => {
    if (status !== 'ready') return;
    let timer = 0;
    let shown: unknown = null;
    let first = true;

    const draw = () => {
      const render = renderRef.current;
      const content = contentRef.current;
      const state = getDoc(docId)?.state;
      if (!render || !content || !state) return;
      if (state.doc.length > MAX_PREVIEW_CHARS) {
        setStatus('tooLarge');
        return;
      }
      const source = state.doc.toString();
      content.innerHTML = render(source);
      anchorsRef.current = null;
      setEmpty(source.trim() === '');
      syncScroll();
    };

    const look = () => {
      // The store rather than the view: every transaction is written back to
      // it, and it is never caught mid-switch showing the previous tab.
      const state = getDoc(docId)?.state;
      if (!state || state.doc === shown) return;
      shown = state.doc;
      window.clearTimeout(timer);
      if (first) {
        first = false;
        draw();
      } else {
        timer = window.setTimeout(draw, debounceFor(state.doc.length));
      }
    };

    look();
    const stop = subscribeDocState((id) => {
      if (id === docId) look();
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [status, pane, docId, generation, syncScroll]);

  // Following the scroll. The pane's view lives as long as the pane, so the
  // listener is attached once and survives tab switches.
  useEffect(() => {
    const view = viewFor(pane);
    if (!view) return;
    const scroller = view.scrollDOM;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncScroll);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', onScroll);
    };
  }, [pane, syncScroll]);

  // Re-measure when the preview's width changes: every line wraps differently.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      anchorsRef.current = null;
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;

    const box = target.closest<HTMLInputElement>('input.md-task');
    if (box) {
      // The source decides whether the box is ticked. Letting the browser
      // flip it as well would show a state the text does not have yet.
      event.preventDefault();
      const view = viewFor(pane);
      const line = Number(box.dataset.line);
      if (view && Number.isInteger(line)) toggleTasksOnLines(view, [line + 1]);
      return;
    }

    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    // Whatever happens next, the webview itself goes nowhere.
    event.preventDefault();
    followLink(link.getAttribute('href') ?? '');
  };

  const followLink = (href: string) => {
    const where = classifyLink(href, getMeta(docId)?.path ?? null);
    switch (where.kind) {
      case 'external':
        void openExternal(where.url).catch((error: unknown) => {
          toast('error', asApiError(error).message);
        });
        return;
      case 'anchor': {
        const heading = contentRef.current?.querySelector(
          `#${CSS.escape(`${HEADING_PREFIX}${where.id.toLowerCase()}`)}`,
        );
        heading?.scrollIntoView({ block: 'start' });
        return;
      }
      case 'local':
        void openPaths([where.path]);
        return;
      case 'blocked':
        toast('info', t('Dieser Link wird aus der Vorschau nicht geöffnet.'));
        return;
    }
  };

  return (
    <>
      <PreviewDivider />
      <section className="mdpreview" aria-label={t('Markdown-Vorschau')}>
        <header className="mdpreview-header">
          <span className="mdpreview-title">{t('Vorschau')}</span>
          <button
            type="button"
            className="mdpreview-close"
            title={t('Vorschau schließen')}
            onClick={() => setPreviewOpen(docId, false)}
          >
            <Icon name="close" size={12} title={t('Vorschau schließen')} />
          </button>
        </header>
        <div
          ref={bodyRef}
          className="mdpreview-body"
          // Focusable, so the arrow keys and Page Down can scroll it.
          tabIndex={0}
          onClick={onClick}
          // A middle click on a link is a navigation too, and is refused the same way.
          onAuxClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) event.preventDefault();
          }}
          // Dragging a link out would hand its URL to whatever it is dropped on,
          // including this window — which would then try to open it.
          onDragStart={(event) => event.preventDefault()}
        >
          {status === 'loading' && <p className="mdpreview-note">{t('Vorschau wird geladen…')}</p>}
          {status === 'failed' && (
            <p className="mdpreview-note">{t('Die Vorschau konnte nicht geladen werden.')}</p>
          )}
          {status === 'tooLarge' && (
            <p className="mdpreview-note">{t('Diese Datei ist zu groß für die Vorschau.')}</p>
          )}
          {status === 'ready' && empty && (
            <p className="mdpreview-note">{t('Noch leer hier. Schreib etwas Markdown (・ω・)')}</p>
          )}
          <div ref={contentRef} className="mdpreview-content" hidden={status !== 'ready'} />
        </div>
      </section>
    </>
  );
}

/** One arrow press, and one Page Up or Down, as for the split dividers. */
const NUDGE = 0.02;
const JUMP = 0.1;

/**
 * The handle between editor and preview. The same shape as the split tree's
 * divider in `SplitContainer.tsx` — a wide grab zone with a thin line in it,
 * pointer capture while dragging, the arrow keys for everyone without a mouse
 * — but it writes the one preview width rather than a split's ratio.
 */
function PreviewDivider() {
  const ratio = usePreviewRatio();
  const [dragging, setDragging] = useState(false);

  const ratioAt = (element: HTMLElement, clientX: number): number | null => {
    const box = element.parentElement?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    return (clientX - box.left) / box.width;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const next = ratioAt(event.currentTarget, event.clientX);
    if (next !== null) setPreviewRatio(next);
  };

  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  return (
    <div
      className="split-divider mdpreview-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Breite der Vorschau')}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(MIN_PREVIEW_RATIO * 100)}
      aria-valuemax={Math.round(MAX_PREVIEW_RATIO * 100)}
      aria-valuetext={t('{percent} %', { percent: Math.round(ratio * 100) })}
      tabIndex={0}
      data-dragging={dragging ? true : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => setPreviewRatio(0.5)}
      onKeyDown={(event) => {
        const current = previewRatio();
        if (event.key === 'ArrowLeft') setPreviewRatio(current - NUDGE);
        else if (event.key === 'ArrowRight') setPreviewRatio(current + NUDGE);
        else if (event.key === 'PageUp') setPreviewRatio(current - JUMP);
        else if (event.key === 'PageDown') setPreviewRatio(current + JUMP);
        else if (event.key === 'Home') setPreviewRatio(MIN_PREVIEW_RATIO);
        else if (event.key === 'End') setPreviewRatio(MAX_PREVIEW_RATIO);
        else if (event.key === 'Enter') setPreviewRatio(0.5);
        else return;
        event.preventDefault();
      }}
    >
      <span className="split-divider-line" aria-hidden />
    </div>
  );
}
