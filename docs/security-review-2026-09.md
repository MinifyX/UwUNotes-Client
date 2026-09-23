# Security review, September 2026

Done before the first release (0.1.0), across everything Phase 1 and Phase 2
left behind: reading and writing files, encodings, find and replace in files,
the session and its drafts, the commands the page can call, git, the page
itself, and the workflow that builds the installer. Five reviews, each finding
put to somebody whose job was to refute it, and what survived is below.

Nothing here was exploited by anyone. UwUNotes has no server and no account, so
there is nobody to attack and nothing to steal. What there is, is a program that
opens other people's files and writes them back — and most of what follows is
about that, not about intruders.

Three things have changed since, and all three are in
[Since 0.1.0](#since-010): the Git LFS restriction was replaced by something
narrower and there is now an updater, both in 0.2.0 — and since then UwUNotes
has its own setup, which is the program that updater runs. The updater is the
only part of UwUNotes that talks to a network; the setup is the only part that
puts a program on a disk on purpose.

## The trust boundary

The page inside the window is **inside** the trust boundary. It can read and
write any file the user can, so a compromised page already acts as the user.
Everything that guards against the page is defence in depth, not a wall. What
keeps the page trustworthy is that it only ever renders UwUNotes' own code: a
strict content security policy (`script-src 'self'`, no inline scripts, no
frames, no objects), frozen prototypes, no `dangerouslySetInnerHTML`, and no
extension mechanism that loads code from a folder.

That makes the real threat model hostile **input**, not a hostile page:

- a file the user opens — any bytes at all, huge, binary, half-decoded, a
  2 GB line;
- a folder the user opens — file names, links, junctions, deep nesting;
- a session file, a settings blob, a macro list, a theme — all JSON on disk
  that the user, or something else running as them, could have edited by hand;
- a git repository whose configuration and branch names somebody else chose;
- a search expression and a replacement.

That is what was attacked. Where a finding only matters if the page is already
compromised, it says so and is rated accordingly.

Severity: **High** is data loss or code execution a normal user could hit.
**Medium** needs unusual input or an unlucky race, but is real. **Low** is
defence in depth, resource exhaustion, or a crash with nothing behind it.

## Fixed

| Severity | Where                       | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Saving, `uwunotes-fs`       | A save that could not be staged — a full disk, a spent quota, a drive going — fell back to writing straight over the file, which empties it at the moment it is opened and then failed for the same reason. The file was left empty and the text was gone. The fallback now only happens for the failures that say nothing about whether bytes can be written; a failed staging is reported and the file is untouched.                                                                               |
| High     | Drafts, `uwunotes-session`  | Unsaved text is parked in a draft file. If the session file could not be read — hand-edited, truncated by a crash — the app opened one empty buffer and the first autosave then deleted every draft as "belonging to nothing". Switching off "restore my tabs" did the same. Sweeping up now needs both the page and the store to agree that the open documents really are the whole list.                                                                                                           |
| High     | Git marks                   | Opening a folder, or even a single file, ran `git status` and `git diff` in it. Several settings in a repository's own `.git/config` are programs for git to run, and that file travels inside a zip or a synced folder — so a downloaded project could run a program as the user, silently, every eight seconds. Those settings are now switched off by flag, and a repository that names one no tree letters or gutter marks at all. Narrowed in 0.2.0 for Git LFS; see [Since 0.1.0](#since-010). |
| Medium   | Saving, `uwunotes-fs`       | Characters the file's encoding cannot write — an arrow or an emoji in a Windows-1252 file — were written as `&#8594;` and the save reported success. The editor kept showing the arrow until the file was reopened. The save now stops and offers UTF-8, "save anyway", or cancel.                                                                                                                                                                                                                   |
| Medium   | Saving, `uwunotes-fs`       | Saving through a hard link or a symlink replaced the _name_ instead of the file: the other name kept the old text, or a link was destroyed and the file it pointed at never written — and the editor said "saved". The contents now go through the target's own name when it shares them.                                                                                                                                                                                                            |
| Medium   | Saving, `uwunotes-fs`       | A save gave the file the containing folder's permissions. A file deliberately locked down became as open as the folder it sat in, and its alternate data streams — including Windows' "this came from the internet" mark — were dropped. Windows' `ReplaceFileW` is used now, which carries all of that across. Verified: an access list of one user survives a save, and so does a `Zone.Identifier` stream.                                                                                        |
| Medium   | Opening, `uwunotes-fs`      | The 64 MiB limit was checked with one call and the file read with another, so a file that grew in between was read whole. Worse, nothing required the path to be an ordinary file: a `\\.\pipe\…` path in a hand-edited session file passed every check and then blocked forever, and the app never left its start-up screen — on that launch and every one after. One handle answers both questions now.                                                                                            |
| Medium   | Replace in files            | A replacement rewrote every line ending in a file that mixed them, and turned a bare carriage return inside a line — progress output, old Mac text — into a real line break. One word replaced showed up as a whole-file diff. The replacement now touches the matched span and nothing else.                                                                                                                                                                                                        |
| Medium   | Replace in files            | `^` and `$` meant "line" while searching and "file" while replacing, so the dialog could say "3 matches will be replaced" and one was. The replace runs line by line now, the way the search matched.                                                                                                                                                                                                                                                                                                |
| Medium   | Replace in files            | A file that did not decode cleanly was rewritten anyway, making the replacement characters permanent; and a replacement the file's code page could not write became `&#8594;` in every match. Both are refused per file now, with the reason, and the files that could take it are still done.                                                                                                                                                                                                       |
| Medium   | Find bar                    | "Replace all" collected one change per match with no ceiling. A pattern that can match nothing — `\d*` instead of `\d+` — has a match at every offset, which on a large file is millions of objects and a dead renderer. It now refuses above 200 000 before anything is changed.                                                                                                                                                                                                                    |
| Medium   | Workflows                   | Every action the release job used was a moving tag or a branch, so what built the installer was whatever those repositories said on the day. All of them are pinned to a commit now, in both workflows, with the version in a comment.                                                                                                                                                                                                                                                               |
| Low      | Saving, `uwunotes-fs`       | The temporary file was `.uwunotes-<pid>-0.tmp` — a name anything could work out — and was opened in a way that would take over a file already sitting there, following it if it was a link. The name is now unguessable and the open refuses an existing file outright.                                                                                                                                                                                                                              |
| Low      | Find bar                    | A regular expression like `(a+)+b` typed into the find bar ran unbounded on the thread that draws the window: 24 characters is a tenth of a second, 40 is hours, and nothing can interrupt it once it starts. Patterns are now measured against short samples first and refused if they are already slow.                                                                                                                                                                                            |
| Low      | Find in files               | Every match on a line was collected before the match budget was consulted, so a line of nothing but the letter being searched for cost megabytes to produce a handful of rows. Collection stops one past the budget.                                                                                                                                                                                                                                                                                 |
| Low      | Find in files               | On a line that is not valid UTF-8 the highlight and the click target pointed at the wrong characters, because the offsets were measured before the replacement characters were put in. They are moved with it now.                                                                                                                                                                                                                                                                                   |
| Low      | Session, `uwunotes-session` | `session.json` had no size limit and no limit on how many documents it could describe. A hand-written one listing 200 000 tabs parsed fine and then held the start-up screen forever. There is a ceiling on the file and on what it may describe, and drafts are capped at the same 64 MiB as any other file.                                                                                                                                                                                        |
| Low      | Themes                      | A theme value only had to satisfy `CSS.supports('color', …)`, which says yes to anything containing `var()` — including `var(--a){`, whose brace swallowed the rest of the stylesheet and left the editor unstyled until the theme was found and deleted. Values carrying CSS punctuation are refused before the browser is asked.                                                                                                                                                                   |
| Low      | Font setting                | The font name was stripped of quotes and braces but not of a newline, which ends a CSS string just as surely. Control characters are removed when settings are read, and again where the name is quoted.                                                                                                                                                                                                                                                                                             |
| Low      | Git                         | `Command::new("git")` lets Rust resolve the name, and on Windows that search starts in the folder the app runs from — which a per-user install makes writable by anything running as the user. `git` is now looked up on PATH with that folder left out.                                                                                                                                                                                                                                             |
| Low      | Workflows                   | The release checkout left a token that can write to the repository in `.git/config`, where every dependency's build script could read it, for no reason: nothing after that step uses git. It is not persisted any more.                                                                                                                                                                                                                                                                             |
| Low      | Workflows                   | `packageManager` named a pnpm version without its hash, so the first thing both workflows did was download and run a tarball they could not check. The hash is in `package.json` now; corepack refuses a tarball that does not match.                                                                                                                                                                                                                                                                |

Two things were added beside the fixes:

- Releases now carry a `SHA256SUMS.txt`. The installers are unsigned by design,
  so this is the only thing a download can be checked against. It proves
  nothing on its own — the same job publishes both — but a file swapped
  afterwards stops matching.
- `uwunotes-fs` went from `#![forbid(unsafe_code)]` to `#![deny(unsafe_code)]`.
  Three of the fixes need Windows calls the standard library does not wrap:
  telling a file from a named pipe, counting a file's names, and replacing a
  file without handing it the folder's permissions. All three live in
  `src/windows_api.rs`, which is the only place the lint is turned off.

Most of these have a test next to them now, because a security fix without a
test is a security fix that comes back: a hard link that survives a save, a
named pipe that is refused, a mixed-line-ending file that comes back
byte-identical, a truncated session that leaves its drafts alone, a pattern
that is turned away before it freezes the window.

## Since 0.1.0

Two changes after this review was written. Neither fixes something found here:
one replaces an entry that used to be under "Accepted, for now", and the other
is surface that did not exist when the list above was made.

### Git LFS, narrowly let back in

0.1.0 refused to decorate any repository whose `.git/config` named a program,
and could not tell a locally installed Git LFS from anything else, so every
repository using LFS lost its status letters and its gutter marks. The check now
reads the values as well as the keys — `git config --local --list --null`, where
a value containing a newline stays inside its own record and so cannot forge a
second entry — and allows exactly the five whole values `git lfs install
--local` writes, compared after `trim()`, never by prefix and never as a
substring. `filter.lfs.clean` has no `--skip` form; the other two have one each,
and the code says so where somebody would otherwise read the gap as an
oversight. Any other value under those keys is refused exactly as before, a key
with no value at all is never canonical, and every other exec-capable key is
refused whatever it holds. Five tests hold that shape, one of them the
newline-inside-a-value case.

What it costs, in the words of the work that did it: a repository that ships the
canonical LFS filter values gets decoration again, which means `git status` and
`git diff` will run `git-lfs clean` — the user's own git-lfs, resolved via git's
PATH lookup, never a program the repository names — on that repository's file
contents, at moments the repository can influence. What is delegated, therefore,
is trust in git-lfs itself: its clean filter reads the repository's
`.lfsconfig`, and any future git-lfs bug or `.lfsconfig` key that escalates into
code execution would be reachable from a merely-opened folder again.

### The updater

What it rests on, in the order an update travels:

- **What is signed.** The release workflow signs `UwUNotes-Setup-<version>.exe`
  with the project's minisign key. The private half is two repository secrets
  and reaches exactly one step — the one that runs `pnpm build:setup` — through
  its `env:`, never interpolated into a `run:` line, where it would be in the
  log of the first job that failed interestingly. The script then takes both
  values back out of `process.env` before it starts anything and asserts they
  are gone, so the two builds underneath it — hundreds of `build.rs` and npm
  scripts from the dependency graph — never run with the key in reach; only
  `tauri signer sign` is handed it. The job fails if no `.sig` appeared, because
  an unset secret looks from the outside exactly like a build that simply did
  not sign. The MSI is bundled in a separate step with no secrets at all and
  `createUpdaterArtifacts` switched off for that build alone. The public half,
  key id `665FE923BCD2E6A4`, sits in `tauri.conf.json` and is therefore in every
  installed copy.
- **What is checked before anything is installed.** `Update::download` verifies
  the signature against that public key before the bytes reach the app, and it
  is the only route to them. No command takes an endpoint, a URL or a path; the
  endpoint is config and nothing overrides it; and the plugin's own commands are
  not in `capabilities/default.json`, so the page cannot reach them either. The
  plugin offers an update only when its version is greater than the running one.
- **What is checked again, a moment later.** The downloaded setup is written
  into `%LOCALAPPDATA%\app.uwunotes.desktop\updates`, which is emptied first —
  a folder anything running as this user can write to. So it is read back from
  there through a handle opened with `FILE_SHARE_READ`, which refuses everyone
  else write and delete access, and the signature and the file name in its
  trusted comment are verified a second time, on the bytes that are actually
  going to run. That handle is held until the setup process exists; only then is
  it dropped and the app exits. A setup that fails the second check is deleted
  rather than left lying under the name a release published — after the handle
  is gone, because the lock is precisely a refusal to let anyone delete it. A
  check of bytes other than the ones that run is not a check.
- **What is checked before the feed is published.** `scripts/update-feed.mjs`
  verifies the same signature the same way an installed copy will — key id
  against the configured public key, ed25519 over the blake2b prehash, the
  trusted comment, and the file name inside that comment, which is what catches
  a `.sig` an earlier build left in `target/`. It then re-reads what it is about
  to write, and asks GitHub whether that exact asset is really attached to the
  release with that size. A feed naming a file nobody can download is not a
  delay; it is a failed update on somebody's machine, retried until the next
  release.
- **Where the feed lives.** `latest.json` on `updates`, an orphan branch of this
  repository, served over `raw.githubusercontent.com`. It is pushed by the
  release job only after the release exists with its files attached, with a
  token handed to that one step — the checkout runs with
  `persist-credentials: false`, which is what makes writing the branch a
  deliberate act rather than something any build script in the dependency graph
  could have done with a token left lying in `.git/config`.
- **What deliberately never reaches it.** A tag with a suffix is a pre-release:
  it gets a GitHub release and no feed entry, so a beta never arrives on
  somebody's machine on its own. The workflow says so in a `::notice::` rather
  than skipping the step in silence, and the feed script refuses a pre-release
  version outright.
- **What a failure does.** Nothing visible. No network, a 404, a feed that is
  GitHub's HTML error page — all of them are one `warn` line and "nothing
  today". Only a check the user asked for may report that it failed; the one at
  start-up never does, so nothing about the network can train somebody to click
  a warning away.
- **What happens to unsaved text.** The app starts the setup and then ends
  itself, so the window's close guard never runs. The page writes the session
  and its drafts to disk before it starts the download; without that, installing
  an update would be the one action in the app that can lose text. The setup on
  the other side waits for that process to be gone before it replaces anything,
  and never ends it.

### The setup

`apps/setup` is new surface: a program that writes executables, shortcuts and
registry values, and the one thing an update runs. It was gone over on the same
terms as the rest.

- **It runs as the user, and stays in their profile.** No elevation, no manifest
  asking for any, nothing per machine. What it writes is
  `%LOCALAPPDATA%\Programs\UwUNotes` (or a folder the user typed instead), the
  two shortcut folders, and `HKEY_CURRENT_USER\…\Uninstall\UwUNotes` plus one
  key of its own. It can do nothing the person who double-clicked it could not
  have done by hand, which is the property that makes an installer boring.
- **The editor is inside it, not fetched.** `build.rs` packs `UwUNotes.exe` with
  zstd and `include_bytes!` puts it in the binary; installing unpacks it and
  compares the result against the size recorded at build time. Nothing is
  downloaded while installing, so there is no second file to check and no
  address to get wrong. A build made without a payload — every `cargo test`, and
  anyone working on the page — says so on screen instead of installing nothing.
- **The one exception is WebView2**, which the window itself needs: if the
  runtime is missing the setup asks, then fetches Microsoft's bootstrapper over
  https from `go.microsoft.com` into a folder named after its own process id,
  runs it, and deletes the folder. It is under [Accepted](#accepted-for-now).
- **A downgrade is refused, and so is not knowing.** The signature says a setup
  came from this project; it says nothing about which version it is, so a feed
  serving an old build would otherwise be a downgrade nobody asked for. An
  update compares the packed version against the installed one and stops if it
  is older — and stops too when the installed version cannot be read, rather
  than assuming. It fails closed on purpose: that is a mistake the sibling made
  once. Running the setup by hand is a person deciding and still installs.
- **It never ends the editor.** Counting processes is all it does, by full path
  rather than by name, so a second UwUNotes elsewhere is not mistaken for this
  one. An open copy is reported and the user decides. An installer that closes a
  text editor with unsaved text in it is a data-loss bug with a progress bar.
- **Nothing is left half-written.** The editor and the uninstaller are written
  beside their destinations as `.new` and renamed into place, with retries for
  the moment Windows keeps an executable locked after it ends. A failed install
  leaves the previous `UwUNotes.exe` intact.
- **What the window can reach.** Six commands of its own and no plugin loaded at
  all; the capability grants `core:default` plus dragging, minimizing and
  closing. `open_external` takes `https://` with a real host and refuses
  anything carrying control characters, whitespace or a quote — a setup is the
  last program on a machine that should be talked into starting something. The
  policy is `default-src 'self'` with `connect-src` on the IPC scheme, frozen
  prototypes, no inline scripts and no frames. The window's own browser data
  goes to the temp folder, so an uninstall leaves nothing of it behind.
- **DLLs come from System32.** `SetDefaultDllDirectories` is the first thing
  `main` does, before anything else in the process can load one, and
  `/DEPENDENTLOADFLAG:0x800` covers the ones the loader resolves before that.
  A setup runs from the Downloads folder, next to whatever else was downloaded
  there, and that is exactly where a planted DLL would be.
- **The uninstaller deletes itself carefully.** Windows will not remove a
  running program, so it restarts from a copy in the temp folder and has that
  copy removed after it exits. The path is handed to `cmd` through an
  environment variable rather than in the command line, because `cmd` expands
  `%…%` inside quotes too — a profile folder with a percent sign in its name
  must never become part of the command.
- **The sandbox is only a redirection.** `UWUNOTES_SETUP_SANDBOX` moves files,
  shortcuts and registry under one folder and one key, which is what lets the
  tests install, update and uninstall for real on the machine running them. It
  narrows what the setup touches and never widens it, and anything able to set
  it already runs as the user.
- **What it does not claim.** Windows sees a program nobody vouched for, exactly
  as before: the minisign signature is for the updater, not for SmartScreen.

## Before 0.4.0

A second pass, over the whole tree again and over what 0.4.0 adds: the menu
row, the comparison, the hash tool, printing, and the setup on macOS and Linux.
Every fix from the first pass above was still in place. What it found:

- **High — a repository could still run a program.** The check in `git.rs`
  read `git config --local`, which is `.git/config` alone: it follows no
  `include.path` and does not list `.git/config.worktree`. A clean filter in an
  included file passed the check and ran on the next `git status` — every eight
  seconds for a freshly unzipped project, whose timestamps never match the
  index. Reproduced with git 2.54. Now the check reads
  `git config --list --includes --show-scope`, judges the `local` and
  `worktree` scopes (an included file carries the scope that included it),
  and refuses any `include`/`includeIf` key outright. A test runs the exploit
  against a real git.
- **High — submodules.** A submodule's config lives in
  `.git/modules/<name>/config`, which nothing checked, and a status of the
  parent runs a status inside each submodule. Status now passes
  `--ignore-submodules=all`, and every git call sets
  `diff.ignoreSubmodules=all`.
- **Medium — a verdict for the whole run.** A repository judged safe stayed
  safe until the app closed, whatever happened to its config afterwards. The
  verdict now holds for five seconds.
- **Medium — the signing key and dependency build code shared a job.** Taking
  the key out of `process.env` inside `build-setup.mjs` did not take it out of
  the shell that started it, and a `build.rs` running as the same user could
  also have rewritten the signer in `node_modules` or planted a git hook for
  the feed push. The release is now build jobs with no secrets, a `sign` job
  that installs nothing from the workspace and signs with a separately
  installed CLI, and a `publish` job that builds nothing. The release build
  jobs also stopped restoring the pnpm cache, which the paragraph under
  "Checked and fine" had claimed they never did.
- **Low — `cmd` from the temp folder.** The uninstaller's self-delete ran
  `cmd` by bare name from its copy in `%TEMP%`, where Windows looks first. It
  uses the absolute path from the system directory now.

The new surface, checked and fine: the printed copy is built with
`textContent`; the rename refuses separators, `..` and reserved characters
before a path is ever joined; the hash of a file refuses pipes and devices
the way reading one does; the menus and the compare bar render file names as
text. On macOS and Linux the setup installs per user, refuses a target that is
a symlink pointing elsewhere, and removes only files it wrote.

## 2026-09-23

A third pass, over the whole repository at 571ec64, with the earlier fixes
re-checked first. All of them still held. What it found:

- **High — a hook in `.git/hooks` ran on the gutter's diff.** Fixed in
  b559d22. The check in `git.rs` reads the config and nothing else, and a
  hook in the default hooks directory is named by no config key: the
  repository was judged inert and git was run in it. A `git diff` of a file
  whose timestamp the index does not know — every file of a freshly unpacked
  or synced project — refreshes the index, writes it despite
  `--no-optional-locks`, and runs `post-index-change`. Reproduced with git
  2.55; the comment on `git()` that said `--no-optional-locks` prevented this
  was wrong, and is corrected. Every git call now passes `core.hooksPath` set
  to the git executable's own absolute path, which as a file can hold nothing
  beneath it, so no hook is found on any system. Neither an empty value nor
  `/dev/null` would do: git for Windows reads the first as the root of the
  repository's drive and turns the second into a path relative to the working
  tree. Hooks declared in the config (`hook.<name>.command`) are keys like the
  others and already refused. A test plants the hook in a real repository,
  shows that a plain `git diff` runs it, and that the gutter's diff does not.
- **Not affected — the AppImage extraction directory.** The sibling app's
  updater started its Linux setup with `APPIMAGE_EXTRACT_AND_RUN=1`, which
  unpacks into a predictable folder under `/tmp`. UwUNotes's updater starts no
  AppImage: on Linux it installs a `.deb` or `.rpm` through `pkexec` from a
  fresh private temporary folder, and copies that came some other way are
  updated by hand.

Also removed, as dead code: the `list_places` command, which the page never
called, and the part of `uwunotes-fs` only it used.

## Accepted, for now

- **Microsoft's WebView2 bootstrapper is downloaded and run.** Over https, from
  a Microsoft address, into a folder of this process's own, after the user said
  yes — and nothing in the setup checks the file beyond that transport. It is
  Microsoft's own installer and the alternative is an editor with nothing to
  draw in, but it is the one case where this setup runs bytes it did not bring
  with it.
- **Trusting git-lfs, in a repository that uses it.** The allowance above is
  value-exact, which is the point and also the price: the day git-lfs changes
  the string it writes, those repositories quietly go back to having no
  decoration until the list in `git.rs` is updated. And a repository that does
  ship the canonical values has a clean filter run over its contents because a
  folder was opened, so a future bug in git-lfs is reachable that way. That is
  worth a gutter; a program the repository itself named never was.
- **Losing the private signing key ends updates for everybody who already has
  UwUNotes.** Each installed copy trusts that one public key and nothing else.
  There is no second key and no revocation, so a new one reaches nobody: every
  existing installation would have to hear about it some other way and install
  by hand. That the key is backed up somewhere other than the machine it was
  made on is an arrangement, not a mechanism.
- **Whoever can write the `updates` branch decides what is offered.** The feed
  is pushed by the release job with the repository's own token, so an account
  that can push here can change it. Such an account could publish a release
  anyway, so this adds less than it first looks — but two things are worth
  naming. The feed can withhold an update indefinitely and nothing on a user's
  machine would notice. And nothing ties the version a feed claims to the file
  it points at, so an old, properly signed setup can be offered as if it were
  new. The key stops somebody else's program from being installed; it does not
  stop an older build of this one. What does, now, is the setup itself: it reads
  what is installed and refuses to go backwards, so such an offer is downloaded,
  started and then declines. That leaves a feed able to keep people on an old
  version, not able to put them back on one.
- **The check tells GitHub that somebody asked.** It is a plain request for a
  public file and carries nothing about the machine beyond what any HTTPS
  request carries: an address, a user agent, a time. That is not nothing, and it
  is the only thing UwUNotes sends anywhere. It happens once per run of the app,
  never on a timer, and only while the `autoCheckUpdates` setting is on, which
  it is by default.
- **The temporary file during a save has the folder's permissions.** It holds
  the whole document for the moment between being written and taking the
  target's place, so for a file whose original was restricted, the contents are
  readable by anyone with access to the folder during that window. Closing it
  means creating the file with an explicit access list by hand, which is a lot
  of unsafe code for the size of the window.
- **A regular expression that is quick at 32 characters and catastrophic at 60
  still freezes the window.** The find bar measures a pattern against short
  samples and refuses the ones that are already slow, which covers the whole
  realistic nested-quantifier family. Catching the rest means matching in a
  worker so it can be killed, which is more machinery than this editor has
  earned. The measurement is shared with find in files, which runs in Rust and
  could have taken such a pattern in its stride — so a handful of expressions
  that would have worked there are now turned away as well. Having the two
  halves disagree about what a query means would be the worse trade.
- **A save can still be answered with a plain write.** When the temporary file
  cannot be created because the folder takes no new files, and when the rename
  is refused — network shares, replacing a hidden file — the contents are
  written directly. That is not atomic, but it is what makes those saves work
  at all. It is logged at `warn` now rather than `debug`, so it is findable.
- **Hard links in `node_modules` are written through.** pnpm hard-links its
  global store into projects, and saving a file that shares its contents now
  edits the shared copy rather than quietly breaking the link. Most of those
  files are read-only and refused earlier; where they are not, silently
  breaking a link while reporting a clean save was the worse of the two
  surprises.
- **The same Windows user is trusted.** Anything running as the user can
  replace UwUNotes itself, so the guards around the install folder narrow a
  window rather than close a door.
- **Requiring pinned actions is not switched on in the repository settings.**
  Both workflows are pinned by hand; the setting that would refuse an unpinned
  one in a future workflow is a change to the repository's configuration, not
  to this tree, and has not been made.

## Checked and fine

The point of saying so: these were attacked and held.

**Encodings.** Decoding and re-encoding gives back the original bytes. UTF-16 is
encoded by hand, deliberately — `encoding_rs` would quietly write UTF-8 instead.
A byte order mark is never written for an encoding that has none, so a forced
setting cannot put three stray characters at the top of a Windows-1252 file.
Truncated and malformed marks, an odd-length UTF-16 body and an unpaired
surrogate all decode without panicking, and the two that lose information say
so. The UTF-16-without-a-mark guess looks at 4 KiB and no more. The
"replacement" pseudo-encoding, which decodes every file to a single replacement
character, cannot be selected.

**Reading and writing.** The stamp is taken before the bytes, which is the safe
order: a file that changes mid-read gets an already-stale stamp and the next
save asks rather than silently winning. A read-only file is refused rather than
un-protected behind the user's back, and the page offers Save As. Reserved
device names fail rather than swallowing a document. A path with a NUL in it
never reaches the filesystem. The tree's own operations cannot overwrite a
neighbour: creating a file refuses an existing name, renaming refuses an
existing destination, and deleting goes to the recycle bin.

**Find in files.** A junction cannot walk the search out of the folder that was
opened, and neither can an include glob: the globs filter what the walk already
produced. Pipes, devices and directories never reach the searcher. Oversized
files are skipped and counted. A pathological pattern is not a denial of
service — Rust's regular expression engine matches in linear time, and a
genuinely enormous pattern is refused at compile time. The preview slicing is
panic-safe on every malformed input tried, which matters because a panic here
would take the window with it. Cancelling works even under a fast typist, and
nothing accumulates a whole result set in Rust. A replace re-reads each file, so
it never writes back what the search saw, and one bad file does not cost the
user the other thirty-nine.

**Drafts.** A document id is hostile input on the way to a file name, and it is
treated as one: `../../evil`, `C:/Windows/System32/x`, `CON`, a right-to-left
override and an empty string all land in the drafts directory as one ordinary
file name, with a hash so two ids that sanitise alike keep their own files.

**The command surface.** The page is granted the minimum: six window controls
for the custom title bar, read-only getters, and event listening. It has no file
plugin and no opener permission at all — in particular nothing that would hand a
path to the shell. The updater plugin is registered in Rust and its own commands
are not in the capability either, so the page cannot ask it to fetch anything:
the two update commands it does have take no address. The only way out of the app is a check that allows `http`,
`https` and `mailto` and nothing else, which survived every spelling tried. No
command is registered that the page never calls. Nothing builds a command line
an argument could be injected into, the console is hidden everywhere a process
is spawned, and the git polling cannot pile up.

**The page.** No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, no
`new Function`. A search result's preview reaches the DOM as text, so a file
containing markup renders as characters, and the release notes in the update bar
— the one string in the app that comes off a network — reach it the same way. There is no outbound channel: nothing
assigns a link, a source or an address anywhere in the page, the four links the
About box offers are hard-coded and go through a scheme check in Rust, and the
content security policy would not allow a request even if one appeared — which
is also what keeps a `url()` in a hand-written theme cosmetic rather than a
tracking pixel. Every `JSON.parse` result is copied field by field into a
fresh object, so `__proto__` is an ignored key rather than a sink, and
prototypes are frozen regardless. Every question the app asks puts the
cancelling answer last, so Escape always takes the safe branch. The split-tree
validator survives a session that points at itself. A hand-edited macro list
cannot steal a key from the app, and playback is bounded. The file tree's
automatic expansion is bounded against a junction that points at its own parent.
Git gutter marks from a diff that no longer matches the buffer land somewhere
harmless rather than throwing mid-keystroke. Every viewport decorator — indent
guides, trailing whitespace, the minimap — works on what is on screen, so a
200 000-line file costs a screenful of work.

**The build.** No `${{ }}` expression is pasted into a script anywhere; the one
attacker-adjacent value, the tag name, goes through the environment. Neither
workflow uses `pull_request_target`, and permissions are read-only everywhere
except the one job that publishes. CI references no secret at all; the release
job has two, the signing key and the token that writes the feed branch, and each
reaches exactly the step that needs it through `env:` — both under
[Since 0.1.0](#since-010). The release build
restores no cache (since 0.4.0 — see above), so a malicious pull request cannot poison what it compiles,
and the artifact glob can only match what the build just produced. Dependency
installs cannot run arbitrary scripts: one package is allowed to build and the
lockfiles resolve everything from the default registry. DLLs load from System32
only, in the app and at link time, because the app runs from a folder the user
can write to — the setup sets the same rule for itself, at link time and as its
first statement. Release builds ship no source maps. The installer is now the
project's own program and is reviewed as such above; it runs nothing else, and
touches no world-writable location. Nothing in the repository or its history is
a secret that should not be there.
