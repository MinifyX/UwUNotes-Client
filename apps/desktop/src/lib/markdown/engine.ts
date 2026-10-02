/**
 * The one door into the Markdown stack, for `import()`.
 *
 * markdown-it, its linkifier and DOMPurify are around a hundred kilobytes that
 * nobody who never opens a preview should download, parse or wait for at
 * start-up. The preview imports this module dynamically, Vite splits it and
 * everything only it pulls in into a chunk of its own, and the main bundle
 * does not grow.
 */

import { createHighlighter } from './highlight';
import { createRenderer, type RenderLabels } from './render';

export function createPreviewRenderer(
  labels: RenderLabels,
  onGrammarLoaded: () => void,
): (source: string) => string {
  return createRenderer({ labels, highlight: createHighlighter(onGrammarLoaded) });
}
