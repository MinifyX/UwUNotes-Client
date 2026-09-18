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

## Plugins

`editor/extensions/registry.ts` is a small registry of `UwuPlugin`s — an id, a
name, a description, whether it is on by default, and a `build()` that returns a
CodeMirror `Extension`. The bundled features that are not core (trailing
whitespace, the colour swatch, the rainbow brackets, and friends) are registered
through it, and `pluginExtensions(enabled)` turns the enabled set into
extensions for a document.

It is deliberately internal for now. The interface is a CodeMirror extension,
which is a large surface to promise to third parties before the app itself has
shipped once. Opening it up — a plugin folder, a manifest, a permission story —
is on the roadmap, and doing it after the shape has settled is the whole reason
it is not done now.

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
