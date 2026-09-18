# Roadmap

My wish list, without dates. The order is roughly by risk rather than by
niceness: the things that would change the architecture come before the things
that sit on top of it.

Nothing here is a promise. See [vision.md](vision.md) for the things that are
deliberately absent, which is a different list and a firmer one.

## Phase 1 · The editor

Where the work is now. Tabs, splits as a tree, the file tree, the status bar
that actually lets you change the encoding, find and replace in the document and
across a folder, the command palette, session restore with drafts, settings, the
bundled languages and themes. This is the point at which I can stop using
anything else, and it is the only phase with a stopping condition.

## Phase 2 · The parts I keep reaching for

**The plugin API, opened up.** The registry in
`editor/extensions/registry.ts` already exists and already carries the bundled
non-core features. Opening it means the part that is actually hard: a folder
plugins live in, a manifest, a version the app can refuse, and an honest answer
to what a plugin is allowed to touch. A CodeMirror `Extension` is an enormous
surface to hand a stranger, so this gets done properly or not at all.

**Macro record and replay.** The Notepad++ feature I miss most and the one
nobody else bothers with: record a sequence of edits, play it back, play it back
to the end of the file. CodeMirror transactions are the right unit to record, so
the design work is deciding which ones are worth keeping and how a saved macro
survives a document it was not recorded against.

**Git diff in the gutter.** `git_statuses` already tells the app which files git
has something to say about, and the tab and tree indicators use it. The gutter
needs more: the blob as git has it, diffed against the buffer, as added,
modified and deleted marks you can click. Green and amber, never pink — the
[design](design.md) rule.

**Clone to other view.** Two panes showing the same document, each with its own
selection and scroll, sharing one `EditorState`. Today a document lives in
exactly one pane on purpose, because two editors on one buffer is a feature
rather than a default — the reasoning is in
[architecture.md](architecture.md#panes-tabs-and-one-document-in-one-place).
This is where that decision gets revisited.

**Large-file mode.** A 400 MB log should open. Not with syntax highlighting, not
with a minimap, not with find-across-the-whole-thing in one go — but it should
open, scroll, and let you jump to a line. That means reading in chunks on the
Rust side and a document the editor knows is partial, which is enough of a
change to deserve its own phase rather than being bolted onto the loader.

**More suite themes.** The editor themes today are the UwU one and the classics
shipped unaltered. I want the rest of the suite's moods as proper themes —
and, more usefully, a theme format that is data rather than code, so making one
does not mean writing TypeScript.

## Phase 3 · Elsewhere

**macOS and Linux builds.** Tauri makes this sound like a checkbox. It is not:
the custom title bar, the file dialogs, the recycle bin, the config directory
and the keyboard shortcuts all have platform edges, and I only have Windows in
front of me. It happens when somebody with a Mac cares, or when I do.

**An Android build.** Tauri 2 can. Whether a text editor with splits and a
status bar full of controls makes any sense on a phone is a real question, and
the answer is probably "a different, smaller app that shares the Rust crates".
On the list because the suite's other apps want the same thing.

**A UwU Suite launcher.** Three apps that share a palette, a cat, a token
package and an installer story. One small thing that knows about all of them,
installs and updates them, and puts them behind one icon. This is the least
urgent item here and the one I will probably build first anyway, because it is
fun.

## Things that are not on this list

They live in [vision.md](vision.md), but the short version: no language servers,
no debugger, no integrated terminal, no telemetry, no account, no subscription,
no cloud sync of your files. Those are not "later". They are the shape.
