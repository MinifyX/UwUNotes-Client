/**
 * Which documents show a Markdown preview, and how wide it is.
 *
 * The preview is docked inside the editor pane — editor on the left, preview
 * on the right — rather than being a pane of its own in the split tree. A pane
 * holds tabs, and a preview is not a tab: it has no file, no undo history and
 * no business in "close all" or in the session's list of documents. Docking it
 * also keeps the rule that a document lives in exactly one pane, because the
 * preview belongs to the document wherever the document goes; moving the tab
 * to another pane takes its preview along.
 *
 * Per document, so turning the preview on for a README does not turn it on
 * for the CHANGELOG in the next tab. Written into the session with the
 * document. The width is one number for the whole app and kept in the page's
 * storage, like the sidebar: it is a preference about this screen.
 */

import { useSyncExternalStore } from 'react';
import { toggleTaskAtSelection } from '../editor/tasks';
import { resolveLanguage } from '../editor/languages';
import type { Command } from './commands';
import { getMeta, type DocId } from './documents';
import { t } from './i18n';
import { shortcutLabel } from './shortcuts';
import { toast } from './toast';
import { activeView } from './views';
import { activeDocId } from './workspace';

let open: ReadonlySet<DocId> = new Set();
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Markdown by file name or by hand-picked language; the only documents a preview is for. */
export function isMarkdownDoc(id: DocId | null): boolean {
  const meta = id ? getMeta(id) : undefined;
  return meta ? resolveLanguage(meta)?.id === 'markdown' : false;
}

export function previewOpen(id: DocId | null): boolean {
  return id !== null && open.has(id);
}

export function setPreviewOpen(id: DocId, next: boolean): void {
  if (open.has(id) === next) return;
  const copy = new Set(open);
  if (next) copy.add(id);
  else copy.delete(id);
  open = copy;
  announce();
}

export function togglePreview(id: DocId): void {
  setPreviewOpen(id, !open.has(id));
}

/** Whether this document's preview is switched on — the component redraws when it flips. */
export function usePreviewOpen(id: DocId | null): boolean {
  return useSyncExternalStore(subscribe, () => previewOpen(id));
}

/* ── Width ─────────────────────────────────────────────── */

const RATIO_KEY = 'uwunotes.previewRatio';
/** The editor's share of the pane; neither side may be squeezed below a fifth. */
export const MIN_PREVIEW_RATIO = 0.2;
export const MAX_PREVIEW_RATIO = 0.8;

function clampRatio(value: number): number {
  return Math.min(MAX_PREVIEW_RATIO, Math.max(MIN_PREVIEW_RATIO, value));
}

function loadRatio(): number {
  try {
    const stored = Number(window.localStorage.getItem(RATIO_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampRatio(stored) : 0.5;
  } catch {
    return 0.5;
  }
}

let ratio = loadRatio();

export function previewRatio(): number {
  return ratio;
}

export function usePreviewRatio(): number {
  return useSyncExternalStore(subscribe, previewRatio);
}

export function setPreviewRatio(next: number): void {
  const clamped = clampRatio(next);
  if (clamped === ratio) return;
  ratio = clamped;
  try {
    window.localStorage.setItem(RATIO_KEY, String(clamped));
  } catch {
    // Lost on restart, correct now.
  }
  announce();
}

/* ── Session ───────────────────────────────────────────── */

/** `true` or nothing: a closed preview is the default and needs no field in the file. */
export function previewForSession(id: DocId): true | undefined {
  return open.has(id) ? true : undefined;
}

/* ── Commands ──────────────────────────────────────────── */

export function markdownCommands(): Command[] {
  return [
    {
      id: 'markdown.togglePreview',
      title: () => t('Markdown-Vorschau umschalten'),
      group: () => t('Ansicht'),
      shortcut: shortcutLabel('markdown.togglePreview'),
      enabled: () => isMarkdownDoc(activeDocId()),
      run: () => {
        const id = activeDocId();
        if (id && isMarkdownDoc(id)) togglePreview(id);
      },
    },
    {
      id: 'markdown.toggleTask',
      title: () => t('Aufgabe abhaken'),
      group: () => t('Bearbeiten'),
      shortcut: shortcutLabel('markdown.toggleTask'),
      enabled: () => activeView() !== undefined,
      run: () => {
        const view = activeView();
        if (!view) return;
        if (!toggleTaskAtSelection(view)) {
          toast('info', t('In dieser Zeile steht keine Aufgabe wie „- [ ] …“.'));
        }
        view.focus();
      },
    },
  ];
}
