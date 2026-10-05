/**
 * The views the sidebar can show, in the order of their buttons.
 *
 * One entry per view, and a view brings everything it needs in its own file —
 * the panel itself knows nothing about files, notes or outlines. Adding a view
 * is one import and one line here.
 */

import type { ComponentType } from 'react';
import { N_ } from '../../lib/i18n';
import type { AppIcon } from '../../lib/icons';
import { BookmarksView } from './BookmarksView';
import { FilesView } from './FilesView';
import { OutlineView } from './OutlineView';
import { HistoryView } from './HistoryView';
import { NotebookView } from './NotebookView';
import { TrashView } from './TrashView';

export type SidebarView = {
  /** Stable: remembered in the page's storage as the last view shown. */
  id: string;
  /** German source string, marked with `N_` and translated where it is shown. */
  label: string;
  icon: AppIcon;
  Component: ComponentType;
};

export const SIDEBAR_VIEWS: readonly SidebarView[] = [
  { id: 'files', label: N_('Dateien'), icon: 'folder', Component: FilesView },
  { id: 'outline', label: N_('Gliederung'), icon: 'outline', Component: OutlineView },
  { id: 'bookmarks', label: N_('Lesezeichen'), icon: 'bookmark', Component: BookmarksView },
  { id: 'history', label: N_('Zeitreise'), icon: 'history', Component: HistoryView },
  { id: 'notebook', label: N_('Notizbuch'), icon: 'notebook', Component: NotebookView },
  { id: 'trash', label: N_('Papierkorb'), icon: 'delete', Component: TrashView },
];
