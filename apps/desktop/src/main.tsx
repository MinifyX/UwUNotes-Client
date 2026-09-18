/**
 * Where the page starts.
 *
 * Three things happen here and nowhere else, in this order:
 *
 * 1. **Stylesheets and fonts**, imported rather than linked, so Vite bundles
 *    them and the app never asks the network for a typeface. Tokens first, then
 *    the app's own rules, because the later files are allowed to lean on the
 *    custom properties the earlier ones define.
 * 2. **Appearance before React.** `applyAppearance()` writes `data-theme`,
 *    `data-motion` and `lang` onto `<html>` while the root is still empty, so
 *    the first paint is already dark and nothing flashes white on the way there.
 * 3. **The editor's base extensions** are handed to the document store. The
 *    store builds an `EditorState` for every file that is opened and must not
 *    import CodeMirror itself to do it; this is the wire between the two.
 *
 * Everything else — restoring the session, the window title, the close guard —
 * belongs to `App.tsx`, which can show something while it happens.
 */

import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/fira-code';

import '@uwu/tokens/tokens.css';
import '@uwu/tokens/code.css';
import './components/nyu/nyu.css';
import './styles/app.css';
import './styles/editor.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { baseExtensions } from './editor/setup';
import { setBaseExtensions } from './lib/documents';
import { applyAppearance } from './lib/settings';

applyAppearance();
setBaseExtensions(baseExtensions);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
