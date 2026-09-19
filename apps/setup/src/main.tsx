/**
 * Where the setup's page starts.
 *
 * The same three steps as the editor's `main.tsx`, minus everything the editor
 * needs and this does not:
 *
 * 1. **Stylesheets and the font**, imported so Vite packs them into the
 *    executable. A setup that asked the network for a typeface would be a setup
 *    that looks wrong on the machine that has no network yet.
 * 2. **Appearance before React.** `data-theme="dark"` is already on `<html>` in
 *    `index.html`, so the very first paint is dark with no script involved at
 *    all; what is left here is the language and whether motion is wanted.
 * 3. **React.**
 *
 * There is no `applyAppearance()` and no settings file: the editor is not
 * installed yet, and a window that lives for ninety seconds does not get a
 * theme picker.
 */

import '@fontsource-variable/manrope';

import '@uwu/tokens/tokens.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isGerman } from './texts';

document.documentElement.lang = isGerman ? 'de' : 'en';

// The attribute both `tokens.css` and `nyu.css` look for. The editor decides
// this from its settings; here the system is the only opinion there is.
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.documentElement.dataset.motion = 'reduced';
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
