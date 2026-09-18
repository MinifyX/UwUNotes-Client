# Security review, September 2026

Done before the first release (0.1.0), across everything Phase 1 and Phase 2
left behind: reading and writing files, encodings, find and replace in files,
the session and its drafts, the commands the page can call, git, the page
itself, and the workflow that builds the installer. Five reviews, each finding
put to somebody whose job was to refute it, and what survived is below.

Nothing here was exploited by anyone. UwUNotes has no server, no account, no
network calls and no auto-updater, so there is nobody to attack and nothing to
steal. What there is, is a program that opens other people's files and writes
them back — and most of what follows is about that, not about intruders.

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

| Severity | Where                       | What                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Saving, `uwunotes-fs`       | A save that could not be staged — a full disk, a spent quota, a drive going — fell back to writing straight over the file, which empties it at the moment it is opened and then failed for the same reason. The file was left empty and the text was gone. The fallback now only happens for the failures that say nothing about whether bytes can be written; a failed staging is reported and the file is untouched.                 |
| High     | Drafts, `uwunotes-session`  | Unsaved text is parked in a draft file. If the session file could not be read — hand-edited, truncated by a crash — the app opened one empty buffer and the first autosave then deleted every draft as "belonging to nothing". Switching off "restore my tabs" did the same. Sweeping up now needs both the page and the store to agree that the open documents really are the whole list.                                             |
| High     | Git marks                   | Opening a folder, or even a single file, ran `git status` and `git diff` in it. Several settings in a repository's own `.git/config` are programs for git to run, and that file travels inside a zip or a synced folder — so a downloaded project could run a program as the user, silently, every eight seconds. Those settings are now switched off by flag, and a repository that names one no tree letters or gutter marks at all. |
| Medium   | Saving, `uwunotes-fs`       | Characters the file's encoding cannot write — an arrow or an emoji in a Windows-1252 file — were written as `&#8594;` and the save reported success. The editor kept showing the arrow until the file was reopened. The save now stops and offers UTF-8, "save anyway", or cancel.                                                                                                                                                     |
| Medium   | Saving, `uwunotes-fs`       | Saving through a hard link or a symlink replaced the _name_ instead of the file: the other name kept the old text, or a link was destroyed and the file it pointed at never written — and the editor said "saved". The contents now go through the target's own name when it shares them.                                                                                                                                              |
| Medium   | Saving, `uwunotes-fs`       | A save gave the file the containing folder's permissions. A file deliberately locked down became as open as the folder it sat in, and its alternate data streams — including Windows' "this came from the internet" mark — were dropped. Windows' `ReplaceFileW` is used now, which carries all of that across. Verified: an access list of one user survives a save, and so does a `Zone.Identifier` stream.                          |
| Medium   | Opening, `uwunotes-fs`      | The 64 MiB limit was checked with one call and the file read with another, so a file that grew in between was read whole. Worse, nothing required the path to be an ordinary file: a `\\.\pipe\…` path in a hand-edited session file passed every check and then blocked forever, and the app never left its start-up screen — on that launch and every one after. One handle answers both questions now.                              |
| Medium   | Replace in files            | A replacement rewrote every line ending in a file that mixed them, and turned a bare carriage return inside a line — progress output, old Mac text — into a real line break. One word replaced showed up as a whole-file diff. The replacement now touches the matched span and nothing else.                                                                                                                                          |
| Medium   | Replace in files            | `^` and `$` meant "line" while searching and "file" while replacing, so the dialog could say "3 matches will be replaced" and one was. The replace runs line by line now, the way the search matched.                                                                                                                                                                                                                                  |
| Medium   | Replace in files            | A file that did not decode cleanly was rewritten anyway, making the replacement characters permanent; and a replacement the file's code page could not write became `&#8594;` in every match. Both are refused per file now, with the reason, and the files that could take it are still done.                                                                                                                                         |
| Medium   | Find bar                    | "Replace all" collected one change per match with no ceiling. A pattern that can match nothing — `\d*` instead of `\d+` — has a match at every offset, which on a large file is millions of objects and a dead renderer. It now refuses above 200 000 before anything is changed.                                                                                                                                                      |
| Medium   | Workflows                   | Every action the release job used was a moving tag or a branch, so what built the installer was whatever those repositories said on the day. All of them are pinned to a commit now, in both workflows, with the version in a comment.                                                                                                                                                                                                 |
| Low      | Saving, `uwunotes-fs`       | The temporary file was `.uwunotes-<pid>-0.tmp` — a name anything could work out — and was opened in a way that would take over a file already sitting there, following it if it was a link. The name is now unguessable and the open refuses an existing file outright.                                                                                                                                                                |
| Low      | Find bar                    | A regular expression like `(a+)+b` typed into the find bar ran unbounded on the thread that draws the window: 24 characters is a tenth of a second, 40 is hours, and nothing can interrupt it once it starts. Patterns are now measured against short samples first and refused if they are already slow.                                                                                                                              |
| Low      | Find in files               | Every match on a line was collected before the match budget was consulted, so a line of nothing but the letter being searched for cost megabytes to produce a handful of rows. Collection stops one past the budget.                                                                                                                                                                                                                   |
| Low      | Find in files               | On a line that is not valid UTF-8 the highlight and the click target pointed at the wrong characters, because the offsets were measured before the replacement characters were put in. They are moved with it now.                                                                                                                                                                                                                     |
| Low      | Session, `uwunotes-session` | `session.json` had no size limit and no limit on how many documents it could describe. A hand-written one listing 200 000 tabs parsed fine and then held the start-up screen forever. There is a ceiling on the file and on what it may describe, and drafts are capped at the same 64 MiB as any other file.                                                                                                                          |
| Low      | Themes                      | A theme value only had to satisfy `CSS.supports('color', …)`, which says yes to anything containing `var()` — including `var(--a){`, whose brace swallowed the rest of the stylesheet and left the editor unstyled until the theme was found and deleted. Values carrying CSS punctuation are refused before the browser is asked.                                                                                                     |
| Low      | Font setting                | The font name was stripped of quotes and braces but not of a newline, which ends a CSS string just as surely. Control characters are removed when settings are read, and again where the name is quoted.                                                                                                                                                                                                                               |
| Low      | Git                         | `Command::new("git")` lets Rust resolve the name, and on Windows that search starts in the folder the app runs from — which a per-user install makes writable by anything running as the user. `git` is now looked up on PATH with that folder left out.                                                                                                                                                                               |
| Low      | Workflows                   | The release checkout left a token that can write to the repository in `.git/config`, where every dependency's build script could read it, for no reason: nothing after that step uses git. It is not persisted any more.                                                                                                                                                                                                               |
| Low      | Workflows                   | `packageManager` named a pnpm version without its hash, so the first thing both workflows did was download and run a tarball they could not check. The hash is in `package.json` now; corepack refuses a tarball that does not match.                                                                                                                                                                                                  |

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

## Accepted, for now

- **A repository with LFS loses its gutter marks.** The check that keeps a
  hostile `.git/config` from running programs cannot tell a locally installed
  Git LFS from anything else, because git has no way to turn a clean filter off
  for one command. Somebody with LFS set up in a repository gets no status
  letters and no gutter marks there, and `UWUNOTES_LOG=warn` says why.
  Decoration is worth less than not running strangers' programs.
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
path to the shell. The only way out of the app is a check that allows `http`,
`https` and `mailto` and nothing else, which survived every spelling tried. No
command is registered that the page never calls. Nothing builds a command line
an argument could be injected into, the console is hidden everywhere a process
is spawned, and the git polling cannot pile up.

**The page.** No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, no
`new Function`. A search result's preview reaches the DOM as text, so a file
containing markup renders as characters. There is no outbound channel: nothing
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
workflow uses `pull_request_target`, neither references a secret, and permissions
are read-only everywhere except the one job that publishes. The release build
restores no cache, so a malicious pull request cannot poison what it compiles,
and the artifact glob can only match what the build just produced. Dependency
installs cannot run arbitrary scripts: one package is allowed to build and the
lockfiles resolve everything from the default registry. DLLs load from System32
only, in the app and at link time, because the app runs from a folder the user
can write to. Release builds ship no source maps. The installer runs nothing of
the project's own and touches no world-writable location. Nothing in the
repository or its history is a secret that should not be there.
