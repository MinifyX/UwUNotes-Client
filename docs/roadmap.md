# Roadmap

My wish list, without dates. The order is roughly by risk rather than by
niceness: the things that would change the architecture come before the things
that sit on top of it.

Nothing here is a promise. See [vision.md](vision.md) for the things that are
deliberately absent, which is a different list and a firmer one.

## Phase 1 · The editor — done

Tabs, splits as a tree, the file tree, the status bar that actually lets you
change the encoding, find and replace in the document and across a folder, the
command palette, session restore with drafts, settings, the bundled languages
and themes. It was the only phase with a stopping condition, and it stopped.

## Phase 2 · The parts I keep reaching for

Macros, the widened plugin registry, themes you can edit and git marks in the
gutter came off this list; they are in the repository, and the
[README](../README.md) says what they do. The theme question answered itself on
the way — a theme was always data rather than code here, so making one no longer
means writing TypeScript. What is left of the phase:

**Macros in a menu.** A macro can carry a `Ctrl` shortcut and it is in the
command palette, which covers the day-to-day. What it does not have is the place
Notepad++ gives it: a menu of its own, with the saved ones listed and a
keyboard-reachable path to each. That is a menu question as much as a macro one,
and it waits until the menu is worth extending.

**Third-party plugin loading.** The registry now takes commands as well as an
extension, which is the part that was in the way. The part that is actually hard
is unchanged: a folder plugins live in, a manifest, a version the app can
refuse, and an honest answer to what a plugin is allowed to touch. A CodeMirror
`Extension` is an enormous surface to hand a stranger, so this gets done
properly or not at all. [plugins.md](plugins.md) is the current answer, and the
current answer is "compiled in".

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
