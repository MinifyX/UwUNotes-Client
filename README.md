<p align="center">
  <img src="brand/uwunotes-app-icon.svg" width="112" alt="UwUNotes logo" />
</p>

<h1 align="center">UwUNotes</h1>

<p align="center">
  The editor I build for myself, because every other one annoyed me. (◕‿◕✿)<br/>
  Tabs · syntax highlighting · find in files · splits — in pink
</p>

<p align="center">
  <a href="#install"><b>Build it from source</b></a>
  ·
  <a href="KONZEPT.md"><b>Konzept auf Deutsch</b></a>
  ·
  <a href="docs/architecture.md"><b>How it works</b></a>
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
- **Nothing is lost when the app closes.** Unsaved buffers are written as drafts
  next to the session, so the window comes back the way you left it, split
  layout and caret positions included.
- **Private by default.** No telemetry, no account, no cloud, no update ping.
  It reads and writes files on your disk and that is the whole list.
- **Playful.** Nyu, the notepad cat, keeps you company. Prefer it plain?
  Settings → Tone → Neutral. Warnings and errors are never playful, in either
  tone.

> **Status: 0.1.0, nothing has shipped.** There are no downloads, no installer
> and no release. What exists is this repository: the Tauri shell, the Rust
> file and session crates, the shared token package, and the TypeScript spine
> the editor is being built on — documents, workspace, split layout, settings,
> i18n and the whole IPC contract in
> [`lib/api.ts`](apps/desktop/src/lib/api.ts).
>
> If you want to look at it, you build it yourself. If you want to use it as
> your editor, come back later. The [roadmap](docs/roadmap.md) is the wish list,
> and it has no dates on purpose.

## Install

There is nothing to install yet. Building it needs:

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

| Path                      | What lives there                                                  |
| ------------------------- | ----------------------------------------------------------------- |
| `apps/desktop`            | The Tauri 2 app: React UI, CodeMirror editor core, Rust shell     |
| `packages/uwu-tokens`     | `@uwu/tokens` — the palette the whole UwU Suite shares            |
| `crates/uwunotes-fs`      | Bytes: encoding detection, atomic writes, the tree, find in files |
| `crates/uwunotes-session` | The session file, the drafts beside it, the recent lists          |
| `brand/`                  | Nyu in her notepad body: app icon, symbol, mono symbol            |
| `docs/`                   | Vision, architecture, design, roadmap                             |
| `scripts/`                | The translation check, and whatever else the build grows to need  |

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

The UI alone, without the Rust shell, is `pnpm dev` on port 1421 — useful for
working on components, useless for anything that touches a file.

## Documentation

- [Konzept](KONZEPT.md) — the full concept, in German
- [Vision](docs/vision.md) — what I want UwUNotes to be and what it will never do
- [Architecture](docs/architecture.md) — how the pieces fit together
- [Design](docs/design.md) — colours, type, Nyu, tone of voice
- [Roadmap](docs/roadmap.md) — my wish list, without dates

## License

UwUNotes is free software under the [GNU GPL v3.0](LICENSE): use it, change it,
fork it, share it. If you pass on a changed version, its source has to stay open
too.
