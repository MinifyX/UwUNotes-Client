/**
 * The macOS menu bar's link to the page: installs the native menu and asks for
 * a rebuild whenever something a menu shows may have changed.
 *
 * Renders nothing. It subscribes to every store the menus in `lib/menus.ts`
 * read — which file is active and dirty, the recent list, the settings that
 * are ticked, the language, the sidebar, zen, the comparison, macros, Nyu's
 * Pomodoro, the open dialog — and each re-render asks `lib/native-menu.ts` for
 * a rebuild, which folds bursts together and sends only what changed. Mounted
 * only on macOS.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useSidebarOpen } from '../lib/chrome';
import { useUiState } from '../lib/commands';
import { useCompare } from '../lib/compare';
import { documentsVersion, subscribeDocuments } from '../lib/documents';
import { useLanguage } from '../lib/i18n';
import { useMacros } from '../lib/macros';
import { installNativeMenu, refreshNativeMenu } from '../lib/native-menu';
import { usePomodoro } from '../lib/nyu-pomodoro';
import { useSettings } from '../lib/settings';
import { useUpdatesAvailableInApp } from '../lib/updates';
import { useWorkspace } from '../lib/workspace';
import { useZen } from '../lib/zen';

export function NativeMenu() {
  useEffect(() => installNativeMenu(), []);

  useLanguage();
  useSettings();
  useWorkspace();
  useSyncExternalStore(subscribeDocuments, documentsVersion);
  useSidebarOpen();
  useZen();
  useCompare();
  useMacros();
  usePomodoro();
  useUiState();
  // Whether "Nach Updates suchen" belongs in the app menu, known a moment after start.
  useUpdatesAvailableInApp();

  // Every render is a "something changed"; the rebuild itself is debounced.
  useEffect(() => refreshNativeMenu());

  return null;
}
