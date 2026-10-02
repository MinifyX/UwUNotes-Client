/**
 * Syntax colours for fenced code in the preview, from the editor's own parts.
 *
 * The grammars are `@codemirror/language-data`'s, the same lazily loaded ones
 * the editor uses, and the colours are `uwuHighlightStyle` — so a Rust block
 * in a README looks exactly like a `.rs` file in the next tab, follows the
 * active theme's tokens, and costs no second highlighting library.
 *
 * Rendering is synchronous, and loading a grammar is not. A block whose
 * language has not been loaded yet is drawn plain, the load starts, and
 * `onLoaded` asks the preview to draw again once it has arrived. The second
 * render finds the grammar in memory.
 */

import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightCode } from '@lezer/highlight';
import { uwuHighlightStyle } from '../../editor/theme';
import { escapeHtml } from './render';

/** Past this, a block is drawn plain: a 2 MB JSON dump in a fence is not worth a frame. */
const MAX_HIGHLIGHT_CHARS = 50_000;

/**
 * Grammars being fetched, and who to tell when each one lands — so twenty
 * Python blocks start one download, and two previews both redraw.
 */
const pending = new Map<LanguageDescription, Set<() => void>>();

export function createHighlighter(
  onLoaded: () => void,
): (code: string, info: string) => string | null {
  return (code, info) => {
    if (code.length > MAX_HIGHLIGHT_CHARS) return null;
    const description = LanguageDescription.matchLanguageName(languages, info, true);
    if (!description) return null;

    const support = description.support;
    if (!support) {
      const waiting = pending.get(description);
      if (waiting) {
        waiting.add(onLoaded);
        return null;
      }
      const listeners = new Set([onLoaded]);
      pending.set(description, listeners);
      description.load().then(
        () => {
          pending.delete(description);
          for (const listener of listeners) listener();
        },
        () => {
          // A grammar that will not load leaves the block plain, which is
          // still a perfectly readable code block. It stays in `pending`, so
          // it is not asked for again on every keystroke.
        },
      );
      return null;
    }

    const tree = support.language.parser.parse(code);
    let html = '';
    highlightCode(
      code,
      tree,
      uwuHighlightStyle,
      (text, classes) => {
        html += classes
          ? `<span class="${escapeHtml(classes)}">${escapeHtml(text)}</span>`
          : escapeHtml(text);
      },
      () => {
        html += '\n';
      },
    );
    return html;
  };
}
