# Design

Goth-clean with pink highlights. Same design system as
[UwUMail](https://github.com/MinifyX/UwUMail-Client) and
[UwUSSH](https://github.com/MinifyX/UwUSSH-Client), same cat, one confident
bubblegum pink — but this app opens dark, and the text you are staring at sits
in the deepest part of the window.

## Colour

Tokens come from the workspace package `@uwu/tokens` and are shared with the
rest of the suite, names included. Components never use raw hex values; if a
colour is missing, the fix is a new token, not an inline one.

```ts
import '@uwu/tokens/tokens.css'; // colour, radius, type
import '@uwu/tokens/code.css'; // syntax colour, editor furniture
```

| Token                    | Light     | Dark      | Use                                          |
| ------------------------ | --------- | --------- | -------------------------------------------- |
| `--uwu-canvas`           | `#f8f4f6` | `#141016` | App background, behind the chrome            |
| `--uwu-surface`          | `#ffffff` | `#1c171f` | Sidebar, panels, dialogs                     |
| `--uwu-elevated`         | `#fcf8fa` | `#241e28` | Hover rows, popovers, menus                  |
| `--uwu-ink`              | `#1c1420` | `#f8f2f6` | Primary text                                 |
| `--uwu-muted`            | `#716672` | `#b3a8b3` | Secondary text, path segments                |
| `--uwu-hairline`         | `#f2e8ee` | `#2c2430` | Dividers                                     |
| `--uwu-border`           | `#e9dde4` | `#3a3040` | Control borders                              |
| `--uwu-pink`             | `#ff4d8d` | `#ff7fac` | **Brand.** Active tab, focus ring, the caret |
| `--uwu-pink-solid`       | `#e11d74` | `#ff7fac` | Filled buttons with text on them             |
| `--uwu-on-pink`          | `#ffffff` | `#1c1420` | Text on a pink fill                          |
| `--uwu-pink-ink`         | `#a3154f` | `#ffa3c4` | Pink text on a normal surface                |
| `--uwu-pink-tint`        | `#ffe4ef` | `#3a1a2a` | Selected row, current search match           |
| `--uwu-pink-tint-strong` | `#ffd0e2` | `#4d2338` | Text selection in the editor                 |
| `--uwu-online`           | `#17796a` | `#5cc7ac` | Saved, added, success                        |
| `--uwu-offline`          | `#b3a8b3` | `#6d6474` | Disabled, ignored, untracked                 |
| `--uwu-alarm`            | `#8e5510` | `#d8a25c` | Modified on disk, mixed line endings         |
| `--uwu-deep`             | `#ffffff` | `#0e0b11` | **The editor ground.** Where the text lives  |
| `--uwu-deep-gutter`      | `#f8f4f6` | `#141016` | Line numbers, fold markers, git bar          |

**Why two pinks?** White text on `#ff4d8d` reaches only 3.1:1. Filled buttons
therefore use `#e11d74` (4.5:1, WCAG AA), and the brighter brand pink stays for
everything that is not small text on a pink fill — a caret, a focus ring, a
1 px edge on the active tab. The dark theme needs only one, because its pink
sits on a dark ground where contrast is not the problem.

**`--uwu-deep` is new here**, and it is where "goth, not pastel" actually comes
from. In dark mode it is _darker_ than `--uwu-canvas`, not lighter: the text
sits at the bottom of the window and the chrome floats above it. The token is
in the shared package rather than this app, because a mail body and a log view
want the same thing.

**State colour is not brand colour.** Pink means "this one" — selected, active,
focused, found. Saved is mint, modified is amber, deleted is red. An editor that
also used pink for "unsaved" would have taught you nothing at a glance.

## Syntax

`code.css` is a separate import because not every app in the suite shows code.
The hues are Nyu's sticker palette pushed to text contrast — lilac, mint, sky,
star gold — so highlighted code reads as the same family as the cat instead of
somebody else's scheme dropped into a pink app.

| Token                  | Light     | Dark      | What it colours                   |
| ---------------------- | --------- | --------- | --------------------------------- |
| `--uwu-code-keyword`   | `#c2185b` | `#ff7fac` | `if`, `return`, `fn`, `const`     |
| `--uwu-code-string`    | `#16795f` | `#9ee6c4` | String and character literals     |
| `--uwu-code-number`    | `#8a5a00` | `#ffd66e` | Numbers, booleans, `null`         |
| `--uwu-code-comment`   | `#8a7f8f` | `#7d7285` | Comments                          |
| `--uwu-code-function`  | `#1d5f9e` | `#bde6ff` | Function and method names         |
| `--uwu-code-type`      | `#6d3fc4` | `#c9b6f0` | Types, classes, interfaces        |
| `--uwu-code-constant`  | `#a3154f` | `#ffa3c4` | Constants, enum members           |
| `--uwu-code-tag`       | `#c2185b` | `#ff7fac` | HTML and JSX tag names            |
| `--uwu-code-invalid`   | `#c62828` | `#ff8080` | What the parser could not swallow |
| `--uwu-code-cursor`    | `#e11d74` | `#ff4d8d` | The caret                         |
| `--uwu-code-selection` | `#ffd0e2` | `#4d2338` | The selection, while focused      |

**Pink is reserved for keywords.** It is the one thing the eye should catch
first when scanning a file, and it is the one place the brand belongs _inside_
the text rather than around it. Tags get it too, because a tag is a keyword
wearing angle brackets. Everything else stays out of the brand hue, which is
what keeps a screenful of code from turning into a gradient.

Every value is checked against its own ground (`--uwu-deep`), not against white.
Comments sit at 4.5:1 and everything else above it — a comment you cannot read
is a comment you will not write.

The editor furniture is the other half of the file: the active line, the
indent guides, the matching bracket, the line numbers, the search match and the
active search match, and the git bar in the gutter (`--uwu-code-added`,
`-modified`, `-deleted` — green and amber, never pink). Themes from
`editor/themes.ts` map onto these names; the default one, `uwu`, is these values
exactly.

## Type

- **Manrope** (variable, bundled, no network calls) for the interface.
  Sizes: 12 caption · 13 meta · 14 body/list · 16 panel body · 18 section ·
  22 title. Weights 400, 500, 600 for titles and file names, 700 only for the
  wordmark.
- **JetBrains Mono** (default) and **Fira Code** for the editor, both variable,
  both bundled. Ligatures are **off** by default: Fira Code's arrows are lovely
  and not everyone agrees, and an editor should not surprise you with them.
- Font size 8–36, line height 1.55 by default. Both are per-app, not per-file;
  Ctrl+scroll changes the size and it stays changed.

## Shape and space

- Radius: 10 px controls, 16 px cards and dialogs, 999 px pills and badges.
- Spacing on a 4 px grid.
- Shadows only for floating layers: menus, the command palette, toasts.
- The editor itself has **no** radius and no shadow. Rounded corners on a text
  surface eat the first character of line one.

## Layout

```
┌──────────────┬────────────────────────┬────────────────────────┐
│ Sidebar      │ api.ts ×   notes.md ●  │ documents.ts ×         │
│              ├────────────────────────┼────────────────────────┤
│ ▾ src        │  1  import { … }       │  1  export type Eol =  │
│   ▾ lib      │  2                     │  2                     │
│     api.ts   │  3  export function …  │  3  export type Doc =  │
│     layout…  │  4                     │  4                     │
│ ▾ docs       │                        │                        │
│   design.md  │                        │                        │
├──────────────┴────────────────────────┴────────────────────────┤
│ UTF-8 · CRLF · TypeScript · Z. 12, Sp. 4 · 3,1 kB              │
└────────────────────────────────────────────────────────────────┘
```

- **Custom title bar**, no OS chrome edge. It carries its own minimize,
  maximize/restore and close buttons at Windows' own size (46 px wide, the full
  bar high); close turns brand pink on hover, as in the siblings.
- **Tabs** sit above each pane, one per document. The active tab gets a 1 px
  pink top edge and the editor's own background, so it reads as continuous with
  the text under it. A modified document shows a dot where its close button is,
  and the button comes back on hover — closing an unsaved file should take a
  deliberate move, not a stray click.
- **Splits** are a tree: split right, split down, split a half again. Dragging a
  tab into another pane moves it. The divider is a hairline until you touch it,
  then it is pink.
- **The sidebar** is optional. A folder is a convenience, not a project: the app
  is perfectly happy with four loose files and nothing else. It folds away with
  one keystroke, because full-window text has to be that close.
- **The status bar** is where encoding lives, and it is a control, not a label.
  Encoding, line ending, language and the caret position are each one click from
  being changed. This is the thing most editors hide in a submenu and it is half
  the reason this one exists.
- **Find is a bar, never a modal.** A modal over the text you are searching is a
  UX bug wearing a hat. Find in files is a panel at the bottom with the results
  streaming in.
- Keyboard-first: everything reachable without the mouse, visible focus rings,
  command palette on `Ctrl+Shift+P`, go-to-file on `Ctrl+P`.

## Nyu, the mascot

Nyu is the same cat as in UwUMail and UwUSSH — the envelope became a terminal in
UwUSSH, and here it is a **notepad**. A spiral-bound pad seen head-on, ears
poking up over the top edge, and the page is the face: UwU eyes, `w` mouth,
blush. A pink caret blinks next to her mouth like she is about to write
something.

- **Sticker style**, unchanged across the suite. Plum outlines `#4B1D3F`, pink
  body `#FF6FA6`, light page `#FFB8D3`, pastel props, a white die-cut edge.
  These are fixed artwork and stay the same in dark mode; the white edge is what
  keeps the outlines readable on a `#0e0b11` ground.
- **App icon.** Made to be told apart in a taskbar at 16–24 px, where a pale
  tile would read as UwUMail: a **dark plum tile**, and on it a pink notepad
  with cat ears, as large as the tile allows, one ruled line, a yellow pencil
  and a single sparkle. Regenerate the platform icons with
  `pnpm tauri icon ../../brand/uwunotes-app-icon.svg` in `apps/desktop`.
- **Sources** in `brand/` (icon, symbol, mono symbol) and
  `apps/desktop/src/components/nyu/` (React).

**Scenes** (`NyuScene`, 320 × 220), for the empty states a text editor actually
has:

| Scene         | When                                                 |
| ------------- | ---------------------------------------------------- |
| Welcome       | First start, nothing open yet                        |
| Empty pane    | A pane with no tab in it, after closing the last one |
| Nothing found | Find in files with no match                          |
| Empty folder  | A folder in the sidebar with nothing in it           |
| Saved         | Save-all finished, briefly, in the corner            |
| Binary        | A file with NUL bytes was opened anyway              |
| Too big       | A file past the large-file threshold                 |
| Gone          | The file was deleted or renamed underneath us        |
| Goodbye       | Closing with unsaved changes                         |

**Greetings.** `components/nyu/greetings.ts` picks a German line for three
moments — `startup`, `empty`, `saved` — from a small set, so the same sentence
does not greet you every morning. They are `N_()` constants translated where
they are shown.

**Motion.** Nyu blinks in scenes, twitches her ears on hover, and the caret on
her page blinks at the editor's own rhythm. Settings → Appearance → Animations
(System / On / Off) resolves to `<html data-motion="reduced">`, and with
`reduced` every transition in the app collapses to 1 ms and Nyu holds still.

**Sounds** are off by default and stay that way. A little chime on save is
charming in a demo and unbearable in hour three of a file you keep saving every
twelve seconds. Turning them on is one switch; making them the default would
have been an apology I did not want to write. The setup is the exception, and
the only one — see below.

**Name.** Nyu only appears by name in the playful tone. The neutral tone keeps
the pictures and says "UwUNotes".

## Tone of voice

Playful by default: kaomoji, warm little jokes, soft animation. Settings → Tone
→ **Neutral** replaces the words, never the layout or the colours.

| Situation       | Neutral                             | Playful                                 |
| --------------- | ----------------------------------- | --------------------------------------- |
| Nothing open    | Keine Datei geöffnet                | Ganz schön leer hier (・_・;)           |
| Saved           | Gespeichert                         | Gespeichert ✨                          |
| Search empty    | Keine Treffer                       | Nichts gefunden (・_・;)                |
| Session back    | Sitzung wiederhergestellt           | Alles wieder da (๑˃ᴗ˂)ﻭ                 |
| Draft recovered | 3 nicht gespeicherte Dateien zurück | Hab deine 3 Entwürfe aufgehoben (๑˃ᴗ˂)ﻭ |

Rules for playful copy:

1. **Information first.** The joke never replaces what happened or what to do.
2. **Short.** One kaomoji at most, never in a button that acts on data.
3. **Kind.** Never mock the user; the app laughs at itself.
4. **Warnings and errors are never playful.** In _both_ tones.

Rule 4 is not negotiable, and in an editor it has a precise meaning: anything
that could cost text is plain. Overwriting a file that changed on disk, closing
an unsaved buffer, replacing across a folder, saving a file that decoded lossily
— no kaomoji, no Nyu, no exclamation marks. A sad cat next to "this will
overwrite changes somebody else made" destroys exactly what the warning is for.

```
⚠  notes.md wurde auf der Festplatte geändert.

  geöffnet    12:04    3,1 kB
  auf Platte  12:19    3,4 kB

Speichern überschreibt die Änderung auf der Festplatte.

     [ Neu laden ]  [ Trotzdem speichern ]  [ Abbrechen ]   ← focus
```

Focus sits on the safe choice. Buttons that act on data say what they do —
`Löschen` stays `Löschen`, never `Weg damit`.

German is the source language for every string, and it uses "du".

## The setup

The installer is the first thing anybody sees of UwUNotes, so it is UwUNotes and
not a grey box with a progress bar in it. `apps/setup` is the same Tauri and the
same React as the editor: one window, 460 × 640, not resizable, its own title
bar, `--uwu-canvas` behind everything and the same type scale. It imports
`@uwu/tokens` rather than copying values out of it, and it imports Nyu herself
out of `apps/desktop/src/components/nyu` rather than redrawing her — a second
copy of the cat is a cat that slowly stops looking like the app's.

- **Same scenes, same size.** The 320 × 220 canvas the editor uses, so she
  stands at the same height here, in the editor and in UwUSSH. The waiting
  screen is the editor's own `startup` scene, unchanged. Working, done,
  uninstall and goodbye are composed here out of her primitives: pages flying
  into a carton, a spiral pad, a star or two.
- **Dark, always.** `data-theme="dark"` is in the HTML, so the first paint is
  already dark and no script decides it. There is no light setting: the setup
  runs once, and a colour scheme to choose is a question nobody came here to
  answer.
- **Animations follow the system.** The same `prefers-reduced-motion` rule as
  the app, through the same `data-motion` attribute in `tokens.css`. Nyu holds
  still when the machine asks for that.
- **Failure is plain.** Rule 4 above, applied to the one window where it is
  easiest to get wrong: the failure scene is Nyu looking sorry, her shadow and
  one dropped page — no stars, no hearts, no hopping. The heading says what
  went wrong, the line under
  it says what to do, and Windows' own message sits below that in the muted
  colour. Nothing playful appears anywhere near a disk that is full.
- **Sound is on, with a switch in the title bar.** The editor's rule reversed,
  deliberately: this window plays exactly one thing, the A5 → E6 chirp the
  editor uses for a save, once, when an install finishes. It is the first thing
  UwUNotes ever says and it sounds like what it will keep saying. A failure
  makes no sound at all. The siblings' installers do it this way, and mine
  should sound like theirs.
- **Its own texts.** No `t()` and no catalogue: both languages live in
  `apps/setup/src/texts.ts` and the system language picks one. The setup runs
  before UwUNotes exists on the machine, so there is nothing to read a language
  preference out of. Tone follows the app — playful where it may be, "Nyu
  richtet ein …" while it works, and plain everywhere a warning lives.
