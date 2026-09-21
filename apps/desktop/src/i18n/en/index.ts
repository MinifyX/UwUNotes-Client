/**
 * The English catalogue: German string → English string, one file per area of
 * the app. See `lib/i18n.ts`.
 */

import app from './app.json';
import chrome from './chrome.json';
import editor from './editor.json';
import files from './files.json';
import macros from './macros.json';
import search from './search.json';
import settings from './settings.json';
import updates from './updates.json';

export const EN: Readonly<Record<string, string>> = {
  ...app,
  ...chrome,
  ...files,
  ...editor,
  ...search,
  ...settings,
  ...macros,
  ...updates,
};
