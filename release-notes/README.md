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

1. Set the version in `Cargo.toml` (under `workspace.package`),
   `apps/desktop/src-tauri/tauri.conf.json`, and the `package.json` files — the root one,
   `apps/desktop` and `packages/uwu-tokens`.
2. Add `release-notes/<version>.json`.
3. Commit.
4. Tag and push the tag: `git tag v0.1.0 && git push origin v0.1.0`.

That is the whole manual part. `.github/workflows/release.yml` takes it from there: it compares the tag
against the version in `tauri.conf.json` and stops if the two disagree, builds the frontend, runs
`pnpm tauri build` on a Windows runner with the signing key from the repository secrets, and stops
again if that build produced no signature. Then it creates the release with the `en` notes as its body
and the NSIS `-setup.exe`, its `.sig`, the `.msi` and `SHA256SUMS.txt` attached, and last of all
publishes the update feed. A tag with a suffix, `v0.1.0-beta.1`, is marked as a pre-release; a plain
one is not, and only a plain one reaches the feed.

Nothing is built on my own machine, so nothing depends on what happens to be installed there this month.

## The signing key

The key exists. Its public half sits in `tauri.conf.json` next to the updater endpoint, and that half
belongs in the repository. The private half and its password are repository secrets,
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, handed to the one step that
builds the installers and to no other. Neither ever goes into this repository — not as a file, not in a
workflow, not in a comment — and no step ever echoes one into a log.

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

The same script reads a finished build and says what a release would publish. It wants the `.sig`, so
the local `pnpm tauri build` has to have had the key and its password in the environment:

```bash
node scripts/update-feed.mjs v0.2.0
```

It prints the feed and writes nothing. It refuses when the signature does not match the setup or was
made with a key installed copies do not trust; in the workflow it also asks GitHub whether the file it
names is really attached to the release.

The installers are still not code-signed for Windows itself, which is why the setup is greeted with
SmartScreen. That takes a certificate, and certificates cost money. It has nothing to do with the
updater key: one is Windows deciding whether to run the file at all, the other is UwUNotes deciding
whether an update really came from here.
