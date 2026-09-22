# Release notes

One file per version, named after it: `0.1.0.json`, `0.1.0-beta.1.json`. The release workflow refuses
to build without it. The `en` text becomes the body of the GitHub release page; `de` is the same text
in German, waiting for the day something in the app shows it.

```json
{
  "de": "- Kurze, verständliche Punkte\n- Was Leute merken, nicht wie es gebaut ist",
  "en": "- Short, plain points\n- What people notice, not how it's built"
}
```

Markdown works in both. A first line with a blank line under it reads as a headline.

## Releasing a version

1. One version everywhere: `Cargo.toml` (under `workspace.package`),
   `apps/desktop/src-tauri/tauri.conf.json`, `apps/setup/src-tauri/tauri.conf.json`, and the
   `package.json` files — the root one, `apps/desktop`, `apps/setup` and `packages/uwu-tokens`.
   The setup says a version out loud in three places nobody else does: its window, Windows' list of
   installed apps, and the file name its update is signed under.
2. Add `release-notes/<version>.json`, with a non-empty `en`.
3. Commit.
4. Tag and push the tag: `git tag v0.3.0 && git push origin v0.3.0`.

That is the whole manual part. `.github/workflows/release.yml` takes it from there:

- **Minute zero, before anything compiles.** The tag is compared against _both_ `tauri.conf.json`
  files and the notes are read; a mismatch or a missing `en` stops the job there rather than after
  twelve minutes of compiling. `pnpm build:setup` refuses the same mismatch locally.
- **The builds, unsigned.** `pnpm build:setup` on Windows x64 and on `windows-11-arm`
  (`UwUNotes-Setup-<version>.exe`, `…-windows-arm64.exe`) and on the Apple Silicon Mac, once, as a
  universal build (`…-macos-universal.dmg`). On Ubuntu 22.04 x64 and arm64,
  `scripts/build-linux-packages.mjs` makes the `.deb`, the `.rpm` and the portable folder, and the
  x64 runner also builds the old per-user setup (`…-linux-x86_64.tar.gz`) that copies installed by
  0.4.x update from. The Windows jobs check the setup's processor, the Linux jobs install the `.deb`
  and look into the `.rpm` and the portable folder. None of these jobs has a secret or a token that
  can write: they run `pnpm install` and a few hundred build scripts, and hand their files on as
  artifacts.
- **The signatures.** A `sign` job that builds nothing and installs nothing but Tauri's CLI, with
  install scripts off, signs every file an installed copy may download, under the versioned name
  that copy expects in the signature (`scripts/release-files.mjs stage`; the Mac image twice, once
  per name the two kinds of Mac look for). It is the only job that ever sees the key, and it fails if
  a `.sig` is missing — an unset secret otherwise looks exactly like a signer that did not sign.
- **The release.** The files under their stable names (`UwUNotes-windows-x64-setup.exe`, …; the
  table is `scripts/release-files.mjs`), `SHA256SUMS.txt` over all of them, written with LF endings
  so `sha256sum -c` can read it, and the `en` notes with a generated Downloads section under them as
  the body. No `.sig` files: the feed carries the signatures. A tag with a suffix, `v0.3.0-beta.1`,
  is marked as a pre-release. A manual run of the workflow stops before this, so the builds can be
  tried from a branch.
- **The feed.** Only once the release exists with its files on it, and never for a pre-release —
  which is said in a `::notice::` rather than skipped in silence.
- **The AUR, last.** `scripts/aur.mjs` writes `PKGBUILD` and `.SRCINFO` for `uwunotes-bin` from the
  published `SHA256SUMS.txt` and pushes them to the AUR with the `AUR_SSH_PRIVATE_KEY` secret —
  pre-releases included. Without that secret the job says so in a notice and succeeds.

Nothing is built on my own machine, so nothing depends on what happens to be installed there this month.

Locally, to see what a release would produce without making one:

```bash
pnpm build:setup                    # the setup; says so when it is unsigned
node scripts/update-feed.mjs v0.3.0 # prints the feed it would publish, writes nothing
```

## The signing key

The key exists. Its public half sits in `tauri.conf.json` next to the updater endpoint, and that half
belongs in the repository. The private half and its password are repository secrets,
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, handed to the one step in the
`sign` job that runs `tauri signer sign`, on a runner that has built nothing, and to no other. A local
`pnpm build:setup` with the key set still signs: the script takes both back out of the environment
before it starts a build and checks they are gone, so the build scripts in the dependency graph never
see them. Neither ever goes into this repository — not as a file, not
in a workflow, not in a comment — and no step ever echoes one into a log.

Losing the private key is the one mistake here that cannot be repaired. The public key is baked into
every installed copy, and a copy out there accepts an update signed with that key and nothing else. A
new key reaches nobody: everyone who already has UwUNotes would have to hear about it some other way
and install by hand. So it gets a backup somewhere that is not this computer.

## The update feed

`latest.json` on `updates`, an orphan branch that carries the feed and nothing else:

```text
https://raw.githubusercontent.com/MinifyX/UwUNotes-Client/updates/latest.json
```

The release workflow builds it with `scripts/update-feed.mjs` and pushes it once the release exists
with its files attached. That order matters: a feed naming a file that is not uploaded yet is not a
delay, it is a failed update on someone's machine, retried until the next release. A pre-release never
reaches the feed — betas are for the people who went looking for them, and the feed is what everyone
else follows.

The same script reads a finished build and says what a release would publish. It looks in
`target/release` (or `--dir`) for each file under the versioned name it is signed as and wants a
`.sig` beside it, so the local `pnpm build:setup` has to have had the key and its password in the
environment. Windows x64 is always required; the rest go in when they are there and signed, and the
workflow passes `--require-all`. Each entry's URL is the stable asset name, its signature the one
made under the versioned name — the name installed copies check for, which is why the two can
differ (`scripts/release-files.mjs` explains). Windows and the `.deb`/`.rpm` install an update by
themselves — the others are in the feed so an installed copy there hears about a new version at all.

It prints the feed and writes nothing. It refuses when the signature does not match the setup or was
made with a key installed copies do not trust, and it checks the file name inside the signature's
trusted comment — which is what catches a `.sig` an earlier build left in `target/`. In the workflow it
also asks GitHub whether the file it names is really attached to the release.

The installers are still not code-signed for Windows itself, which is why the setup is greeted with
SmartScreen. That takes a certificate, and certificates cost money. It has nothing to do with the
updater key: one is Windows deciding whether to run the file at all, the other is UwUNotes deciding
whether an update really came from here.
