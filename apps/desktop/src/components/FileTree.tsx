/**
 * The open folder, as a tree.
 *
 * Lazy from top to bottom: a folder's children are read with `listDir()` the
 * first time it opens, and never again unless something changed them. A file
 * tree that walks the whole disk on mount is a file tree that opens a home
 * directory once and is never trusted again.
 *
 * ## How the expansion is remembered
 *
 * `Settings.collapsedFolders` stores what is *shut*, which only works if the
 * list is complete — otherwise "not in the list" would mean both "the user
 * opened this last week" and "nobody has ever seen this folder", and the second
 * reading would unroll the entire tree on first sight. So every listing that
 * arrives writes its own shut folders into the list, and the rule becomes:
 *
 * - nothing recorded anywhere under this root → the root has never been on
 *   screen, everything starts shut;
 * - something recorded → the list is authoritative for this root, and a folder
 *   missing from it was open when the window last closed.
 *
 * A folder created on disk since the last run is missing from the list and so
 * opens by itself, one level, until its own children are recorded. That is
 * pleasant for a folder the user just made and unpleasant for a `git clone`
 * dropped into an open folder, which is what {@link AUTO_EXPAND_LIMIT} is for.
 *
 * What this module does NOT do: own the folder (that is `lib/workspace.ts`),
 * open dialogs for anything a file operation might ask (that is `lib/files.ts`),
 * or draw the panel around itself (that is `Sidebar.tsx`).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  asApiError,
  createDir,
  createFile,
  joinPath,
  listDir,
  renamePath,
  revealInFileManager,
  trashPath,
  type DirEntry,
  type GitFileStatus,
} from '../lib/api';
import { allDocs, patchMeta, samePath } from '../lib/documents';
import { describeApiError, openPaths } from '../lib/files';
import { useGitStatus } from '../lib/git';
import { locale, t } from '../lib/i18n';
import { ask } from '../lib/prompt';
import { getSettings, updateSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import { applyDocLanguage } from '../editor/setup';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { Icon } from './Icon';

/** Folders opened by memory rather than by a click, per opened root, per run. */
const AUTO_EXPAND_LIMIT = 200;

/** `sanitize()` keeps the first 500 entries, so the newest are written first. */
const COLLAPSED_LIMIT = 500;

/** How long a type-ahead prefix survives without another keystroke. */
const TYPEAHEAD_MS = 700;

/** What the header buttons in `Sidebar.tsx` reach into the tree for. */
export type FileTreeHandle = {
  /** Starts an inline name next to the selection, or in the root. */
  newFile: () => void;
  newFolder: () => void;
  collapseAll: () => void;
  /** Re-reads every folder currently open. */
  refresh: () => void;
};

type Row = {
  entry: DirEntry;
  /** The folder this row lives in — where "new file" puts a sibling. */
  parent: string;
  depth: number;
  expanded: boolean;
};

type Draft = { parent: string; kind: 'file' | 'dir' };

type MenuState = { x: number; y: number; row: Row };

/**
 * Windows disagrees with itself about case and about which slash it meant, so
 * paths are compared through a key rather than directly. Same rule as
 * `samePath` in `lib/documents.ts`, which compares two paths but cannot be a
 * `Set` key.
 */
const CASE_INSENSITIVE = navigator.userAgent.includes('Windows');

function pathKey(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return CASE_INSENSITIVE ? slashed.toLowerCase() : slashed;
}

function isInside(folder: string, path: string): boolean {
  const base = pathKey(folder);
  return pathKey(path).startsWith(`${base}/`);
}

function rowId(path: string): string {
  return `filetree-${encodeURIComponent(pathKey(path))}`;
}

/** Folders first, then files, each run through a human-order comparison. */
function sortEntries(entries: DirEntry[], collator: Intl.Collator): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return collator.compare(a.name, b.name);
  });
}

/** The word a screen reader gets after the file name when git has an opinion. */
function gitLabel(status: GitFileStatus): string {
  switch (status) {
    case 'added':
      return t('hinzugefügt');
    case 'modified':
      return t('geändert');
    case 'deleted':
      return t('gelöscht');
    case 'untracked':
      return t('nicht versioniert');
    case 'conflicted':
      return t('Konflikt');
  }
}

export const FileTree = forwardRef<FileTreeHandle, { root: string }>(function FileTree(
  { root },
  handle,
) {
  /**
   * The tree itself lives in a ref and React is only told to redraw.
   *
   * The loader is recursive and asynchronous: by the time a `listDir()` lands,
   * three more may be in flight, and every one of them has to see what the
   * others already wrote. A `useState` snapshot captured in a closure sees
   * whatever was true when the call started, which is how listings go missing.
   */
  const tree = useRef({
    listings: new Map<string, DirEntry[]>(),
    expanded: new Set<string>(),
    loading: new Set<string>(),
  });
  const [version, redraw] = useReducer((count: number) => count + 1, 0);

  /** Bumped when the root changes, so a late listing for the old one is dropped. */
  const generation = useRef(0);
  const autoExpands = useRef(AUTO_EXPAND_LIMIT);

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const container = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef({ prefix: '', at: 0 });

  const collator = useMemo(
    () => new Intl.Collator(locale(), { numeric: true, sensitivity: 'base' }),
    [],
  );

  /* ── Remembering what is open ────────────────────────── */

  const rememberCollapsed = useCallback((shut: string[], opened: string[]) => {
    const added = new Set(shut.map(pathKey));
    const removed = new Set(opened.map(pathKey));
    const kept = getSettings().collapsedFolders.filter((path) => {
      const key = pathKey(path);
      return !added.has(key) && !removed.has(key);
    });
    if (added.size === 0 && kept.length === getSettings().collapsedFolders.length) return;
    updateSettings({ collapsedFolders: [...shut, ...kept].slice(0, COLLAPSED_LIMIT) });
  }, []);

  /**
   * Records this listing's folders and returns the ones that should open by
   * themselves. See the module comment for why the recording has to happen
   * here and not when a folder is clicked.
   */
  const restoreExpansion = useCallback(
    (entries: DirEntry[]): string[] => {
      const stored = getSettings().collapsedFolders;
      const collapsed = new Set(stored.map(pathKey));
      const known = stored.some((path) => isInside(root, path) || samePath(path, root));

      const opening: string[] = [];
      const shutting: string[] = [];
      for (const entry of entries) {
        if (entry.kind !== 'dir') continue;
        const key = pathKey(entry.path);
        if (tree.current.expanded.has(key)) continue;
        if (known && !collapsed.has(key) && autoExpands.current > 0) {
          autoExpands.current -= 1;
          opening.push(entry.path);
        } else if (!collapsed.has(key)) {
          shutting.push(entry.path);
        }
      }
      if (shutting.length > 0) rememberCollapsed(shutting, []);
      return opening;
    },
    [rememberCollapsed, root],
  );

  /* ── Reading folders ─────────────────────────────────── */

  const load = useCallback(
    async function loadFolder(folder: string, force = false): Promise<void> {
      if (!force && tree.current.listings.has(folder)) return;
      if (tree.current.loading.has(folder)) return;
      const mine = generation.current;
      tree.current.loading.add(folder);
      redraw();
      try {
        const entries = await listDir(folder);
        if (generation.current !== mine) return;
        const sorted = sortEntries(entries, collator);
        tree.current.listings.set(folder, sorted);
        for (const path of restoreExpansion(sorted)) {
          tree.current.expanded.add(pathKey(path));
          void loadFolder(path);
        }
      } catch (error) {
        // A folder that cannot be read is worth one line and no dialog: the
        // usual cause is a permission the user already knows about.
        toast('error', describeApiError(asApiError(error), folder));
      } finally {
        tree.current.loading.delete(folder);
        redraw();
      }
    },
    [collator, restoreExpansion],
  );

  useEffect(() => {
    generation.current += 1;
    autoExpands.current = AUTO_EXPAND_LIMIT;
    tree.current = { listings: new Map(), expanded: new Set(), loading: new Set() };
    setSelected(null);
    setDraft(null);
    setRenaming(null);
    setMenu(null);
    redraw();
    void load(root, true);
  }, [load, root]);

  const rows = useMemo(() => {
    const flat: Row[] = [];
    const walk = (folder: string, depth: number) => {
      const entries = tree.current.listings.get(folder);
      if (!entries) return;
      for (const entry of entries) {
        const open = entry.kind === 'dir' && tree.current.expanded.has(pathKey(entry.path));
        flat.push({ entry, parent: folder, depth, expanded: open });
        if (open) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return flat;
    // `version` is the redraw signal; the tree itself is in a ref on purpose.
  }, [root, version]);

  const rowFor = useCallback(
    (key: string | null) => (key ? rows.find((row) => pathKey(row.entry.path) === key) : undefined),
    [rows],
  );

  /* ── Opening and closing ─────────────────────────────── */

  const setExpanded = useCallback(
    (folder: string, open: boolean) => {
      const key = pathKey(folder);
      if (open) {
        tree.current.expanded.add(key);
        rememberCollapsed([], [folder]);
        void load(folder);
      } else {
        tree.current.expanded.delete(key);
        rememberCollapsed([folder], []);
      }
      redraw();
    },
    [load, rememberCollapsed],
  );

  const activate = useCallback(
    (row: Row) => {
      setSelected(pathKey(row.entry.path));
      if (row.entry.kind === 'dir') setExpanded(row.entry.path, !row.expanded);
      else void openPaths([row.entry.path]);
    },
    [setExpanded],
  );

  /** Where a new file or folder goes: into the selection, or next to it. */
  const targetFolder = useCallback((): string => {
    const row = rowFor(selected);
    if (!row) return root;
    return row.entry.kind === 'dir' ? row.entry.path : row.parent;
  }, [root, rowFor, selected]);

  const startDraft = useCallback(
    (kind: Draft['kind']) => {
      const parent = targetFolder();
      if (parent !== root) {
        tree.current.expanded.add(pathKey(parent));
        rememberCollapsed([], [parent]);
        void load(parent);
      }
      setRenaming(null);
      setDraft({ parent, kind });
      redraw();
    },
    [load, rememberCollapsed, root, targetFolder],
  );

  useImperativeHandle(
    handle,
    (): FileTreeHandle => ({
      newFile: () => startDraft('file'),
      newFolder: () => startDraft('dir'),
      collapseAll: () => {
        const open = [...tree.current.expanded];
        tree.current.expanded.clear();
        const paths = rows
          .filter((row) => row.entry.kind === 'dir' && open.includes(pathKey(row.entry.path)))
          .map((row) => row.entry.path);
        rememberCollapsed(paths, []);
        redraw();
      },
      refresh: () => {
        for (const folder of [...tree.current.listings.keys()]) void load(folder, true);
      },
    }),
    [load, rememberCollapsed, rows, startDraft],
  );

  /* ── Changing what is on disk ────────────────────────── */

  const forget = useCallback((folder: string) => {
    for (const known of [...tree.current.listings.keys()]) {
      if (samePath(known, folder) || isInside(folder, known)) tree.current.listings.delete(known);
    }
    for (const key of [...tree.current.expanded]) {
      if (key === pathKey(folder) || isInside(folder, key)) tree.current.expanded.delete(key);
    }
  }, []);

  const commitDraft = useCallback(
    async (name: string) => {
      const pending = draft;
      setDraft(null);
      const clean = name.trim();
      if (!pending || !clean) return;
      try {
        const path = await joinPath(pending.parent, clean);
        if (pending.kind === 'dir') await createDir(path);
        else await createFile(path);
        await load(pending.parent, true);
        setSelected(pathKey(path));
        if (pending.kind === 'file') await openPaths([path]);
        else setExpanded(path, true);
      } catch (error) {
        toast('error', describeApiError(asApiError(error), pending.parent));
      }
    },
    [draft, load, setExpanded],
  );

  const commitRename = useCallback(
    async (row: Row, name: string) => {
      setRenaming(null);
      const clean = name.trim();
      if (!clean || clean === row.entry.name) return;
      const from = row.entry.path;
      try {
        const to = await joinPath(row.parent, clean);
        await renamePath(from, to);
        // A file that is open has to follow: a tab still pointing at the old
        // path would recreate it on the next save, under the old name.
        for (const doc of allDocs()) {
          const path = doc.meta.path;
          if (!path) continue;
          if (samePath(path, from)) {
            patchMeta(doc.meta.id, { path: to, name: clean });
            void applyDocLanguage(doc.meta.id);
          } else if (isInside(from, path)) {
            patchMeta(doc.meta.id, { path: `${to}${path.slice(from.length)}` });
          }
        }
        forget(from);
        await load(row.parent, true);
        setSelected(pathKey(to));
      } catch (error) {
        toast('error', describeApiError(asApiError(error), from));
      }
    },
    [forget, load],
  );

  const removeRow = useCallback(
    async (row: Row) => {
      const answer = await ask(
        t('In den Papierkorb legen?'),
        row.entry.kind === 'dir'
          ? t('{name} und alles darin wird in den Papierkorb verschoben.', {
              name: row.entry.name,
            })
          : t('{name} wird in den Papierkorb verschoben.', { name: row.entry.name }),
        [
          { id: 'trash', label: t('In den Papierkorb'), tone: 'danger' },
          { id: 'cancel', label: t('Abbrechen'), tone: 'quiet' },
        ],
      );
      if (answer !== 'trash') return;
      try {
        await trashPath(row.entry.path);
        forget(row.entry.path);
        await load(row.parent, true);
      } catch (error) {
        toast('error', describeApiError(asApiError(error), row.entry.path));
      }
    },
    [forget, load],
  );

  const copyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast('success', t('Pfad kopiert.'));
    } catch {
      toast('error', t('Der Pfad ließ sich nicht in die Zwischenablage legen.'));
    }
  }, []);

  /* ── Keyboard ────────────────────────────────────────── */

  const move = useCallback(
    (to: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (row) setSelected(pathKey(row.entry.path));
    },
    [rows],
  );

  const jumpByPrefix = useCallback(
    (character: string, from: number) => {
      if (rows.length === 0) return;
      const now = Date.now();
      const state = typeahead.current;
      state.prefix = now - state.at > TYPEAHEAD_MS ? character : state.prefix + character;
      state.at = now;
      const prefix = state.prefix.toLowerCase();
      // A single letter starts looking *after* the current row, so pressing it
      // again walks through the matches; a growing prefix re-checks the row it
      // already landed on, so typing "re" does not skip `readme.md`.
      const first = state.prefix.length > 1 ? 0 : 1;
      for (let step = first; step < rows.length + first; step += 1) {
        const row = rows[(from + step) % rows.length];
        if (row && row.entry.name.toLowerCase().startsWith(prefix)) {
          setSelected(pathKey(row.entry.path));
          return;
        }
      }
    },
    [rows],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // An inline name field is inside the tree and owns every key while it is
      // open; only keys aimed at the tree itself are ours.
      if (event.target !== event.currentTarget) return;

      const index = rows.findIndex((row) => pathKey(row.entry.path) === selected);
      const row = rows[index];

      const openMenuForRow = (target: Row) => {
        const element = container.current?.querySelector(
          `#${CSS.escape(rowId(target.entry.path))}`,
        );
        const box = element?.getBoundingClientRect();
        setMenu({ x: box ? box.left + 12 : 0, y: box ? box.bottom : 0, row: target });
      };

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          move(index + 1);
          return;
        case 'ArrowUp':
          event.preventDefault();
          move(index < 0 ? rows.length - 1 : index - 1);
          return;
        case 'Home':
          event.preventDefault();
          move(0);
          return;
        case 'End':
          event.preventDefault();
          move(rows.length - 1);
          return;
        case 'ArrowRight':
          if (!row) return;
          event.preventDefault();
          if (row.entry.kind === 'dir' && !row.expanded) setExpanded(row.entry.path, true);
          else if (row.entry.kind === 'dir') move(index + 1);
          return;
        case 'ArrowLeft': {
          if (!row) return;
          event.preventDefault();
          if (row.entry.kind === 'dir' && row.expanded) {
            setExpanded(row.entry.path, false);
            return;
          }
          const parent = rows.findIndex((other) => samePath(other.entry.path, row.parent));
          if (parent >= 0) move(parent);
          return;
        }
        case 'Enter':
        case ' ':
          if (!row) return;
          event.preventDefault();
          activate(row);
          return;
        case 'F2':
          if (!row) return;
          event.preventDefault();
          setRenaming(pathKey(row.entry.path));
          return;
        case 'Delete':
          if (!row) return;
          event.preventDefault();
          void removeRow(row);
          return;
        case 'ContextMenu':
          if (!row) return;
          event.preventDefault();
          openMenuForRow(row);
          return;
        default:
          break;
      }

      if (event.key === 'F10' && event.shiftKey) {
        if (!row) return;
        event.preventDefault();
        openMenuForRow(row);
        return;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        jumpByPrefix(event.key, index < 0 ? 0 : index);
      }
    },
    [activate, jumpByPrefix, move, removeRow, rows, selected, setExpanded],
  );

  // Keeping the active row on screen is the other half of `aria-activedescendant`:
  // the container has the focus, so the browser will not scroll for us.
  useEffect(() => {
    if (!selected) return;
    const element = container.current?.querySelector(`#${CSS.escape(rowId(selected))}`);
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' });
  }, [selected, rows]);

  const menuItems = useMemo((): ContextMenuItem[] => {
    if (!menu) return [];
    const row = menu.row;
    return [
      { id: 'newFile', label: t('Neue Datei'), run: () => startDraft('file') },
      { id: 'newFolder', label: t('Neuer Ordner'), run: () => startDraft('dir') },
      {
        id: 'rename',
        label: t('Umbenennen'),
        run: () => setRenaming(pathKey(row.entry.path)),
      },
      {
        id: 'trash',
        label: t('In den Papierkorb legen'),
        danger: true,
        run: () => void removeRow(row),
      },
      { id: 'copyPath', label: t('Pfad kopieren'), run: () => void copyPath(row.entry.path) },
      {
        id: 'reveal',
        label: t('Im Dateimanager anzeigen'),
        run: () => {
          void revealInFileManager(row.entry.path).catch((error: unknown) => {
            toast('error', describeApiError(asApiError(error), row.entry.path));
          });
        },
      },
    ];
  }, [copyPath, menu, removeRow, startDraft]);

  const empty = tree.current.listings.get(root)?.length === 0;

  return (
    <div className="filetree">
      <div
        className="filetree-rows"
        role="tree"
        aria-label={t('Dateibaum')}
        aria-activedescendant={selected ? rowId(selected) : undefined}
        tabIndex={0}
        ref={container}
        onKeyDown={onKeyDown}
      >
        {rows.map((row) => (
          <TreeRow
            key={pathKey(row.entry.path)}
            row={row}
            selected={selected === pathKey(row.entry.path)}
            renaming={renaming === pathKey(row.entry.path)}
            loading={tree.current.loading.has(row.entry.path)}
            draft={draft && samePath(draft.parent, row.entry.path) ? draft.kind : null}
            onActivate={() => {
              container.current?.focus();
              activate(row);
            }}
            onMenu={(event) => {
              event.preventDefault();
              setSelected(pathKey(row.entry.path));
              setMenu({ x: event.clientX, y: event.clientY, row });
            }}
            onRename={(name) => void commitRename(row, name)}
            onCancelRename={() => {
              setRenaming(null);
              container.current?.focus();
            }}
            onDraft={(name) => void commitDraft(name)}
            onCancelDraft={() => {
              setDraft(null);
              container.current?.focus();
            }}
          />
        ))}

        {draft && samePath(draft.parent, root) && (
          <NameField
            depth={0}
            kind={draft.kind}
            initial=""
            onCommit={(name) => void commitDraft(name)}
            onCancel={() => {
              setDraft(null);
              container.current?.focus();
            }}
          />
        )}

        {empty && !draft && <p className="filetree-empty">{t('Dieser Ordner ist leer.')}</p>}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.row.entry.name}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
});

/* ── One row ───────────────────────────────────────────── */

type TreeRowProps = {
  row: Row;
  selected: boolean;
  renaming: boolean;
  loading: boolean;
  /** This row is the folder a new name is being typed into. */
  draft: 'file' | 'dir' | null;
  onActivate: () => void;
  onMenu: (event: ReactMouseEvent) => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onDraft: (name: string) => void;
  onCancelDraft: () => void;
};

function TreeRow({
  row,
  selected,
  renaming,
  loading,
  draft,
  onActivate,
  onMenu,
  onRename,
  onCancelRename,
  onDraft,
  onCancelDraft,
}: TreeRowProps) {
  // Always asked, never conditional: the store answers "nothing" when git
  // indicators are off, so there is no hook to skip.
  const status = useGitStatus(row.entry.path);
  const folder = row.entry.kind === 'dir';

  const classes = ['filetree-row'];
  classes.push(folder ? 'filetree-row-dir' : 'filetree-row-file');
  if (selected) classes.push('filetree-row-active');
  if (loading) classes.push('filetree-row-loading');
  if (row.entry.hidden) classes.push('filetree-row-hidden');
  if (status) classes.push(`filetree-row-git-${status}`);

  return (
    <>
      {renaming ? (
        <NameField
          depth={row.depth}
          kind={folder ? 'dir' : 'file'}
          initial={row.entry.name}
          onCommit={onRename}
          onCancel={onCancelRename}
        />
      ) : (
        <div
          id={rowId(row.entry.path)}
          role="treeitem"
          aria-level={row.depth + 1}
          aria-expanded={folder ? row.expanded : undefined}
          aria-selected={selected}
          aria-label={status ? `${row.entry.name}, ${gitLabel(status)}` : undefined}
          className={classes.join(' ')}
          title={row.entry.path}
          // The only dynamic value in the row: how deep it sits.
          style={{ paddingInlineStart: `${row.depth * 14 + 8}px` }}
          onClick={onActivate}
          onContextMenu={onMenu}
        >
          <span className="filetree-twisty" aria-hidden="true">
            {folder ? (
              <Icon name={row.expanded ? 'chevronDown' : 'chevronRight'} size={13} />
            ) : null}
          </span>
          <span className="filetree-icon" aria-hidden="true">
            <Icon name={folder ? (row.expanded ? 'folderOpen' : 'folder') : 'file'} size={14} />
          </span>
          <span className="filetree-name">{row.entry.name}</span>
        </div>
      )}

      {draft && (
        <NameField
          depth={row.depth + 1}
          kind={draft}
          initial=""
          onCommit={onDraft}
          onCancel={onCancelDraft}
        />
      )}
    </>
  );
}

/* ── The inline name field ─────────────────────────────── */

type NameFieldProps = {
  depth: number;
  kind: 'file' | 'dir';
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
};

/**
 * Renaming and creating are the same field with a different starting value.
 *
 * Blur commits rather than cancels: a name typed and then clicked away from is
 * far more often finished than abandoned, and an accidentally created file is
 * a cheaper mistake than a name typed twice.
 */
function NameField({ depth, kind, initial, onCommit, onCancel }: NameFieldProps) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  return (
    <div
      className={`filetree-row filetree-row-editing filetree-row-${kind}`}
      style={{ paddingInlineStart: `${depth * 14 + 8}px` }}
    >
      <span className="filetree-twisty" aria-hidden="true" />
      <span className="filetree-icon" aria-hidden="true">
        <Icon name={kind === 'dir' ? 'folder' : 'file'} size={14} />
      </span>
      <input
        className="filetree-name-input"
        aria-label={kind === 'dir' ? t('Ordnername') : t('Dateiname')}
        value={value}
        autoFocus
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        }}
      />
    </div>
  );
}
