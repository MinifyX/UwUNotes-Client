# Design

Goth-clean with pink highlights. The suite's design system lives in
[@uwusuite/design](https://github.com/MinifyX/UwUSuite-Design): colour
tokens, UwU Sans and the interface font picker, Lucide and suite icons, pill
buttons, switches, dialogs, the title bar, Nyu's face and motion, and the tone
rules. Read its docs for all of that — [colour](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/color.md),
[typography](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/typography.md), [icons](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/icons.md),
[components](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/components.md), [window](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/window.md),
[Nyu](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/nyu.md), [motion](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/motion.md), [tone](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/tone.md),
[app icons](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/app-icons.md).

This file is only what is special about UwUNotes: an editor that opens dark,
with the text you are staring at in the deepest part of the window.

## What stays in the app

| Where                                      | What                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `apps/desktop/src/styles/tokens.css`       | `--uwu-deep`, `--uwu-deep-gutter`, the app's shade and scrim          |
| `apps/desktop/src/styles/code.css`         | Syntax colours and editor furniture (below)                           |
| `apps/desktop/src/styles/fonts.css`        | UwU Console, the app's own editor font                                |
| `apps/desktop/src/lib/icons.ts`            | `APP_ICONS`: the suite's `ICONS` plus the editor's meanings           |
| `apps/desktop/src/components/nyu/`         | Nyu as a notebook, built on the package's `NYU`, `NyuFace`, `Sticker` |
| `apps/desktop/src/components/TitleBar.tsx` | The package `TitleBar` off the Mac, plus the menu bar and toolbar     |

Everything else imports from `@uwusuite/design`. Components never use raw hex
values; if a colour is missing, the fix is a token, not an inline value.

## The editor ground

**`--uwu-deep`** is where "goth, not pastel" actually comes from. In dark mode
it is _darker_ than `--uwu-canvas`, not lighter: the text sits at the bottom of
the window and the chrome floats above it. Light `#ffffff`, dark `#0e0b11`; with
high contrast plain white or plain black. `--uwu-deep-gutter` is the line
numbers, fold markers and git bar beside it.

**State colour is not brand colour.** Pink means "this one" — selected, active,
focused, found. Saved is mint (`--uwu-success-ink`), modified is amber
(`--uwu-warning-ink`), deleted is red. An editor that also used pink for
"unsaved" would have taught you nothing at a glance.

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

High contrast (Settings → Erscheinungsbild → Kontrast) swaps these for plain
black or white text with the hue kept only where it carries meaning.

## Type

- The interface uses the suite's font and picker (Settings → Schrift →
  Oberflächenschrift): UwU Sans by default, Manrope, Rubik, DM Sans or the
  system font.
- The editor has its own list: **JetBrains Mono** (default), **Fira Code** and
  **UwU Console**, all variable and bundled, plus any font the system has. UwU
  Console is the suite's monospace sibling of UwU Sans, built from Atkinson
  Hyperlegible Mono in `brand/fonts/uwu-console`; it falls back to the system
  monospace, not to JetBrains Mono.
- Ligatures are **off** in the editor and in inputs: `->`, `!=` and `==` stay
  what was typed. `:3` and `<3` are no longer turned into symbols anywhere.
- Font size 8–36, line height 1.55 by default. Both are per-app, not per-file;
  Ctrl+scroll changes the size and it stays changed.
- The chrome is dense: 13 px for menus, tabs and the status bar.

## Shape

The editor itself has **no** radius and no shadow. Rounded corners on a text
surface eat the first character of line one. Everything around it follows the
suite: pills for buttons, 16 px dialogs, shadows only on floating layers.

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

- **Title bar.** Off the Mac it is the package's `TitleBar` with Nyu and the
  wordmark, the menu bar below it. On macOS the window keeps the native
  traffic lights and the app menu lives in the system menu bar.
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
UwUSSH, and here it is a **notebook**. A pink spiral-bound notebook seen
head-on: the binding on the left, a darker elastic band on the right, two ruled
lines below the face, cat ears at the top corners and a yellow pencil tucked
behind the right ear. The cover is the face: UwU eyes, `w` mouth, blush.

- **Sticker style**, unchanged across the suite. Plum outlines `#4B1D3F`, pink
  body `#FF6FA6`, light page `#FFB8D3`, pastel props, a white die-cut edge.
  These are fixed artwork and stay the same in dark mode; the white edge is what
  keeps the outlines readable on a `#0e0b11` ground.
- **App icon** (website, GitHub, macOS Dock). Built like UwUMail's, UwUSSH's
  and UwURDP's: Nyu as a pink spiral notebook with cat ears, slightly tilted,
  rings on the left, a darker elastic band on the right and a yellow pencil
  tucked behind her right ear. The cover is the face, with two ruled lines
  below. A small star top left, the heart bottom right, a big star bottom left.
  On macOS the tile sits inside Apple's icon grid (see `scripts/icons.mjs`).
- **The tile.** Every UwU app's icon for the website and GitHub sits on
  UwUMail's pastel pink tile (`#FFF3F8` to `#FFD3E5`), never another colour.
  Each one gets sparkles and a heart, arranged differently around it.
- **Taskbar icon.** On the Windows taskbar, in the setup and in Linux menus
  Nyu stands alone: upright, no tile, white die-cut edge, the notebook with
  heavier outlines, rings and pencil, so it reads as notes; the ears say Nyu
  (`brand/uwunotes-taskbar-icon.svg`). At 16 and 24 px a simplified cut takes
  over (`uwunotes-taskbar-icon-small.svg`). `node scripts/icons.mjs` runs the
  suite's `uwu-icons` on these three and then builds the Mac icon.
- **The face** is the package's `NyuFace`; the notebook, its ears, the pencil
  and the paw are drawn here.
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
her page blinks at the editor's own rhythm. Settings → Erscheinungsbild → Animationen
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

The suite's rules apply ([tone](https://github.com/MinifyX/UwUSuite-Design/blob/main/docs/tone.md)): playful by default, Settings →
Tonfall → **Sachlich** replaces the words, never the layout or the colours.

| Situation       | Neutral                             | Playful                                 |
| --------------- | ----------------------------------- | --------------------------------------- |
| Nothing open    | Keine Datei geöffnet                | Ganz schön leer hier (・_・;)           |
| Saved           | Gespeichert                         | Gespeichert ✨                          |
| Search empty    | Keine Treffer                       | Nichts gefunden (・_・;)                |
| Session back    | Sitzung wiederhergestellt           | Alles wieder da (๑˃ᴗ˂)ﻭ                 |
| Draft recovered | 3 nicht gespeicherte Dateien zurück | Hab deine 3 Entwürfe aufgehoben (๑˃ᴗ˂)ﻭ |

**Warnings and errors are never playful**, in either tone. In an editor that
has a precise meaning: anything
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
`@uwusuite/design/plain.css` (tokens, UwU Sans, Nyu) rather than copying values
out of it, and it imports Nyu herself
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
  the app, through the same `data-motion` attribute the suite's CSS reads. Nyu holds
  still when the machine asks for that.
- **Failure is plain.** The warning rule above, applied to the one window where it is
  easiest to get wrong: the failure scene is Nyu looking sorry, her shadow and
  one dropped page — no stars, no hearts, no hopping. The heading says what
  went wrong, the line under it says what to do, and Windows' own message sits below that in the muted
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
