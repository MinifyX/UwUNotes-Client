# Mac App Store

UwUNotes ships on the Mac in two forms. The **DMG** from GitHub releases is
what it has always been: not sandboxed, updates itself, shows git status. The
**Mac App Store build** is the same editor with the store's rules applied.
This document is how that second one is built and how to publish it. None of
it has been through App Review yet.

## What is different in the store build

|                      | DMG (GitHub)                                   | Mac App Store                                                            |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------ |
| Cargo features       | default (`self-update`)                        | `--no-default-features --features mas`                                   |
| Config               | `tauri.conf.json` (+ `tauri.macos.conf.json`)  | + `tauri.mas.conf.json`                                                  |
| Updates              | updater plugin, GitHub feed                    | none compiled in; the store updates it                                   |
| `update_channel`     | `"github"`                                     | `"app-store"`                                                            |
| Sandbox              | no                                             | yes, `macos/Entitlements.mas.plist`                                      |
| Git letters in tree  | yes, runs `git` from the PATH                  | off: a sandboxed app cannot run Apple's `/usr/bin/git` (`xcrun` refuses) |
| Delete to Trash      | through Finder (`osascript`), "Put Back" works | through `NSFileManager`, no "Put Back"                                   |
| Last session's files | reopened by path                               | reopened through security-scoped bookmarks (`sandbox_access.rs`)         |
| Network              | GitHub, for the update check                   | none (links open in the browser, which needs no entitlement)             |

The page asks `updatesAvailableInApp()` from `lib/updates.ts` before it shows
anything about updates, and both checks there refuse quietly in a store build.

## Building

On a Mac with Xcode and both Rust targets
(`rustup target add aarch64-apple-darwin x86_64-apple-darwin`):

```sh
pnpm build:mas
```

That builds a universal app (Apple Silicon and Intel), checks it — both
architectures, bundle ID, category, encryption flag, privacy manifest, no
update feed left in the executable — and packs it with `productbuild` into
`target/release/UwUNotes-<version>-mas-universal.pkg`. Without signing
identities in the environment the app and the package stay unsigned; that is
what CI does on every pull request touching the store build.

The version: App Store Connect takes only three numbers, so `0.6.0-beta.1` is
uploaded as `0.6.0`. `MAS_BUILD_NUMBER` becomes `CFBundleVersion` and has to
grow with every upload of the same version (CI uses the run number).

Signing reads these from the environment (the identities must be in a keychain
`codesign` can use):

| Variable                         | What                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `APPLE_MAS_APP_IDENTITY`         | `3rd Party Mac Developer Application: <Name> (<TEAMID>)` or `Apple Distribution: …`   |
| `APPLE_MAS_INSTALLER_IDENTITY`   | `3rd Party Mac Developer Installer: <Name> (<TEAMID>)`                                |
| `APPLE_TEAM_ID`                  | the ten-character team ID                                                             |
| `APPLE_MAS_PROVISIONING_PROFILE` | path to the Mac App Store provisioning profile → `Contents/embedded.provisionprofile` |
| `MAS_BUILD_NUMBER`               | build number, required for a signed build                                             |

The team ID goes into the entitlements only at signing time
(`com.apple.application-identifier`, `com.apple.developer.team-identifier`), so
nothing team-specific is committed.

### CI

`.github/workflows/mas.yml` runs on tags (beside `release.yml`, not inside it),
by hand, and on pull requests that touch the store build. `build` makes the
unsigned app and package. `sign` runs only when these repository secrets exist,
on a fresh runner that has built nothing:

| Secret                            | Content                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `APPLE_MAS_CERTIFICATES_P12`      | base64 of one .p12 with both certificates (application and installer) and their keys |
| `APPLE_MAS_CERTIFICATES_PASSWORD` | its password                                                                         |
| `APPLE_MAS_PROVISIONING_PROFILE`  | base64 of the `.provisionprofile`                                                    |
| `APPLE_MAS_APP_IDENTITY`          | as above                                                                             |
| `APPLE_MAS_INSTALLER_IDENTITY`    | as above                                                                             |
| `APPLE_TEAM_ID`                   | as above                                                                             |

The signed package is the run's `mas-signed` artifact. Uploading stays a manual
step (below), on purpose: a build reaches review because somebody sent it.

## Publishing, step by step

1. **Apple Developer Program** membership (99 USD/year) at
   developer.apple.com, as an individual or as MinifyX (an organisation needs
   a D-U-N-S number). The seller name shown in the store comes from this.
2. **App ID**: Certificates, Identifiers & Profiles → Identifiers → `+` → App
   IDs → App, platform macOS, explicit bundle ID `app.uwunotes.desktop`. No
   capabilities need ticking: sandbox entitlements need no App ID capability.
3. **Certificates** (Certificates → `+`), each from a certificate signing
   request made in Keychain Access:
   - _Mac App Distribution_ (signs the app; shows up as "3rd Party Mac
     Developer Application" or "Apple Distribution"),
   - _Mac Installer Distribution_ (signs the package; "3rd Party Mac Developer
     Installer").
     Export both with their private keys from Keychain Access into one .p12 for CI.
4. **Provisioning profile**: Profiles → `+` → Distribution → _Mac App Store
   Connect_, App ID `app.uwunotes.desktop`, the distribution certificate.
   Download the `.provisionprofile`.
5. **App Store Connect record**: appstoreconnect.apple.com → Apps → `+` → New
   App: platform macOS, name "UwUNotes" (must be free in the store), primary
   language, bundle ID `app.uwunotes.desktop`, SKU e.g. `uwunotes-mac`.
6. **App information**: category _Developer Tools_ (secondary: _Productivity_),
   content rights (no third-party content), age rating questionnaire — every
   answer "None"/"No", which gives **4+**. Pricing: free.
7. **App Privacy** (the nutrition label): privacy policy URL (required even
   for "no data"; the GitHub README section or a page on the website), then
   "Do you or your third-party partners collect data from this app?" → **No**
   → label reads **Data Not Collected**. Matches `macos/PrivacyInfo.xcprivacy`.
8. **Screenshots**: at least one, 16:10, in one of 1280×800, 1440×900,
   2560×1600 or 2880×1800 (PNG or JPEG, no transparency, up to ten). Light and
   dark editor windows with a project open, Markdown preview, Zeitreise, Nyu.
9. **Version page**: description, keywords (100 characters), support URL
   (GitHub issues), marketing URL, copyright "© 2026 MinifyX", "What's New".
10. **Export compliance**: answered by `ITSAppUsesNonExemptEncryption = false`
    in the Info.plist — the app uses no encryption beyond what macOS does for
    it — so App Store Connect does not ask per build.
11. **Build and upload**: run the `Mac App Store` workflow (or `pnpm build:mas`
    with the variables above), then upload the signed `.pkg` with
    **Transporter** (Mac App Store, drag the file in) or on the command line:
    ```sh
    xcrun altool --upload-app --type macos \
      --file UwUNotes-0.6.0-mas-universal.pkg \
      --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>
    ```
    (API key from App Store Connect → Users and Access → Integrations →
    App Store Connect API, placed in `~/.appstoreconnect/private_keys/`.)
    Processing takes 10–60 minutes; Apple mails problems with the binary.
12. **TestFlight for Mac** (optional, recommended): install the processed
    build through TestFlight and go through the checks in "Before the first
    review" below on a real Mac.
13. **Submit for review** with the review notes below.

### Review notes (paste into "Notes" for App Review)

> UwUNotes is a text and code editor. It needs no account and has no in-app
> purchases. Open files with File → Open, File → Open Folder, drag and drop, or
> Finder's "Open With". Because of the App Sandbox, the Mac App Store version
> differs from our GitHub version: it has no self-updater, shows no git status
> (it does not run external programs), and remembers opened files and folders
> across restarts through security-scoped bookmarks. Deleting a file from the
> sidebar moves it to the Trash.

## Sandbox limitations to know about

- Only what the user chose is reachable: files from the open/save panels,
  dropped files, folders opened as a project, files from "Open With". A file
  next to one of them is not, unless its folder was opened.
- **Saving** writes atomically through a temporary file in the same folder. For
  a single file the user opened (not its folder) the sandbox refuses that
  temporary file, and `uwunotes-fs` falls back to writing the file directly —
  the save works, but is not crash-atomic there. Opening the folder instead
  avoids it.
- **Recent sessions** survive restarts through `bookmarks.json` next to the
  session (at most 256 entries, oldest dropped). A file that was deleted, moved
  to a volume that is not mounted, or replaced, loses its bookmark; its tab
  then reports it missing.
- **No git**: the tree and the gutter show no git marks.
- **No "Put Back"** in Finder for files deleted from the tree.
- The **session, drafts, Zeitreise and settings** live in the sandbox container
  (`~/Library/Containers/app.uwunotes.desktop/Data/Library/Application
Support/app.uwunotes.desktop`), not where the DMG keeps them. Moving from one
  build to the other does not carry them over.
- If the window comes up **blank** in the sandbox, the first thing to try is
  adding `com.apple.security.network.client` to the entitlements: some WebKit
  versions want it even for the app's own pages. It is left out because
  nothing needed it in the design; it would have to be justified to review.

## App Review Guidelines, point by point

| Guideline                                                  | How UwUNotes meets it                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 2.4.5(i) sandboxed, correct entitlements                   | `com.apple.security.app-sandbox`; only user-selected files, app-scope bookmarks and printing.                    |
| 2.4.5(ii) packaged and submitted with Xcode tools          | `productbuild` package, signed with the installer certificate, uploaded with Transporter or `altool`.            |
| 2.4.5(iii) self-contained bundle, no installing other code | One executable, no frameworks, no helpers; the frontend is inside the binary. It downloads nothing.              |
| 2.4.5(iv) no auto-launch / login items without consent     | It registers no login item, launch agent or daemon.                                                              |
| 2.4.5(v) no installing or running other code / scripts     | No git, no `osascript`, no shell. Links open in the default browser via `NSWorkspace`.                           |
| 2.4.5(vi) updates only through the Mac App Store           | Updater plugin and update UI are not compiled in (`self-update` feature off); `update_channel` says `app-store`. |
| 2.4.5(vii) runs on the current macOS                       | Universal binary, minimum macOS 11.                                                                              |
| 2.4.5(viii) no license screens / own activation            | None; GPL-3.0 text is linked from About, nothing to accept.                                                      |
| 2.4.5(ix) no unrelated permissions                         | No camera, microphone, contacts, location, network.                                                              |
| 2.1 completeness, 2.3 accurate metadata                    | Same editor as on GitHub; screenshots from this build, not the DMG (no git marks visible).                       |
| 4.0 design, 4.2 minimum functionality                      | A full editor: tabs, splits, find in files, Markdown preview, version history.                                   |
| 4.1 copycats, 5.2 intellectual property                    | Own name, own artwork (Nyu), own code under GPL-3.0.                                                             |
| 5.1.1 privacy policy, 5.1.2 data use                       | Privacy policy URL in App Store Connect; nothing is collected (`PrivacyInfo.xcprivacy`).                         |
| 5.2.1 / GPL                                                | MinifyX owns the copyright and may distribute through the store; the source stays public on GitHub.              |

## Before the first review (needs a Mac)

Nothing below could be tried while this was written, because no Mac was at
hand. On a real Mac, with a TestFlight or a locally signed build:

- the window comes up (see the network-entitlement note above);
- open a folder and a single file, quit, start again: both come back
  (`bookmarks.json` in the container has entries);
- "Open With → UwUNotes" on a `.md`, `.txt`, `.rs` file, cold and while running;
- save a single opened file (the direct-write fallback), Save As, delete to
  Trash, print;
- no update button anywhere, no update check in Console;
- the Dock icon at the size of its neighbours.
