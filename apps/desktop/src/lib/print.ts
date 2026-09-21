/**
 * File → Print.
 *
 * Printing the window would print the window: title bar, tabs, sidebar and the
 * forty lines CodeMirror happens to have in the DOM, because it only renders
 * what is visible. So a print gets a document of its own — a plain copy of the
 * whole text in a `<pre>`, with the file name on top — that the stylesheet
 * shows only under `@media print`, while everything else is hidden there.
 *
 * The copy is built with `textContent`, never markup: the text is whatever the
 * file holds, and a file is not trusted to be anything in particular.
 *
 * It stays in the page until the next print replaces it. `afterprint` would be
 * the obvious moment to remove it, but WKWebView never sends one, and a hidden
 * `<pre>` costs nothing on screen.
 */

import { asApiError, printPage } from './api';
import { docText, getMeta, type DocId } from './documents';
import { describeApiError } from './files';
import { toast } from './toast';

const ROOT_ID = 'print-root';

export async function printDoc(id: DocId): Promise<void> {
  const meta = getMeta(id);
  if (!meta) return;

  document.getElementById(ROOT_ID)?.remove();
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'print-root';
  const header = document.createElement('header');
  header.className = 'print-header';
  header.textContent = meta.path ?? meta.name;
  const body = document.createElement('pre');
  body.className = 'print-body';
  body.textContent = docText(id);
  root.append(header, body);
  document.body.append(root);

  try {
    await printPage();
  } catch (error) {
    toast('error', describeApiError(asApiError(error), null));
  }
}
