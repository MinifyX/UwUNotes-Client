/**
 * One box, two jobs: run a command, or jump to a file.
 *
 * A leading `>` means commands, anything else means files in the open folder —
 * the convention everybody already has in their fingers. It opens on `>`
 * because the only thing that opens it is the "Befehlspalette" command;
 * deleting that one character is the whole gesture for switching to files.
 *
 * ## Why the file list is walked here
 *
 * `lib/api.ts` has `searchFiles`, but that searches *inside* files. There is no
 * "list every path under this folder" command, so the palette walks it with
 * `listDir()` the first time it needs one and keeps the result for the rest of
 * the run. The walk is capped ({@link WALK_LIMIT}) and skips the folders that
 * are all bytes and no files — a home directory must not be able to hang the
 * window, and neither must `node_modules`.
 *
 * The list on screen is capped separately ({@link VISIBLE_LIMIT}) and says so in
 * the footer. Ten thousand rows nobody will scroll to are ten thousand rows of
 * layout between a keystroke and a frame.
 *
 * What this module does NOT do: decide what a command is (that is
 * `lib/commands.ts`) or open the file itself (that is `lib/files.ts`).
 */

import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { listDir } from '../lib/api';
import { closeDialog, matchCommands, runCommand, useUiState } from '../lib/commands';
import { openPaths } from '../lib/files';
import { t, useLanguage } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';

/** Entries visited by one walk, files and folders together. */
const WALK_LIMIT = 20_000;

/** Rows handed to the browser at once. */
const VISIBLE_LIMIT = 200;

/** How many new files are collected before the open palette is told about them. */
const WALK_STEP = 500;

/**
 * Folders that are never what "go to file" means.
 *
 * Deliberately short and deliberately not configurable in this release: the
 * cap is the real protection, and this list only stops the budget being spent
 * on a pack directory before it reaches `src`.
 */
const SKIPPED_FOLDERS = new Set(['.git', 'node_modules', 'target', 'dist', '.venv', '__pycache__']);

/** A match on a path-like string is worth much less than one on the file name. */
const PATH_PENALTY = 40;

/* ── The walk, kept for the session ────────────────────── */

type Walk = { files: readonly string[]; truncated: boolean; scanning: boolean };

const EMPTY_WALK: Walk = { files: [], truncated: false, scanning: false };

const walks = new Map<string, Walk>();
const walkListeners = new Map<string, Set<() => void>>();

function subscribeWalk(root: string, listener: () => void): () => void {
  const known = walkListeners.get(root) ?? new Set<() => void>();
  known.add(listener);
  walkListeners.set(root, known);
  return () => known.delete(listener);
}

function publishWalk(root: string, walk: Walk) {
  walks.set(root, walk);
  for (const listener of walkListeners.get(root) ?? []) listener();
}

async function startWalk(root: string): Promise<void> {
  // Present means finished or running; either way there is nothing to start.
  if (walks.has(root)) return;
  publishWalk(root, { files: [], truncated: false, scanning: true });

  const files: string[] = [];
  const queue: string[] = [root];
  let visited = 0;
  let announced = 0;
  let truncated = false;

  while (queue.length > 0 && !truncated) {
    const folder = queue.shift();
    if (folder === undefined) break;
    let entries;
    try {
      entries = await listDir(folder);
    } catch {
      // One unreadable folder is not a reason to abandon the other nine
      // hundred, and the palette is not the place to complain about it.
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > WALK_LIMIT) {
        truncated = true;
        break;
      }
      if (entry.kind === 'dir') {
        if (!SKIPPED_FOLDERS.has(entry.name.toLowerCase())) queue.push(entry.path);
      } else {
        files.push(entry.path);
      }
    }
    if (files.length - announced >= WALK_STEP) {
      announced = files.length;
      publishWalk(root, { files: [...files], truncated, scanning: true });
    }
  }

  publishWalk(root, { files, truncated, scanning: false });
}

function useFolderFiles(root: string | null): Walk {
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!root) return;
    const stop = subscribeWalk(root, redraw);
    void startWalk(root);
    return stop;
  }, [root]);
  return (root ? walks.get(root) : undefined) ?? EMPTY_WALK;
}

/* ── Matching ──────────────────────────────────────────── */

type FuzzyMatch = { score: number; positions: number[] };

const WORD_BREAK = /[\\/._\- ]/;

/**
 * A subsequence match with the positions it landed on, lower score being
 * better.
 *
 * Gaps cost, and a character that does not start a word costs one more — which
 * is what makes `cmp` prefer `CommandPalette.tsx` over `components/…/map.ts`.
 * `lib/commands.ts` has its own scorer for the same reason and without the
 * positions; this one exists because a row has to underline what it matched.
 */
function fuzzy(text: string, needle: string): FuzzyMatch | null {
  const lower = text.toLowerCase();
  // A character that grows when lowercased would shift every position after
  // it. Rare, and the honest response is to match without underlining.
  const aligned = lower.length === text.length;

  let from = 0;
  let previous = -1;
  let score = 0;
  const positions: number[] = [];

  for (const character of needle.toLowerCase()) {
    if (character === ' ') continue;
    const at = lower.indexOf(character, from);
    if (at < 0) return null;
    const here = text[at];
    const before = at > 0 ? text[at - 1] : undefined;
    const startsWord =
      at === 0 ||
      (before !== undefined &&
        (WORD_BREAK.test(before) ||
          (here !== undefined && before === before.toLowerCase() && here !== here.toLowerCase())));

    score += previous < 0 ? at : at - previous - 1;
    if (!startsWord) score += 1;
    positions.push(at);
    previous = at;
    from = at + 1;
  }

  return { score, positions: aligned ? positions : [] };
}

type Result =
  | {
      kind: 'command';
      key: string;
      title: string;
      group: string;
      shortcut: string | undefined;
      positions: number[];
    }
  | { kind: 'file'; key: string; path: string; rel: string; nameAt: number; positions: number[] };

function relativeTo(root: string | null, path: string): string {
  if (!root) return path;
  const inside = path.length > root.length && path.toLowerCase().startsWith(root.toLowerCase());
  return inside ? path.slice(root.length).replace(/^[\\/]+/, '') : path;
}

function nameStart(rel: string): number {
  const cut = Math.max(rel.lastIndexOf('/'), rel.lastIndexOf('\\'));
  return cut + 1;
}

/* ── The component ─────────────────────────────────────── */

export function CommandPalette() {
  const { dialog } = useUiState();
  // Mounted only while it is open, so every opening starts on a fresh query
  // instead of on whatever was typed into it yesterday.
  if (dialog !== 'palette') return null;
  return <Palette />;
}

function Palette() {
  const workspace = useWorkspace();
  const walk = useFolderFiles(workspace.folder);
  const language = useLanguage();
  const [query, setQuery] = useState('>');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement | null>(null);
  const listId = useId();

  const commandMode = query.startsWith('>');

  const matches = useMemo<Result[]>(() => {
    if (commandMode) {
      const needle = query.slice(1).trim();
      return matchCommands(needle).map((command) => {
        const title = command.title();
        // `matchCommands` scores the group and the title together, so a match
        // that lives entirely in the group underlines nothing here. Honest,
        // and better than underlining the wrong letters.
        const hit = needle ? fuzzy(title, needle) : null;
        return {
          kind: 'command',
          key: command.id,
          title,
          group: command.group(),
          shortcut: command.shortcut,
          positions: hit?.positions ?? [],
        };
      });
    }

    const needle = query.trim();
    // Without a folder there is nothing to walk, and the files the user had
    // open are the best guess at what they meant.
    const paths = workspace.folder ? walk.files : workspace.recentFiles;
    const scored: { result: Result; score: number }[] = [];

    for (const path of paths) {
      const rel = relativeTo(workspace.folder, path);
      const nameAt = nameStart(rel);
      if (!needle) {
        scored.push({
          result: { kind: 'file', key: path, path, rel, nameAt, positions: [] },
          score: 0,
        });
        continue;
      }
      const hit = fuzzy(rel, needle);
      if (!hit) continue;
      const first = hit.positions[0];
      const inName = first === undefined || first >= nameAt;
      scored.push({
        result: { kind: 'file', key: path, path, rel, nameAt, positions: hit.positions },
        score: hit.score + (inName ? 0 : PATH_PENALTY),
      });
    }

    // Shorter wins a tie: between `index.ts` and `legacy/index.ts` the one
    // nearer the root is almost always the one meant.
    scored.sort((a, b) => a.score - b.score || a.result.key.length - b.result.key.length);
    return scored.map((entry) => entry.result);
    // `language` is a dependency because command titles are translated at call
    // time and would otherwise stay in the language the palette opened in.
  }, [commandMode, language, query, walk.files, workspace.folder, workspace.recentFiles]);

  const shown = matches.slice(0, VISIBLE_LIMIT);
  const active = Math.min(index, Math.max(0, shown.length - 1));
  const activeRow = shown[active];

  useEffect(() => {
    const element = list.current?.children.item(active);
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' });
  }, [active, shown.length]);

  const run = (result: Result | undefined) => {
    if (!result) return;
    // Closing first, because a command may open a dialog of its own and
    // closing afterwards would shut the thing it just opened.
    closeDialog();
    if (result.kind === 'command') runCommand(result.key);
    else void openPaths([result.path]);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setIndex(shown.length === 0 ? 0 : (active + 1) % shown.length);
        return;
      case 'ArrowUp':
        event.preventDefault();
        setIndex(shown.length === 0 ? 0 : (active - 1 + shown.length) % shown.length);
        return;
      case 'PageDown':
        event.preventDefault();
        setIndex(Math.min(shown.length - 1, active + 10));
        return;
      case 'PageUp':
        event.preventDefault();
        setIndex(Math.max(0, active - 10));
        return;
      case 'Home':
        event.preventDefault();
        setIndex(0);
        return;
      case 'End':
        event.preventDefault();
        setIndex(Math.max(0, shown.length - 1));
        return;
      case 'Enter':
        event.preventDefault();
        run(activeRow);
        return;
      case 'Escape':
        event.preventDefault();
        closeDialog();
        return;
      case 'Tab':
        // One focusable element, so Tab has nowhere to go that is not out.
        event.preventDefault();
        return;
      default:
        return;
    }
  };

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('Befehlspalette')}>
        <input
          className="palette-input"
          value={query}
          autoFocus
          spellCheck={false}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow ? `${listId}-${active}` : undefined}
          aria-label={t('Befehl oder Datei suchen')}
          placeholder={t('> für Befehle, sonst Dateien')}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
        />

        <ul
          className={`palette-list palette-list-${commandMode ? 'commands' : 'files'}`}
          id={listId}
          role="listbox"
          ref={list}
        >
          {shown.map((result, position) => (
            <li
              key={result.key}
              id={`${listId}-${position}`}
              role="option"
              aria-selected={position === active}
              className={`palette-row${position === active ? ' palette-row-active' : ''}`}
              onMouseDown={(event) => {
                // Down rather than click: the input must not lose focus first.
                event.preventDefault();
                run(result);
              }}
              onMouseMove={() => setIndex(position)}
            >
              {result.kind === 'command' ? (
                <>
                  <span className="palette-row-name">
                    <Highlighted text={result.title} positions={result.positions} />
                  </span>
                  <span className="palette-row-group">{result.group}</span>
                  {result.shortcut && <kbd className="palette-row-shortcut">{result.shortcut}</kbd>}
                </>
              ) : (
                <>
                  <span className="palette-row-name">
                    <Highlighted
                      text={result.rel.slice(result.nameAt)}
                      positions={result.positions.map((at) => at - result.nameAt)}
                    />
                  </span>
                  {result.nameAt > 0 && (
                    <span className="palette-row-path">
                      <Highlighted
                        text={result.rel.slice(0, result.nameAt)}
                        positions={result.positions}
                      />
                    </span>
                  )}
                </>
              )}
            </li>
          ))}

          {shown.length === 0 && (
            <li className="palette-nothing" role="presentation">
              {commandMode ? t('Kein Befehl passt dazu.') : t('Keine Datei passt dazu.')}
            </li>
          )}
        </ul>

        <footer className="palette-footer">
          <span className="palette-hint">
            {commandMode
              ? t('Das > löschen, um nach Dateien zu suchen.')
              : t('Ein > voranstellen, um nach Befehlen zu suchen.')}
          </span>
          <span className="palette-count">
            {!commandMode && walk.scanning
              ? t('{count} Dateien gefunden, es wird noch gesucht …', { count: walk.files.length })
              : matches.length > shown.length
                ? t('{shown} von {total} Treffern', { shown: shown.length, total: matches.length })
                : t('{count} Treffer', { count: matches.length })}
            {!commandMode && walk.truncated && ` · ${t('Ordner ist zu groß, nur ein Teil davon')}`}
          </span>
        </footer>
      </div>
    </div>
  );
}

/** The matched characters, marked. Anything not matched comes through as text. */
function Highlighted({ text, positions }: { text: string; positions: readonly number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const marked = new Set(positions);
  const parts: ReactNode[] = [];
  let run = '';
  let running = false;

  const flush = (at: number) => {
    if (!run) return;
    parts.push(
      running ? (
        <mark key={at} className="palette-hit">
          {run}
        </mark>
      ) : (
        run
      ),
    );
    run = '';
  };

  for (let at = 0; at < text.length; at += 1) {
    const hit = marked.has(at);
    if (hit !== running) {
      flush(at);
      running = hit;
    }
    run += text[at] ?? '';
  }
  flush(text.length);
  return <>{parts}</>;
}
