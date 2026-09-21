<p align="center">
  <img src="brand/uwunotes-app-icon.svg" width="112" alt="UwUNotes logo" />
</p>

<h1 align="center">UwUNotes</h1>

<p align="center">
  The editor I build for myself, because every other one annoyed me. (◕‿◕✿)<br/>
  Tabs · syntax highlighting · find in files · splits · macros — in pink
</p>

<p align="center">
  <a href="https://github.com/MinifyX/UwUNotes-Client/releases"><b>Download</b></a>
  ·
  <a href="KONZEPT.md"><b>Konzept auf Deutsch</b></a>
  ·
  <a href="docs/architecture.md"><b>How it works</b></a>
</p>

<p align="center">
  <a href="https://github.com/MinifyX/UwUNotes-Client/actions/workflows/ci.yml">
    <img
      src="https://github.com/MinifyX/UwUNotes-Client/actions/workflows/ci.yml/badge.svg"
      alt="CI"
    />
  </a>
</p>

---

## Why this exists

I wanted Notepad++. I still do — it opens instantly, it holds forty tabs without
thinking about it, and it has never once asked me to sign in. It also looks like
2004, and I stare at it for hours a day.

Everything newer fixed the looks and broke something else. The big ones are an
IDE with a text editor hidden in it somewhere, take six seconds to show me a
config file, and want a workspace before they want to be useful. The pretty
small ones drop the things that make an editor an editor: a hex-ish view of what
encoding a file really is, replace across a folder, a second pane. So I started
building my own.

- **Just for fun.** No company, no team, no schedule, no promises. I work on it
  when I have time and feel like it, so don't expect steady development, and
  don't be surprised by long breaks.
- **Written with AI.** Almost all of the code is written with Claude, because
  I'm honestly not a great programmer. Not your thing? No hard feelings, just
  pick something else.
- **Use it, fork it, do what you want with it.** The license only asks one
  thing: if you pass on a changed version, its source stays open too.
- **No support.** Issues and pull requests are okay, but I might answer late or
  not at all, and I mostly build what I need myself.

This is the sibling of [UwUMail](https://github.com/MinifyX/UwUMail-Client) and
[UwUSSH](https://github.com/MinifyX/UwUSSH-Client), and it shares their design
system, their tooling and their cat.

## What it is

A text and code editor for the files you open twenty times a day: a config, a
log, a script, the one function you want to read without cloning anything. This
is where it is headed; the status below says what is actually in the repository
today.

- **Opens like a text editor, not like a project.** Double-click a file, it is
  on screen. A folder in the sidebar is an option, never a requirement.
- **Tabs and splits.** The split view is a tree, so "split the right half again"
  needs no second concept, and a tab moves between panes by dragging.
- **Encoding you can see and argue with.** UTF-8, UTF-16, the legacy Windows
  code pages. The status bar says what was detected and how confident that was;
  one click reopens the file as something else, and saving puts the BOM and the
  line endings back exactly as they were.
- **Find in files.** Regex, whole word, include and exclude globs, `.gitignore`
  respected by default, results streaming in while the walk is still running.
  Replace touches only the files you already saw in the list.
- **Macros, the way Notepad++ meant them.** Record a bit of editing, play it
  back, play it back two hundred times, play it back until the end of the file.
  One Ctrl+Z undoes the whole run.
- **Nothing is lost when the app closes.** Unsaved buffers are written as drafts
  next to the session, so the window comes back the way you left it, split
  layout and caret positions included.
- **Private by default.** No telemetry, no account, no cloud. Since 0.2.0 it
  asks GitHub once per start whether a newer version exists, and that one
  request for a file is everything it sends anywhere. Otherwise it reads and
  writes files on your disk and that is the whole list.
- **Playful.** Nyu, the notepad cat, keeps you company. Prefer it plain?
  Settings → Tone → Neutral. Warnings and errors are never playful, in either
  tone.

> **Status: 0.4.0 is the release you can download, for Windows, macOS and
> Linux.** What is on the
> [releases page](https://github.com/MinifyX/UwUNotes-Client/releases) has a
> checksum beside it and is signed by neither Microsoft nor Apple — what that
> means is in [docs/install.md](docs/install.md). What runs is everything in the
> list above, plus what has landed since:
>
> - **Macros.** Record, play, play _n_ times, play to the end of the file. Save
>   one under a name and give it a Ctrl shortcut and it stays.
> - **Plugins that can bring commands.** The registry the bundled extras already
>   used now takes palette commands as well as a CodeMirror extension, so a
>   plugin can be nothing but commands — sort lines, change case, Base64. They
>   are still compiled in rather than loaded from a folder;
>   [docs/plugins.md](docs/plugins.md) says how to write one and what it may not
>   do.
> - **Themes you make yourself.** A theme here is a block of colours rather than
>   code, so the editor can edit one: copy a bundled theme, change what annoys
>   you, export it as JSON, paste in one somebody sent you.
> - **Git marks in the gutter.** Added, changed and deleted lines straight out
>   of `git diff`, next to the line numbers, in green and amber — never pink. A
>   repository that uses Git LFS went without them in 0.1.0: the check that
>   keeps a downloaded repository from running programs could not tell git-lfs
>   from one. 0.2.0 knows the handful of lines `git lfs install` writes and lets
>   exactly those through.
> - **It updates itself, and only from here.** New in 0.2.0. Once, a few
>   seconds after the window opens, it asks GitHub whether something newer
>   exists; if so, a strip above the status bar offers it, and the setup it
>   downloads has to carry the project's signature or it is not run. 0.1.0 has
>   none of this and will never offer you 0.2.0 — that one is a download by
>   hand.
> - **An installer of its own, with Nyu in it.** Since 0.3.0 on Windows, since
>   0.4.0 on macOS (a DMG each for Apple silicon and Intel) and Linux (an
>   archive with the setup in it). It installs under your user account without
>   asking for an administrator, carries the editor inside itself, is also the
>   uninstaller, and refuses an update that would take you backwards.
> - **A menu row, side by side, and a diff.** New in 0.4.0. Datei, Suchen,
>   Ansicht, Codierung, Sprache, Einstellungen and Werkzeuge along the top, an
>   icon row under them, two or three files next to each other, and two of them
>   compared line by line with the scrolling kept together. Ctrl+wheel zooms the
>   view, and Tools makes MD5 and SHA checksums of text or files.
>
> The [roadmap](docs/roadmap.md) is what is left, and it still has no dates on
> purpose.

## Install

The setups are on the
[releases page](https://github.com/MinifyX/UwUNotes-Client/releases): an .exe for
Windows, a DMG per Mac chip, and a tar.gz for Linux. On Windows it puts
the editor in `%LOCALAPPDATA%\Programs\UwUNotes` without asking for an
administrator, and it takes itself off again through Windows' own list of
installed apps. It is not signed, so Windows will put a box in front of it —
what that box means, and how to check the download against the published
checksum, is in [docs/install.md](docs/install.md); it also says what the setup
asks you, where your session and your drafts live, and what an uninstall leaves
behind, in English and in German.

That is the last download you have to think about: from 0.2.0 on the editor
looks once per start and offers the newer version itself. 0.1.0 does not look at
all, so coming from it is one more trip to the releases page.

Building it needs:

- Node.js 24 and pnpm 11 (`corepack enable`)
- Rust stable (via [rustup](https://rustup.rs))
- Platform prerequisites for Tauri: see
  [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
  (Windows: Visual Studio C++ Build Tools and WebView2)

```bash
git clone https://github.com/MinifyX/UwUNotes-Client
cd UwUNotes
pnpm install
pnpm tauri dev
```

Windows is the platform I develop on and the only one I test. macOS and Linux
are a Tauri build target away in theory and untried in practice.

## Project layout

| Path                      | What lives there                                                      |
| ------------------------- | --------------------------------------------------------------------- |
| `apps/desktop`            | The Tauri 2 app: React UI, CodeMirror editor core, Rust shell         |
| `apps/setup`              | The installer: the same Tauri and React, one window, the editor in it |
| `packages/uwu-tokens`     | `@uwu/tokens` — the palette the whole UwU Suite shares                |
| `crates/uwunotes-fs`      | Bytes: encoding detection, atomic writes, the tree, find in files     |
| `crates/uwunotes-session` | The session file, the drafts beside it, the recent lists              |
| `brand/`                  | Nyu in her notepad body: app icon, symbol, mono symbol                |
| `docs/`                   | Vision, architecture, design, roadmap                                 |
| `scripts/`                | The translation check, the setup build, the update feed               |

## Development

```bash
pnpm install
pnpm tauri dev
```

Checks, and what they mean:

```bash
pnpm typecheck && pnpm lint        # TypeScript, Prettier, and every t() has an English entry
cargo fmt --check && cargo clippy  # Rust formatting and lints
```

`pnpm lint` runs [`scripts/check-i18n.mjs`](scripts/check-i18n.mjs), which reads
every `t()` and `N_()` literal out of `apps/desktop/src` and fails if one of them
is missing from the English catalogue. German is the source language; English is
a lookup table. See [architecture](docs/architecture.md) for why round that way.
The setup is deliberately outside all of that: it is one window with forty
strings, it runs before UwUNotes exists on the machine, so it keeps both
languages in `apps/setup/src/texts.ts` and picks by system language.

The UI alone, without the Rust shell, is `pnpm dev` on port 1421 — useful for
working on components, useless for anything that touches a file. The setup's
page is the same idea on port 1431:

```bash
pnpm --filter @uwunotes/setup dev   # the installer's page in a browser
pnpm build:setup                    # editor, packed into UwUNotes-Setup-<version>.exe
```

In the browser it pretends: `?mode=update`, `?mode=uninstall`, `?mode=downgrade`
and `?fail=inUse` reach the screens that otherwise need a real installation to
go wrong in the right way. The engine has a sandbox of its own for that —
`UWUNOTES_SETUP_SANDBOX=<folder>` moves files, shortcuts and registry into one
folder nobody owns, which is how its tests install and uninstall for real
without touching anything.

## Documentation

- [Install](docs/install.md) — what you need, what Windows will warn you about,
  and where your data lives (English, then the same in German)
- [Konzept](KONZEPT.md) — the full concept, in German
- [Vision](docs/vision.md) — what I want UwUNotes to be and what it will never do
- [Architecture](docs/architecture.md) — how the pieces fit together
- [Plugins](docs/plugins.md) — how to write one, and the longer list of what one
  is not allowed to do
- [Design](docs/design.md) — colours, type, Nyu, tone of voice
- [Security review](docs/security-review-2026-09.md) — what was gone over before
  0.1.0, what was fixed, and what is left on purpose
- [Roadmap](docs/roadmap.md) — my wish list, without dates

## License

UwUNotes is free software under the [GNU GPL v3.0](LICENSE): use it, change it,
fork it, share it. If you pass on a changed version, its source has to stay open
too.
