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
`pnpm tauri build` on a Windows runner, and creates the release with the `en` notes as its body and both
installers — the NSIS `-setup.exe` and the `.msi` — attached. A tag with a suffix, `v0.1.0-beta.1`, is
marked as a pre-release; a plain one is not.

Nothing is built on my own machine, so nothing depends on what happens to be installed there this month.

## Not yet: signed updates

UwUNotes does not update itself. The updater plugin is not wired up and nothing is signed, and that is
deliberate. UwUSSH signs every update with a minisign key that lives on my machine; UwUNotes has no such
key, and half an updater is worse than none — the first build that ships one decides, for every copy
people install, what it will accept from then on.

When there is something worth updating to:

```bash
pnpm tauri signer generate -w uwunotes-update.key
```

The public half goes into `tauri.conf.json`, next to the updater endpoints. The private half never goes
into this repository — not as a file, not in a workflow, not in a comment. It belongs on my machine and,
for the release workflow, in the repository's secrets as `TAURI_SIGNING_PRIVATE_KEY`. Lose it and every
installed copy stops taking updates for good, so it gets a backup somewhere that is not this computer.

The installers are not code-signed either, which is why Windows greets the setup with SmartScreen. That
takes a certificate, and certificates cost money.
