# Plugins

How to write one, what it can reach, and — the longer half of this document —
what it cannot. Read [architecture.md](architecture.md) first if you have not;
this is one corner of the picture it draws.

## What a plugin is

A plugin is an entry in
[`editor/extensions/registry.ts`](../apps/desktop/src/editor/extensions/registry.ts)
that the user can switch off in **Einstellungen → Erweiterungen**. It brings a
CodeMirror `Extension`, a handful of commands for the palette, or both.

That is the whole idea. A plugin is not a program that the app runs; it is a few
functions compiled into the same bundle as everything else, called by the same
event loop, holding the same objects. The registry exists so that optional
behaviour has one list, one switch, and one place where a mistake is caught.

## What a plugin is deliberately not

- **Not a separate process.** Nothing is spawned, nothing is sandboxed, and
  there is no message passing. A plugin runs on the UI thread and a plugin that
  blocks it blocks the editor.
- **Not loaded at runtime.** There is no plugin folder to drop a file into. A
  plugin is a module in the repository, imported at start-up. Third-party
  plugins are a real feature and this is not it.
- **No network, no filesystem.** Not because they are blocked — nothing here is
  sandboxed — but because a plugin that reaches for either is doing something
  the app should be doing on purpose, in `lib/api.ts`, with an error path and a
  user-visible failure. If your plugin needs a file, it is a feature, not a
  plugin.
- **No UI of its own.** No panel, no menu, no status bar item, no settings
  field. Everything a plugin contributes shows up in exactly two places: the
  editor surface and the command palette. A user who has never read this file
  still knows where to look.

## The shape

```ts
type UwuPlugin = {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  build?: () => Extension;
  commands?: PluginCommand[];
};

type PluginCommand = {
  id: string;
  title: () => string;
  run: () => void | Promise<void>;
};
```

| Field            | What it is for                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Stable for the lifetime of the plugin: it is the key the user's on/off choice is written under. Renaming it silently resets everyone who ever touched the switch. |
| `name`           | German, wrapped in `N_()`. Two or three words, as it appears in Settings.                                                                                         |
| `description`    | German, wrapped in `N_()`. One sentence under the switch, in the present tense, saying what the user will see.                                                    |
| `defaultEnabled` | What happens for someone who never opens Settings. Say yes only if the plugin is right for a person who does not know it exists.                                  |
| `build`          | Optional. Returns the CodeMirror extension. Called on every reconfigure, so it must be cheap and must not carry state between calls.                              |
| `commands`       | Optional. Entries for the command palette, listed while the plugin is enabled.                                                                                    |

And on a command:

| Field   | What it is for                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`    | Stable, and by convention prefixed with the plugin's id — `base64.decode`, not `decode`. It lands next to the app's own command ids, where a collision is a silently shadowed entry. |
| `title` | A **function**, not a string. The palette can be open when the language changes, and a string captured at registration time would still be German afterwards.                        |
| `run`   | May return a promise. Anything it throws or rejects with is caught for you; see [the failure contract](#when-a-plugin-breaks).                                                       |

`name` and `description` use `N_()` because they are constants, evaluated before
a language is chosen; the UI puts them through `t()` where it renders them. A
command's `title` calls `t()` itself, because it runs at display time. Getting
this backwards is the one mistake everybody makes once.

## A first plugin: highlighting something

The smallest useful thing — marking `TODO`, `FIXME` and `HACK` wherever they
appear. A complete file, next to
[`builtin.ts`](../apps/desktop/src/editor/extensions/builtin.ts):

```ts
/**
 * Marks TODO, FIXME and HACK in the text.
 *
 * Purely visual: it does not collect them, jump between them or know which
 * ones are yours. A list of every TODO in the project is what the project
 * search is for.
 */

import type { Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { N_ } from '../../lib/i18n';
import { registerPlugin } from './registry';

const todoMark = Decoration.mark({ class: 'cm-uwuTodo' });

const todoMatcher = new MatchDecorator({
  regexp: /\b(TODO|FIXME|HACK)\b:?/g,
  decoration: todoMark,
});

function todoMarkers(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = todoMatcher.createDeco(view);
        }

        update(update: ViewUpdate) {
          this.decorations = todoMatcher.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.baseTheme({
      '.cm-uwuTodo': {
        color: 'var(--uwu-code-modified)',
        fontWeight: '600',
      },
    }),
  ];
}

export function registerTodoMarkers(): void {
  registerPlugin({
    id: 'todo-markers',
    name: N_('TODO-Markierungen'),
    description: N_('Hebt TODO, FIXME und HACK im Text hervor.'),
    defaultEnabled: false,
    build: todoMarkers,
  });
}
```

Two details that are not optional:

- **Colours are tokens.** `var(--uwu-code-modified)`, never `#e0a500`. A
  `baseTheme` is still CSS in the app, and the app has one palette in
  [`packages/uwu-tokens`](../packages/uwu-tokens/src/tokens.css). Pink means
  "this one" and nothing else; see [design.md](design.md).
- **Registration is a call, not a module side effect.** `registerTodoMarkers()`
  is invoked from `registerBuiltinPlugins()` in `builtin.ts`, which
  `editor/setup.ts` calls once before the first editor state exists.
  Registration order is the order Settings lists plugins in, and tying it to the
  order Vite happened to evaluate imports means the list reshuffles itself for
  reasons nobody can see.

## A second plugin: a command

A plugin with no `build()` at all. It adds nothing to any document's
configuration — an enabled command-only plugin is, as far as CodeMirror is
concerned, not there.

```ts
/**
 * Inserts today's date at the caret.
 *
 * In the UI language's format, which is the one the person typing is reading
 * in. It does not offer a choice of formats; a date stamp with a settings
 * dialog has stopped being a date stamp.
 */

import { locale, N_, t } from '../../lib/i18n';
import { activeView } from '../../lib/views';
import { registerPlugin } from './registry';

function insertToday(): void {
  const view = activeView();
  // No editor means no document is open. Not an error, just nothing to do.
  if (!view) return;

  const today = new Date().toLocaleDateString(locale());
  view.dispatch(view.state.replaceSelection(today));
  view.focus();
}

export function registerDateStamp(): void {
  registerPlugin({
    id: 'date-stamp',
    name: N_('Datumsstempel'),
    description: N_('Fügt das heutige Datum an der Cursorposition ein.'),
    defaultEnabled: false,
    commands: [
      {
        id: 'date-stamp.insert',
        title: () => t('Heutiges Datum einfügen'),
        run: insertToday,
      },
    ],
  });
}
```

A command finds its own editor through
[`lib/views.ts`](../apps/desktop/src/lib/views.ts) rather than capturing one.
`run()` is called long after registration, from a palette the user opened in
whichever pane they were last in; a view captured at start-up is the wrong view
by the second tab, and a dead one by the first close.

Edits go in through `view.dispatch`, which means the undo history gets them for
free and Ctrl+Z undoes the command as one step. That is also why commands are
allowed to change the document while `build()` extensions are not: a command is
something the user asked for by name, at a moment they chose.

`view.focus()` at the end, because the palette took the keyboard and nothing
gives it back on its own.

## Enabling, and where the switch lives

Every registered plugin appears in **Einstellungen → Erweiterungen** with its
name, its description and a switch. Nothing else has to be written to put it
there.

What is stored is only the **deviations** from the defaults, in the page's own
storage under `uwunotes.plugins`:

```json
{ "word-under-caret": true, "trailing-whitespace": false }
```

A plugin the user has never touched is simply absent, and follows its
`defaultEnabled` forever — including after we change our minds about that
default in a later version, which is the whole reason it works this way. Storing
the resolved value instead would freeze today's opinion into everybody's profile
and quietly switch off every plugin written after the file was last saved.

Switching a plugin back to its default deletes the entry rather than writing it,
so the file stays a short list of decisions rather than a snapshot.

A toggle takes effect immediately: the registry announces, and `editor/setup.ts`
reconfigures every open document — including the ones in background panes, which
is the part that is easy to forget. Commands appear in and disappear from the
palette on the same signal.

## When a plugin breaks

The registry assumes plugins have bugs, because they do, and because a bug in
something optional must never cost the user their editor.

- **`build()` throws.** That plugin contributes no extension for this
  reconfigure; every other plugin builds normally and the editor opens. The
  console gets `Plugin <id> failed to build` and the original error. The switch
  stays on — the next reconfigure tries again, which is what you want while you
  are fixing it.
- **A command throws, or its promise rejects.** The command does nothing. The
  console gets `Plugin <id>: command <id> failed` and the error. The user sees
  no dialog, because a stack trace is not a sentence; a plugin that wants to
  explain a failure raises its own toast, the way the Base64 decoder explains
  that the selection is not valid Base64.
- **The same id registered twice.** The second one replaces the first in place,
  keeping its position in the list. Useful for hot reload, and not a mechanism
  to build on.
- **Stored state that cannot be read.** A corrupt or unavailable
  `uwunotes.plugins` is treated as "everything at its default", which is a
  working editor rather than a broken one.

What the registry does not do is switch a plugin off after it throws. A
disabled-by-the-app plugin is a state the user did not choose and cannot see the
reason for, and a failure that happens once — a viewport that was empty at the
wrong moment — should not be permanent.

## What is not possible yet

Honestly, most of what the word "plugin" usually promises:

- **Third-party plugins.** There is no way to load code that is not in this
  repository. Doing it properly needs a host API that is not just "here is
  CodeMirror", a manifest, a versioning story for when CodeMirror 7 arrives, and
  an answer to what a downloaded plugin is allowed to read. Each of those is
  larger than everything in this document.
- **Per-plugin settings.** A plugin has exactly one bit of configuration: on or
  off. A plugin that wants a number needs a settings schema, a UI that can
  render it, validation, and migration — and `lib/settings.ts` is a closed
  record on purpose. Today the answer is a constant at the top of your module.
- **Contributing to the chrome.** No status bar field, no sidebar section, no
  context menu entry, no tab decoration. Those are React components owned by
  their own modules, and a registry that let arbitrary code render into them
  would be a second, worse component model.
- **Default keyboard shortcuts.** A plugin cannot bind a key. Its command ids
  are stable so that a binding can point at one, and that is as far as it goes;
  shortcuts belong to the user and to `lib/shortcuts.ts`.
- **Asynchronous or lazy registration.** Every plugin is registered before the
  first editor state is built. There is no `await import()` in the path, and a
  plugin that arrives late will not be in the list.

None of this is hard to add later. It is left out because the interface a plugin
sees today is "a CodeMirror extension and a function", which is an enormous
surface to promise anyone before the app has shipped once — and because a
smaller promise can still be widened, while a published one cannot be taken
back.
