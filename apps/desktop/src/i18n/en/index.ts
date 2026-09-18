/**
 * The English catalogue: German string → English string, one file per area of
 * the app. See `lib/i18n.ts`.
 */

import app from './app.json';
import editor from './editor.json';
import files from './files.json';
import search from './search.json';
import settings from './settings.json';

export const EN: Readonly<Record<string, string>> = {
  ...app,
  ...files,
  ...editor,
  ...search,
  ...settings,
};
