/**
 * The app's icon vocabulary: the suite's `ICONS` (`@uwusuite/design`), plus
 * the meanings an editor has and the suite does not have yet — files, folders,
 * saving, splitting, comparing, the sidebar views.
 *
 * Every icon is Lucide, drawn through the package's `<Icon>`, so size and
 * stroke follow the suite (docs/icons.md in the package). One meaning, one
 * glyph: `icons.test.ts` makes sure nothing here reuses a glyph the suite
 * already gives another meaning. The editor meanings move into the package's
 * `ICONS` when a second app needs them.
 */

import { ICONS } from '@uwusuite/design';
import {
  ArchiveRestore,
  BookOpenText,
  Bookmark,
  ChevronsDownUp,
  CopyX,
  File,
  FileDiff,
  FilePlus,
  FileX,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  NotebookText,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Replace,
  Save,
  SaveAll,
  TableOfContents,
  type LucideIcon,
} from 'lucide-react';

export const NOTES_ICONS = {
  file: File,
  newFile: FilePlus,
  folder: Folder,
  folderOpen: FolderOpen,
  newFolder: FolderPlus,
  save: Save,
  saveAll: SaveAll,
  closeFile: FileX,
  closeAll: CopyX,
  print: Printer,
  compare: FileDiff,
  replace: Replace,
  collapseAll: ChevronsDownUp,
  gitBranch: GitBranch,
  sidebarHide: PanelLeftClose,
  sidebarShow: PanelLeftOpen,
  preview: BookOpenText,
  outline: TableOfContents,
  bookmark: Bookmark,
  notebook: NotebookText,
  restore: ArchiveRestore,
} satisfies Record<string, LucideIcon>;

/** Everything the app draws: the suite's meanings and the editor's. */
export const APP_ICONS = { ...ICONS, ...NOTES_ICONS };

export type AppIcon = keyof typeof APP_ICONS;
