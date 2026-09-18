# Architecture

How the pieces fit together, and why they are cut where they are. This is the
document I would want to read before changing anything here.

## The shape

Three layers, one rule each.

```
┌───────────────────────────────────────────────────────────┐
│  React 18 + TypeScript        chrome: tabs, sidebar,      │
│                               status bar, dialogs         │
├───────────────────────────────────────────────────────────┤
│  CodeMirror 6                 the text itself: state,     │
│                               selection, undo, syntax     │
├───────────────────────────────────────────────────────────┤
│  Rust (Tauri 2)               bytes: decode, encode,      │
│                               write, walk, search         │
└───────────────────────────────────────────────────────────┘
```

**Rust owns bytes. The page owns text.** By the time a file reaches React it is
a JavaScript string with `\n` line endings, and everything about how it got that
way — which code page, which BOM, which line endings, what the file looked like
on disk — travels alongside it so saving can put it all back exactly as it was.
Nothing in the frontend ever sees a byte.

**React owns chrome, CodeMirror owns text.** A keystroke must not re-render the
window. React draws the furniture and steps out of the way.

Tauri 2 rather than Electron for the usual boring reasons: a binary around a
tenth the size, the system WebView instead of a bundled Chromium, and a real
language on the other side of the boundary for the parts that are actually hard
here — character encodings and walking a large tree without stalling.

The Rust side is three crates:

| Crate                     | What it is responsible for                                     |
| ------------------------- | -------------------------------------------------------------- |
| `crates/uwunotes-fs`      | Decode, encode, atomic write, directory listing, find in files |
| `crates/uwunotes-session` | The session file and the drafts parked next to it              |
| `apps/desktop/src-tauri`  | The Tauri shell: commands, window, dialogs, the recycle bin    |

## `lib/api.ts` is the only door

Every `invoke` in the app goes through
[`apps/desktop/src/lib/api.ts`](../apps/desktop/src/lib/api.ts). Nothing else in
`src/` imports from `@tauri-apps/api`. That has two payoffs worth the small
discipline:

- The entire IPC surface is one file you can read top to bottom. Adding a
  command means adding it here, so the types on this side and the
  `#[tauri::command]`s on the other are edited together or not at all.
- The frontend can be reasoned about — and, when it comes to that, tested —
  against one module rather than against Tauri.

Errors come back typed. Rust sends `{ kind, message, path }` for everything a
user could plausibly hit, and `ApiErrorKind` is a small closed set:
`notFound`, `permission`, `changed`, `tooLarge`, `isDirectory`, `encoding`,
`invalidRegex`, `other`. The UI reacts to the kind — a `changed` from a save is
what turns into "the file changed on disk, overwrite?" — instead of matching on
prose, which breaks the moment a message is translated.

## Why the text is not in React state

A document is its metadata plus a CodeMirror `EditorState`, and the state lives
in [`lib/documents.ts`](../apps/desktop/src/lib/documents.ts), outside React.

1. **Typing must not re-render the app.** CodeMirror updates its own DOM from
   its own transactions. Routing every keystroke through `useState` would redraw
   the whole window to show a character that is already on screen.
2. **A tab keeps its undo history.** Switching away and back hands the same
   `EditorState` to the pane's editor, so Ctrl+Z still reaches yesterday. If the
   state were rebuilt on mount, every tab switch would quietly throw the history
   away.

React subscribes with `useSyncExternalStore` to a store that announces
_metadata_ changes — a name, an encoding, the dirty flag — and stays silent
while text changes. The dirty flag is the one thing recomputed on every edit,
and even that only announces when it actually flips:

```ts
const dirty = !state.doc.eq(doc.savedDoc);
if (dirty !== doc.meta.dirty) { … }
```

`savedDoc` is the text as it is on disk, kept as a CodeMirror `Text`. Comparing
against it rather than tracking a boolean means undoing back to the saved text
clears the dot on the tab, which is the behaviour everyone expects and almost no
editor gets right. `Text.eq` compares lengths first, so the common case while
typing is free; only an edit that keeps the length exactly the same pays for a
walk of the tree.

## Settings, and the compartment trick

CodeMirror extensions are fixed at state creation. Changing the tab size, the
line numbers or the theme would mean rebuilding every `EditorState` — and
rebuilding a state throws away its undo history, which is precisely what we just
went to some trouble to keep.

The way out is `Compartment`. `editor/setup.ts` keeps two:

- `settingsCompartment` — everything that comes from
  [`lib/settings.ts`](../apps/desktop/src/lib/settings.ts): tab size, wrapping,
  line numbers, indent guides, the caret, bracket matching, the theme.
- `languageCompartment` — the language mode, which arrives later than the
  document does, because language packages are loaded on demand.

Changing a setting dispatches a reconfigure into every open document
(`reconfigureAllDocs()`), and the states — and their histories — survive it.
`applyDocLanguage()` does the same for one document once its language package
has finished loading.

Settings themselves are plain preferences in the page's own storage, and
everything read back goes through `sanitize()` first. The store is JSON on a
user's disk; a hand-edit that turned `fontSize` into `"big"` must not brick the
editor, so every field is checked and anything unexpected falls back to its
default.

Appearance is applied to `<html>` before React mounts — `data-theme`,
`data-motion`, `lang` — so the first paint is already the right colour and
nothing flashes white on the way to a dark editor.

## Encoding, and why stamps matter

This is the part that justifies having a Rust side at all.

```
read  ─▶ detect ─▶ decode ─▶ normalise line endings ─▶ text with \n
                                                          │
                                                        edit
                                                          ▼
write ◀─ encode ◀─ re-apply eol ◀─ re-apply BOM ◀─────────┘
```

**Detect.** A BOM is authoritative and reported as `encodingSource: 'bom'`.
Without one, `chardetng` guesses, and the guess is reported as `'guessed'` —
the status bar says so, because a guess the user cannot see is a guess the user
cannot correct. Reopening the file with a chosen encoding gives `'forced'`.

**Decode.** `encoding_rs` does the actual work for every legacy code page.
Two flags come back with the text and are worth more than they look: `lossy`
means decoding produced replacement characters, so the guess was wrong or the
file is not text; `binary` means NUL bytes in the first block. Neither one
refuses to open the file. Both warn, because silently mangling a file the user
then saves is the single worst thing an editor can do.

**Normalise.** Line endings are turned into `\n` for the editor, and the
original is remembered as `eol: 'lf' | 'crlf' | 'cr'`. A file that mixed them
gets `mixedEol: true`; the majority wins and the user is told once, in the
status bar. The alternative — carrying CRLF through CodeMirror — makes every
offset, every regex and every column number subtly wrong.

**Write.** The text is encoded back, the `eol` is re-applied and the BOM goes
back if it was there. "UTF-8 with BOM" is a checkbox next to the encoding, not a
separate code page, which is why `bom` is its own flag.

**Stamps.** `FileStamp` is `{ mtimeMs, size, readOnly }`: what the file looked
like when we last read or wrote it. Every save sends the stamp the editor
believes is on disk, and Rust compares before it writes. If it does not match,
the write is refused with `kind: 'changed'` and the UI can offer a real choice —
reload, overwrite, or compare — instead of destroying whatever the compiler,
the formatter or the other window just wrote. Passing `null` writes regardless,
which is what "overwrite anyway" does after the user has said so.

The same stamps drive `checkDiskChanges()` on window focus: a document whose
stamp has moved gets `staleOnDisk`, and a clean one can simply reload while a
dirty one asks.

**Atomic writes.** `uwunotes-fs` writes to a temporary file in the same
directory, flushes it, and renames it over the target. Same directory because a
rename across volumes is a copy and is not atomic. The failure mode this rules
out is the one that matters: a crash halfway through writing leaves the old file
intact rather than a half-written one. Permissions and the read-only flag are
carried over; a read-only file is not silently made writable, it asks.

## Panes, tabs, and one document in one place

[`lib/layout.ts`](../apps/desktop/src/lib/layout.ts) is a binary tree. A leaf is
a pane — a tab bar with an editor under it. A branch splits its space between
two children, horizontally or vertically, at a ratio the user drags. Nesting is
what makes "split the right half again" work without inventing a second concept,
and Notepad++'s two views are simply this tree one level deep.

It is plain data and pure functions: `splitPane`, `removePane`, `setRatio`,
`nextPane`. The whole layout serialises into the session file and comes back
unchanged — and `sanitizeLayout()` walks it on the way back in, because the
session is JSON a user could have edited. Ratios are clamped, unknown panes are
dropped, and a tree that ends up empty gives `null` so the caller can start
fresh.

[`lib/workspace.ts`](../apps/desktop/src/lib/workspace.ts) ties the tree to the
documents: which tabs are in which pane, which pane is active, which folder is
open, what was recently opened. One store, replaced immutably, one
`useSyncExternalStore` for the whole UI, one `JSON.stringify` for the session.

**A document lives in exactly one pane.** Opening a file that is already open
reveals it where it is rather than opening it twice. This is a real constraint
and worth being honest about: two editors on one document would need to share
one `EditorState`, and CodeMirror does not give that away for free. Two views
of one buffer means both views dispatching into the same state and each keeping
its own selection and scroll position — doable, but it is a feature, not a
default, and it has to be built deliberately. So "clone to other view", which
Notepad++ has, is a [roadmap](roadmap.md) item and not a missing piece of this
design. Moving a tab across (`moveTabToPane`) is what exists today, and it is
what people actually want nine times out of ten.

## Session and drafts

Two files, both on the Rust side, both in the app's config directory.

**The session** is the window: which documents were open, in which panes, in
what order, with which caret and scroll position, plus the folder and the recent
lists. Every document carries enough to be reopened exactly — path, encoding,
BOM, EOL, a hand-picked language, its stamp.

**Drafts** are the unsaved text. One file per document id, parked next to the
session, written by the autosave loop while you type. That is what makes closing
the app cost nothing: an untitled buffer with three lines in it comes back with
those three lines, and a modified file comes back modified, still knowing what
was on disk underneath. A draft is dropped the moment its document is saved or
its tab is closed on purpose.

Restore is deliberately careful. A file that has vanished since the last run is
skipped rather than turned into an error dialog at start-up. A file whose stamp
has moved is opened and marked `staleOnDisk`. A document with a draft comes back
dirty from the first moment, with an empty `savedDoc` standing in, because there
is no disk text to compare it against — anything is different from nothing, and
the dot on the tab is correct.

## Find in files

The walk is Rust's: `ignore` for the tree (so a search never disappears into
`node_modules`), `grep-searcher` for the lines (so a large file is not loaded
into memory to be looked at once).

Results **stream**. `search_files` takes a Tauri `Channel` and emits a `file`
event per file with matches, then one `done` event with the totals, whether it
hit `maxMatches`, and how many files were skipped for being too large or
unreadable. The list fills while the walk is still running, which is the
difference between a search that feels instant and one that feels broken.
Searches are cancellable by id, and starting a second search with the same id
replaces the first.

Match offsets arrive in **UTF-16 code units**, converted on the Rust side from
the byte offsets it works in. Those are the units JavaScript strings and
CodeMirror positions use, and converting once at the boundary is cheaper and far
less error-prone than converting at every call site.

Replace does **not** repeat the walk. `ReplaceRequest` carries the exact list of
files to touch, taken from a search the user has already seen on screen.
Replacing in a file that appeared between the search and the click is exactly
the kind of surprise an editor must never spring.

## Macros record steps, not transactions

A macro in `lib/macros.ts` is a list of semantic steps: characters that were
typed, a named editor command, an app command by id, or a search. It is never a
list of CodeMirror transactions, and that is the single decision the whole
feature hangs on.

Recording transactions is the obvious idea. They are exactly what happened, they
already serialise, and CodeMirror hands them to you for free. They are also the
wrong unit, because a transaction knows _where_ it happened. Replay one and it
edits the position the caret used to be at, not the position the caret is at
now — so a macro recorded on line 4 keeps editing line 4 forever, and "repeat
200 times" performs the same edit in the same place 200 times. The one thing
nobody has ever recorded a macro for.

Steps replay against wherever the caret is. That is what makes "end of line,
type a comma, cursor down" walk down a file, and it is what makes _play to the
end of the file_ a loop that can terminate: each pass has to leave the caret
strictly further forward than the last, or the run stops.

Three promises hold the rest of it together:

- **One undo step per run.** The run's own transactions are kept out of the
  history. At the end the collected changes are reverted invisibly and applied
  again as a single transaction annotated `isolateHistory: 'full'`, so one
  Ctrl+Z puts the document back however long the macro and however many
  repetitions. The revert is destructive if those changes are not exactly what
  happened, so it is skipped unless replaying them on the starting document
  reproduces the current one — which a synchronous run makes certain.
- **It stops at the first step that fails, and says why.** A search with no
  match, a command that declines, a read-only document. A macro that half ran
  and said nothing is worse than one that stopped.
- **It cannot hang the window.** Every loop has a hard ceiling, including the
  one a user can reach by editing `uwunotes.macros` in a text editor.

A run is synchronous from first step to last. Yielding between steps would let a
file watcher reload the document in the middle of a macro, and there is nothing
sensible to do with the second half of a macro that is now aimed at a different
file.

## Plugins

`editor/extensions/registry.ts` is a small registry of `UwuPlugin`s — an id, a
name, a description, whether it is on by default, and then two optional halves:
a `build()` returning a CodeMirror `Extension`, and a list of `commands` for the
palette. Either half may be missing. A plugin that is only a `build()` is what
Phase 1 shipped; a plugin that is only commands (sort lines, change case,
Base64) never appears in the editor's configuration at all and costs an open
document nothing.

How it composes: `pluginExtensions(enabledPluginIds())` is the last thing
appended inside `settingsExtensions()`, which lives in the settings compartment.
So plugins ride the mechanism settings already use — switching one on is one
reconfigure transaction per open document, not a new editor. The price is that
`build()` runs on every reconfigure, so it has to be cheap and must not hold
state between calls; anything a plugin needs to remember belongs in a
`StateField` inside the extension it returns. On the other side,
`pluginCommands()` hands `lib/commands.ts` the enabled plugins' commands, which
is why a command's `title` is a function: the palette can be open while the
language changes.

What a plugin may not do is the longer and more useful list.

- **No UI of its own** — no panel, no menu, no status bar item, no settings
  field. Everything a plugin contributes surfaces in exactly two places, the
  editor and the command palette, so a user who has never read a line of this
  knows where all of them are.
- **No process of its own.** Nothing is spawned and nothing is sandboxed. A
  plugin runs on the UI thread, and a plugin that blocks it blocks the editor.
- **No loading at runtime.** There is no folder to drop a file into; a plugin is
  a module in this repository, imported by `editor/setup.ts` for the side
  effect. Third-party plugins are a real feature and this is not yet it.
- **No network and no filesystem**, by convention rather than by a wall —
  anything that reaches for either is a feature and belongs in `lib/api.ts`,
  with an error path and a visible failure.

Which plugins are enabled is stored by the registry, not by `lib/settings.ts`:
the set of ids is open-ended, and `Settings` is a closed record with a validator
that would have to be edited for every new plugin. [plugins.md](plugins.md) is
the writing guide; this section is only the shape.

## A theme is a block of custom properties

Exactly one theme writes CSS: `uwu`, in `editor/theme.ts`, and even that is
nothing but `var()` lookups, which is why it follows the app's light and dark
without being told. Every other theme is that same theme with a block of custom
properties set on `.cm-editor` — no second `HighlightStyle`, no second set of
selectors, no second place to forget the matching-bracket colour.

That is what makes a user theme possible at all. Because a theme is data, one
the user made is the same shape as one we ship: a name, a `dark` flag, and a map
from token to colour. `lib/user-themes.ts` stores it, `editor/themes.ts` wraps
either kind into the same `Extension`, and the bundled themes carry their values
around with them so that duplicating one hands back a whole theme rather than
the handful of lines it happened to override.

What it buys the suite is that a theme travels. It exports as JSON, it can be
pasted in from a message, and the token names are `@uwu/tokens`' own — so a
theme written here already means something in any sibling app that loads
`code.css`. Nothing else needs to know which theme is active either: the
minimap, the decorations and the gutter all read the tokens off the editor
element and get the right answer for free.

The cost is that this is JSON on a user's disk, which a curious person will
eventually open in the very editor it configures. Everything coming back out of
storage is sanitised: an unknown property name is dropped rather than written
into the page, and a value has to pass `CSS.supports('color', value)` — the only
honest test, because the browser is the thing that has to render it.

## The git gutter has no diff algorithm

The marks between the line numbers and the text come from `git diff --no-color
-U0 -- <file>`, and the Rust side reads the `@@ -a,b +c,d @@` headers and
nothing else. `-U0` means zero lines of context, so each header's ranges _are_
the changed lines: `b == 0` is an addition, `d == 0` is a deletion, anything
else is a modification. We do not diff, and we do not keep a copy of the blob to
diff against. Git already knows, and reimplementing Myers in TypeScript to
disagree with it slightly would be a strange way to spend an evening.

A combined diff — what git prints for a file in a merge conflict — has `@@@`
headers with three ranges. Those fail the prefix check and the file ends up with
no marks at all, which is the right answer for a file whose changed lines are
not a question with one answer yet.

Two smaller decisions follow from what a hunk means. A deleted hunk marks the
line _after_ the deletion and draws a wedge on the boundary rather than a bar,
because nothing on that line was removed — the lines around it were, and a
full-height bar would be pointing at the wrong text. And hunks arrive as a
`StateEffect` into a `StateField`, not through a facet or a compartment:
reconfiguring for them would throw away the measured line heights of every open
document every time somebody saved a file.

One `git diff` per file is not free, which is why `Settings.gitGutter` exists
and why the setting says out loud what it costs.

## German first, English as a lookup

Every user-visible string is written in German where it is used and wrapped in
`t()`. The English catalogue in `src/i18n/en/` maps each German string to its
English one, and a string with no entry simply stays German.

The direction is the unusual part and it is on purpose: keys are the words
themselves, so reading the code shows the actual sentence rather than
`settings.editor.tabSize.label`, and a missing translation degrades to a real
sentence in the wrong language instead of an identifier leaking into the UI.
The cost is that a German string cannot be edited casually — it is the key —
and that cost is paid by `scripts/check-i18n.mjs`, which runs in `pnpm lint`,
finds every `t()` and `N_()` literal, and fails on anything without English. It
also reports the same German string translated two different ways in two files,
and warns about catalogue entries nobody uses any more.

`N_()` exists for strings in module-level constants, which are defined before a
language is chosen. It does nothing at runtime; it marks the string so the
checker finds it, and the actual `t()` happens where the string is shown.

## `@uwu/tokens`, and what it means for the suite

UwUMail wrote the palette, UwUSSH copied the file, and UwUNotes is the first app
to depend on the package instead of keeping its own copy:
`packages/uwu-tokens`, published into the workspace as `@uwu/tokens`.

- `tokens.css` — colour, radius, type. Every app loads it.
- `code.css` — syntax colour and editor furniture, on top of the base. Only
  apps that show code load it, which today is this one and one code block in
  UwUMail.
- `index.ts` — the token names as a union type, `token()` for a `var()` a
  compiler can check, and `readToken()` for the rare place that needs a resolved
  colour string, such as a `<canvas>`.

The names did not change in the move, so the other two apps can switch to the
package whenever they are next touched. That is the point of the split: a
component moved between UwUMail, UwUSSH and UwUNotes keeps looking like itself,
and a new token is a suite-wide decision rather than a local one. The details of
what the values are and why live in [design.md](design.md).
