# Installing UwUNotes

[Deutsch weiter unten](#uwunotes-installieren)

Two ways in. The setup from the releases page is a download, a warning from
Windows that is explained below before you see it rather than after, and a
double-click. [Building it yourself](#4-building-it-yourself) is a clone, two
commands and a first run in which Rust compiles for a while, and it gets you the
state of the repository rather than what a release froze.

From 0.2.0 on, an installed UwUNotes says so when there is a newer version.
0.1.0 does not and never will — see [Updates](#updates).

## What you need

- **Windows 10 or 11, 64-bit**, x64 or ARM64. x64 is the platform I develop on
  and the one I test most; the ARM64 setup is built by every release and tried
  far less.
  **Microsoft Edge WebView2** comes with it: Windows 11 always has it, Windows
  10 usually. If it is missing, the setup offers to fetch it.
- **macOS**, on Apple Silicon or Intel — see [macOS](#macos). Built by every
  release, tried far less than Windows.
- **Linux, x86_64 or arm64**, with **WebKitGTK 4.1** — see [Linux](#linux).
  Built by every release, tried far less than Windows.

On Windows and macOS it is UwUNotes' own setup, the same window with Nyu in it.
On Linux it is a package for your distribution or a portable folder, and the
section below says which is which.

UwUNotes speaks German and English, following the system.
**Settings → Appearance → Language** switches.

## 1. From a release

Releases are on the
[releases page](https://github.com/MinifyX/UwUNotes-Client/releases). Take the
newest one at the top and download, under **Assets**, the one file for your
system:

| System                          | File                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| Windows (x64)                   | `UwUNotes-windows-x64-setup.exe`                           |
| Windows on ARM                  | `UwUNotes-windows-arm64-setup.exe`                         |
| macOS (Intel and Apple Silicon) | `UwUNotes-macos-universal.dmg`                             |
| Ubuntu, Debian, Mint            | `UwUNotes-linux-x64.deb` (ARM: `UwUNotes-linux-arm64.deb`) |
| Fedora, openSUSE                | `UwUNotes-linux-x64.rpm` (ARM: `UwUNotes-linux-arm64.rpm`) |
| Arch, Manjaro                   | from the AUR: `yay -S uwunotes-bin`                        |
| Any Linux, nothing installed    | `UwUNotes-linux-x64-portable.tar.gz` (ARM: `…-arm64-…`)    |

The names carry no version, so
`https://github.com/MinifyX/UwUNotes-Client/releases/latest/download/<file>` is
always the newest one; the version is in the release's title. The Windows setups
are also what an installed copy fetches when it updates itself, and so are the
`.deb` and the `.rpm`.

`UwUNotes-update-linux-x64.tar.gz` is not for you: it is what copies installed
by the Linux setup of 0.4.x update from (see [Linux](#linux)).

`SHA256SUMS.txt` lists all of them, if you want to check that what you have is
what was built: `Get-FileHash .\UwUNotes-windows-x64-setup.exe` in PowerShell, or
`shasum -a 256 -c SHA256SUMS.txt --ignore-missing` on a Mac and
`sha256sum -c SHA256SUMS.txt --ignore-missing` on Linux, next to the download.
It is published by the same workflow that built the file, so it cannot tell you
the build was honest — only that nothing happened to the file since.

Your browser may say the file is "not commonly downloaded" — which is true, and
which it says about every file nobody has downloaded yet. Keep it anyway (in
Edge: `…` → **Keep** → **Show more** → **Keep anyway**).

## 2. The warning Windows will show you

Double-click the setup and Windows will most likely put up **"Windows protected
your PC"**. Click **More info**, then **Run anyway**.

That box is not about what is in the file. It appears because the setup is not
signed with a paid code-signing certificate: a certificate costs a few hundred
euros a year, this is a hobby project with no income, and SmartScreen trusts
what it has seen often enough or what has been paid for. An antivirus program
that blocks the setup is saying the same thing in a louder voice.

What you can do instead of trusting me: every line of this is in the repository,
and a release is built from it.

The signature the updater uses is a different thing and does not help here. That
one is UwUNotes deciding whether an update really came from this project; this
box is Windows deciding whether to run a program at all, and nothing but a paid
certificate makes it go away.

## 3. What the setup does

A small dark window with Nyu in it, German or English depending on what Windows
is set to. It asks about two things:

- **Folder.** `%LOCALAPPDATA%\Programs\UwUNotes` unless you type something else.
  Everything goes under your own user account — no administrator, no UAC prompt,
  nothing outside your profile.
- **Shortcut on the desktop.** Off on a machine that has never had UwUNotes;
  after that it starts wherever you last left it. The Start menu gets one either
  way, and unticking the box on a later run takes the desktop one away again.

Then it writes `UwUNotes.exe`, puts `uninstall.exe` beside it — the same program
under a second name — and registers the editor under `HKEY_CURRENT_USER`, which
is what makes it appear in Windows' list of installed apps. Nothing is
downloaded while it installs: the editor is packed inside the setup file, which
is most of why that file is as big as it is.

If WebView2 is missing, the setup offers to fetch it from Microsoft before
anything else. That is the only thing it ever downloads, and only on a machine
that does not already have it.

**An older installation is taken over.** 0.1.0 and 0.2.0 came from Tauri's stock
installer, which called the editor `uwunotes-desktop.exe` and put it in
`%LOCALAPPDATA%\UwUNotes`. The setup finds that, installs into `Programs`
instead, and clears away the old executable and the entries describing it. Your
session, drafts and settings live somewhere else entirely and are not touched.

**UwUNotes has to be closed.** An installer that closes a text editor with
unsaved text in it is a way to lose text, so the setup says "UwUNotes is still
open" and waits for you to decide rather than deciding for you. The one
exception is the editor updating itself, where it has already written everything
to disk and closed itself before the setup starts.

## macOS

**One disk image for every Mac.** `UwUNotes-macos-universal.dmg` carries the
editor for Apple Silicon and for Intel, and each Mac runs its own half. (0.4.x
had one image per processor; this one installs over either.)

**The first start.** Open the disk image and double-click **UwUNotes Setup**.
macOS will most likely refuse with "cannot be opened because the developer
cannot be verified" or "Apple could not verify…". That is Gatekeeper, and it is
the Mac's version of the SmartScreen box above: the setup is not signed with an
Apple Developer ID or notarised by Apple, which costs a yearly fee this project
does not pay. Nothing is wrong with the file for that reason. Either way works:

- **Control-click** (or right-click) **UwUNotes Setup** → **Open** → **Open**.
  On macOS 15 and later that button is gone from the first dialog: try to open
  it once, then **System Settings → Privacy & Security**, scroll down to
  "UwUNotes Setup was blocked", **Open Anyway**.
- Or, in Terminal, take the quarantine mark off the copy you downloaded and
  open it normally:
  `xattr -dr com.apple.quarantine "/Volumes/UwUNotes Setup/UwUNotes Setup.app"`
  (or on the `.dmg` itself before you open it).

You are asked once, for the setup. The editor it installs is written by the
setup rather than downloaded, so macOS asks nothing more about it.

**What it does.** The same window as on Windows, and the same one question —
the folder is not asked, because a Mac app belongs in an Applications folder:

- `~/Applications/UwUNotes.app` — the Applications folder of your own user,
  which is made if it is not there. No administrator password. Launchpad,
  Spotlight and Finder all find it there.
- **Alias on the desktop**, if ticked.
- `~/Library/Application Support/app.uwunotes.setup/`: which version was
  installed, and a copy of the setup as `uninstall`.

UwUNotes has to be quit (⌘Q, not just the window closed) for the setup to
replace it.

**Removing it.** Drag `UwUNotes.app` to the Bin, like any Mac app — that leaves
your session and settings behind. Or run the uninstaller, which asks the usual
question about them:

```bash
"$HOME/Library/Application Support/app.uwunotes.setup/uninstall" --uninstall
```

**Updates.** An installed copy tells you about a newer version like everywhere
else, but does not install it itself: download the new disk image and run the
setup over the old installation. Session, settings and drafts stay.

## Linux

x86_64 or arm64, Ubuntu 22.04, Debian 12, Fedora 36 or anything newer. Three
ways, pick one:

**A package for your distribution** — the usual choice. It installs system-wide
to `/usr` (`/usr/bin/uwunotes`, an entry in the applications menu) and brings
WebKitGTK 4.1, the browser engine the editor draws in, as a dependency:

```bash
sudo apt install ./UwUNotes-linux-x64.deb      # Debian, Ubuntu, Mint
sudo dnf install ./UwUNotes-linux-x64.rpm      # Fedora
sudo zypper install ./UwUNotes-linux-x64.rpm   # openSUSE
yay -S uwunotes-bin                            # Arch, Manjaro (AUR)
```

(`-arm64` instead of `-x64` on an ARM machine.) The `.deb` and the `.rpm`
**update themselves**: **Install and restart** downloads the new package, checks
its signature, and hands it to `dpkg` or `rpm` through `pkexec`, which asks for
your password; then UwUNotes restarts. The AUR package is updated by pacman like
everything else from the AUR — the editor only tells you there is a new version.
Removing it is your package manager's job too: `sudo apt remove uwunotes`,
`sudo dnf remove uwunotes`, `sudo pacman -R uwunotes-bin`.

**The portable folder** — nothing installed, nothing needs root. Unpack it
anywhere and start it from there:

```bash
tar -xzf UwUNotes-linux-x64-portable.tar.gz
./UwUNotes/uwunotes
```

It brings its own libraries except WebKitGTK and the graphics stack, which your
system has to have (`libwebkit2gtk-4.1-0`, `webkit2gtk4.1` or `webkit2gtk-4.1`,
depending on the distribution). It does not update itself: it tells you about a
new version, and then you unpack the new archive over it.

**The per-user setup of 0.4.x.** 0.4.0 and 0.4.1 came as a setup in a tar.gz
that installed into your home folder. That setup is no longer offered as a
download; copies it installed keep telling you about new versions and are
updated from `UwUNotes-update-linux-x64.tar.gz` on the release page — unpack it
and run the one file inside, exactly as before. Or move to the package: remove
the old copy (below) and install the `.deb` or `.rpm`; session, settings and
drafts stay where they are. For the record, what that setup does — the same
window and the same question as everywhere, the folder shown, not asked:

- `~/.local/share/uwunotes/uwunotes` — the editor (`$XDG_DATA_HOME` if you set
  one), and `uninstall` beside it, which is the setup again.
- `~/.local/share/applications/app.uwunotes.desktop` — the entry in your
  applications menu, which also offers UwUNotes for text files under
  **Open With**.
- The icon, under `~/.local/share/icons/hicolor/`.
- `~/.local/bin/uwunotes`, a link to the editor, so `uwunotes` works in a
  terminal where `~/.local/bin` is on the `PATH` — unless something else of
  yours already has that name, which is then left alone.
- A launcher on the desktop, if ticked and if your desktop has a desktop folder.

Everything is written whole or not at all, with plain permissions (0755 for the
programs, 0644 for the rest), and the setup refuses to write through a link it
did not make itself.

**Removing it.** Right-click UwUNotes in the applications menu or the dock →
**Uninstall UwUNotes**, or:

```bash
~/.local/share/uwunotes/uninstall --uninstall
```

It asks the usual question, and removes exactly the files listed above — each
only while it is still what the setup put there.

**Updates.** A copy the setup installed tells you about a newer version like
everywhere else, but does not install it itself: download
`UwUNotes-update-linux-x64.tar.gz` and run the setup in it. Session, settings
and drafts stay.

## 4. Building it yourself

This is how you get the current state of the repository rather than whatever a
release froze.

You need:

- **Node.js 22 or newer** and **pnpm 11** (`corepack enable`)
- **Rust stable**, via [rustup](https://rustup.rs)
- The platform prerequisites for Tauri —
  [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/). On
  Windows that is the Visual Studio C++ Build Tools and WebView2.

```bash
git clone https://github.com/MinifyX/UwUNotes-Client
cd UwUNotes-Client
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts the app with the UI reloading as you edit it. The first
run compiles the Rust side and takes a while; every run after that does not.

For something you can keep:

```bash
pnpm build:setup
```

That builds the editor, packs it into the setup, and leaves the setup for the
system you are on in `target/release` in the repository root:
`UwUNotes-Setup-<version>.exe` (`…-windows-arm64.exe` on ARM),
`…-macos-universal.dmg` (with both Rust targets installed:
`rustup target add aarch64-apple-darwin x86_64-apple-darwin`), or
`…-linux-x86_64.tar.gz`. The Linux packages and the portable folder come from
`node scripts/build-linux-packages.mjs`, into the same folder.
On Linux, install the `-dev` packages Tauri's prerequisites list first. Without the
project's signing key in the environment it says so and writes no `.sig`, which
changes nothing about installing it — that signature is only what an _installed_
copy checks before it updates itself. Windows greets your own build exactly as
described above, which is a decent way to see that warning once in a context
where you know precisely where the file came from.

A bare `pnpm tauri build` is a different thing: Tauri's own bundles of the
editor, and it stops without the signing key, because the config has updater
artifacts switched on. `scripts/build-linux-packages.mjs` turns them off for the
one build that makes the `.deb` and the `.rpm`.

## Updates

**From 0.2.0 on, UwUNotes notices a newer version by itself.** About fifteen
seconds after the window opens — once, and not again in that run — it asks
GitHub whether there is one. If there is, a strip appears above the status bar
with the version, the release notes if you unfold them, **Later**, and
**Install and restart**. Never a dialog over your text. If there is nothing
newer, you hear nothing. If no answer arrives at all — no network, the file not
there — you hear nothing either, and the reason goes into the log rather than
into your way.

**0.1.0 has no updater and will never offer you 0.2.0.** It was built before any
of this existed, so nothing in it can tell you anything. Download the setup by
hand one more time and run it over your installation; from that one on the
editor does the looking.

On a Mac, in the portable Linux folder, in a copy the old Linux setup installed
and in the AUR package the strip says the same but has no **Install and
restart**: what those download is a disk image or an archive, not a program the
editor can run, or something pacman looks after. The new version is a download
from the releases page, as described under [macOS](#macos) and [Linux](#linux).
The `.deb` and the `.rpm` do install it: the package goes to `dpkg` or `rpm`
through `pkexec`, and the editor restarts into the new version — but only when
`dpkg` or `rpm` really lists the editor as theirs.

On Windows, **Install and restart** downloads the setup, checks it, and hands over: the
editor writes the session and every unsaved buffer to disk, starts the setup
with its own process id to wait for, and closes. The setup waits for Windows to
let go of the file, replaces it and starts the editor again. No window appears
for any of that — the only thing you would ever see is a message box, and only
if the update did not happen. The tabs come back the way you left them.

**It will not walk you backwards.** Before an update replaces anything, the
setup compares the version it carries with the one installed, and stops if it is
the older of the two. It stops as well when it cannot read which version is
installed, because an update is the one case where nobody is watching. Running a
setup by hand is a person deciding, and there an older version is offered with a
button that says exactly that.

### What the signature means, and what it does not

Every setup and package a release publishes is signed with the project's own key, and the
public half of that key is built into the app. Before an update is installed the
app checks the file it downloaded against that key and refuses anything the key
did not sign — a file swapped somewhere on the way, or a feed pointing at
somebody else's program, never runs. It checks twice, in fact: once when the
bytes arrive and once on what is lying in the folder a moment later, immediately
before the setup is started.

That is the whole of what it claims: this file came from this project and
arrived unchanged. It is **not** the Windows code-signing certificate from the
section above. SmartScreen still warns — about the setup you download by hand
and about the one the updater fetches — and the project's key does nothing about
that.

### What it asks, and where

One address, a small JSON file on a branch of this repository:

```text
https://raw.githubusercontent.com/MinifyX/UwUNotes-Client/updates/latest.json
```

It is a plain request for that file. Nothing about you, your files or your
installation travels with it; GitHub sees a request for a public file the way it
sees any other, which is to say it sees that somebody asked. Pre-releases are
deliberately never written there, so a beta never arrives on its own — those
come off the releases page or not at all.

A newer setup can still be run straight over an installed UwUNotes by hand, and
the session, the settings and the macros stay where they are either way.

## Where your data lives

| What                                        | Where                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| Open tabs, splits, carets, the recent lists | `%APPDATA%\app.uwunotes.desktop\session.json`                             |
| Unsaved text, one file per buffer           | `%APPDATA%\app.uwunotes.desktop\drafts\`                                  |
| Settings, your own themes, saved macros     | The webview's local storage, under `%LOCALAPPDATA%\app.uwunotes.desktop\` |

On a Mac the same folder is `~/Library/Application Support/app.uwunotes.desktop`
(the settings under `~/Library/WebKit/app.uwunotes.desktop`); on Linux it is
`~/.local/share/app.uwunotes.desktop`.

The drafts folder is why closing the app with unsaved text costs nothing: it is
written while you type and read back at the next start. It is also plain text
sitting in your profile, so treat it the way you would treat the files it is a
copy of.

Setting `UWUNOTES_DIR` to a folder puts the session and the drafts there
instead. That is how you try something out without touching the session you
actually work in, and it is the closest thing to a portable install so far.

Your files themselves are yours, wherever you keep them. UwUNotes reads and
writes them and that is the whole list — no cloud, no account, no telemetry. The
update check is the one thing that leaves the machine, and it asks for a file
rather than telling anybody anything.

## Uninstalling

On a Mac and on Linux, see [macOS](#macos) and [Linux](#linux); the question
and what it keeps are the same.

**Windows Settings → Apps → Installed apps → UwUNotes → Uninstall**, or
`uninstall.exe` in the install folder. It is the same program either way, and it
asks one question: **Keep settings and session**, ticked.

Ticked, it takes away the editor, both shortcuts and the entry in Windows' list,
and leaves the two folders above alone — a reinstall then finds your tabs where
you left them. Unticked, those two folders go as well, which includes the drafts
of everything you never saved.

Your own files are never touched, wherever you keep them, and neither is
anything you put in the install folder yourself: that folder is only removed if
nothing else is in it.

## If something goes wrong

- **WebView2 could not be installed**: get the Evergreen WebView2 Runtime from
  [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/) and run
  the setup again.
- **"UwUNotes is still open", and it is not**: look in the Task Manager for
  `UwUNotes.exe`, and for `uwunotes-desktop.exe` if this machine ever had 0.1.0
  or 0.2.0. Nothing has been changed at that point — the setup checks before it
  writes anything.
- **The build fails on the Rust side**: almost always a missing prerequisite.
  Walk the Tauri list above again, then `cargo clean` and retry.
- **Everything comes back empty after an update**: check whether `UWUNOTES_DIR`
  is set in that shell. It moves the session, and a session that is not there
  looks exactly like a session that was lost.
- **Nothing ever tells me about a new version**: the About box says which one
  you are on, and 0.1.0 has no updater at all. From 0.2.0 on a check that gets
  no answer stays quiet on purpose; start the editor with `UWUNOTES_LOG=warn`
  and it says why.
- Something else? [Open an issue](https://github.com/MinifyX/UwUNotes-Client/issues)
  — no promises on how fast, see the README.

---

# UwUNotes installieren

Zwei Wege hinein. Das Setup von der Releases-Seite ist ein Download, eine
Warnung von Windows, die weiter unten erklärt wird, bevor du sie siehst, und ein
Doppelklick. [Selbst bauen](#4-selbst-bauen) ist ein Clone, zwei Befehle und ein
erster Lauf, in dem Rust eine Weile kompiliert — dafür bekommst du den aktuellen
Stand des Repositories statt dessen, was ein Release eingefroren hat.

Ab 0.2.0 meldet sich ein installiertes UwUNotes, wenn es etwas Neueres gibt.
0.1.0 tut das nicht und wird es nie tun — siehe [Updates](#updates-1).

## Was du brauchst

- **Windows 10 oder 11, 64 Bit**, x64 oder ARM64. x64 ist die Plattform, auf
  der ich entwickle und am meisten teste; das ARM64-Setup baut jedes Release,
  ausprobiert ist es weit weniger.
  **Microsoft Edge WebView2** gehört dazu: Windows 11 hat es immer, Windows 10
  meistens. Fehlt es, bietet das Setup an, es zu holen.
- **macOS**, mit Apple Silicon oder Intel — siehe [macOS](#macos-1). Jedes
  Release baut es, ausprobiert ist es weit weniger als Windows.
- **Linux, x86_64 oder arm64**, mit **WebKitGTK 4.1** — siehe
  [Linux](#linux-1). Jedes Release baut es, ausprobiert ist es weit weniger als
  Windows.

Unter Windows und macOS ist es UwUNotes' eigenes Setup, dasselbe Fenster mit
Nyu darin. Unter Linux ist es ein Paket für deine Distribution oder ein
portabler Ordner; welches wofür, steht im Abschnitt unten.

UwUNotes spricht Deutsch und Englisch, je nach System.
**Einstellungen → Erscheinungsbild → Sprache** schaltet um.

## 1. Aus einem Release

Releases stehen auf der
[Releases-Seite](https://github.com/MinifyX/UwUNotes-Client/releases). Nimm das
neueste ganz oben und lade unter **Assets** die eine Datei für dein System
herunter:

| System                          | Datei                                                      |
| ------------------------------- | ---------------------------------------------------------- |
| Windows (x64)                   | `UwUNotes-windows-x64-setup.exe`                           |
| Windows auf ARM                 | `UwUNotes-windows-arm64-setup.exe`                         |
| macOS (Intel und Apple Silicon) | `UwUNotes-macos-universal.dmg`                             |
| Ubuntu, Debian, Mint            | `UwUNotes-linux-x64.deb` (ARM: `UwUNotes-linux-arm64.deb`) |
| Fedora, openSUSE                | `UwUNotes-linux-x64.rpm` (ARM: `UwUNotes-linux-arm64.rpm`) |
| Arch, Manjaro                   | aus dem AUR: `yay -S uwunotes-bin`                         |
| Jedes Linux, ohne Installation  | `UwUNotes-linux-x64-portable.tar.gz` (ARM: `…-arm64-…`)    |

Die Namen tragen keine Version, also ist
`https://github.com/MinifyX/UwUNotes-Client/releases/latest/download/<Datei>`
immer die neueste; die Version steht im Titel des Releases. Die Windows-Setups
sind außerdem das, was eine installierte Kopie selbst holt, wenn sie sich
aktualisiert, und ebenso das `.deb` und das `.rpm`.

`UwUNotes-update-linux-x64.tar.gz` ist nicht für dich: Daraus aktualisieren sich
Kopien, die das Linux-Setup von 0.4.x installiert hat (siehe [Linux](#linux-1)).

`SHA256SUMS.txt` listet alle davon, falls du prüfen möchtest, ob du auch wirklich
die gebaute Datei hast: `Get-FileHash .\UwUNotes-windows-x64-setup.exe` in der
PowerShell, dann vergleichen — oder neben dem Download
`shasum -a 256 -c SHA256SUMS.txt --ignore-missing` auf dem Mac und
`sha256sum -c SHA256SUMS.txt --ignore-missing` unter Linux. Die Datei kommt
aus demselben Workflow, der auch das Setup gebaut hat — sie kann dir also nicht sagen, dass der Build ehrlich war,
nur dass der Datei seitdem nichts passiert ist.

Dein Browser meldet vielleicht, die Datei werde „nicht häufig heruntergeladen“ —
was stimmt und was er über jede Datei sagt, die noch niemand heruntergeladen
hat. Behalte sie trotzdem (in Edge: `…` → **Beibehalten** → **Mehr anzeigen** →
**Trotzdem beibehalten**).

## 2. Die Warnung, die Windows dir zeigen wird

Doppelklick auf das Setup, und Windows meldet sehr wahrscheinlich **„Der
Computer wurde durch Windows geschützt“**. Klick auf **Weitere Informationen**,
dann auf **Trotzdem ausführen**.

Dieses Fenster sagt nichts darüber, was in der Datei steht. Es kommt, weil das
Setup nicht mit einem kostenpflichtigen Code-Signing-Zertifikat signiert ist:
So ein Zertifikat kostet ein paar hundert Euro im Jahr, das hier ist ein
Hobbyprojekt ohne Einnahmen, und SmartScreen vertraut dem, was es oft genug
gesehen hat, oder dem, wofür bezahlt wurde. Ein Virenscanner, der das Setup
blockiert, sagt dasselbe, nur lauter.

Was du statt mir vertrauen kannst: Jede Zeile davon liegt in diesem Repository,
und ein Release wird daraus gebaut.

Die Signatur, die der Updater benutzt, ist etwas anderes und hilft hier nicht.
Die entscheidet, ob ein Update wirklich aus diesem Projekt kommt; dieses Fenster
entscheidet, ob Windows ein Programm überhaupt startet, und das geht nur mit
einem bezahlten Zertifikat weg.

## 3. Was das Setup tut

Ein kleines dunkles Fenster mit Nyu darin, auf Deutsch oder Englisch, je nach
Windows. Gefragt wird nach zwei Dingen:

- **Ordner.** `%LOCALAPPDATA%\Programs\UwUNotes`, wenn du nichts anderes
  einträgst. Alles landet unter deinem Benutzerkonto — kein Administrator, keine
  UAC-Abfrage, nichts außerhalb deines Profils.
- **Verknüpfung auf dem Desktop.** Aus auf einem Rechner, auf dem UwUNotes noch
  nie lag; danach steht der Haken da, wo du ihn zuletzt gelassen hast. Ins
  Startmenü kommt sie ohnehin, und nimmst du den Haken bei einem späteren Lauf
  weg, verschwindet die auf dem Desktop wieder.

Danach schreibt es `UwUNotes.exe`, legt `uninstall.exe` daneben — dasselbe
Programm unter einem zweiten Namen — und trägt den Editor unter
`HKEY_CURRENT_USER` ein, weshalb er in der Windows-Liste der installierten Apps
auftaucht. Beim Installieren wird nichts heruntergeladen: Der Editor steckt in
der Setup-Datei, und das ist der größte Teil ihrer Größe.

Fehlt WebView2, bietet das Setup vorher an, es bei Microsoft zu holen. Das ist
das Einzige, was es je herunterlädt, und nur auf einem Rechner, der es noch
nicht hat.

**Eine ältere Installation wird übernommen.** 0.1.0 und 0.2.0 kamen aus Tauris
Standard-Installer, der den Editor `uwunotes-desktop.exe` nannte und nach
`%LOCALAPPDATA%\UwUNotes` legte. Das Setup findet das, installiert stattdessen
nach `Programs` und räumt die alte Datei samt ihren Einträgen weg. Sitzung,
Entwürfe und Einstellungen liegen ganz woanders und bleiben unangetastet.

**UwUNotes muss geschlossen sein.** Ein Installer, der einen Editor mit
ungespeichertem Text schließt, ist ein Weg, Text zu verlieren. Also sagt das
Setup „UwUNotes ist noch offen“ und wartet auf deine Entscheidung, statt sie dir
abzunehmen. Die einzige Ausnahme ist der Editor, der sich selbst aktualisiert —
da hat er längst alles auf die Platte geschrieben und sich geschlossen, bevor das
Setup startet.

## macOS

**Ein Image für jeden Mac.** `UwUNotes-macos-universal.dmg` enthält den Editor
für Apple Silicon und für Intel, und jeder Mac startet seine Hälfte. (0.4.x hatte
ein Image pro Prozessor; dieses installiert über beide.)

**Der erste Start.** Öffne das Image und doppelklicke **UwUNotes Setup**. macOS
lehnt das sehr wahrscheinlich ab: „kann nicht geöffnet werden, da der Entwickler
nicht verifiziert werden kann“ oder „Apple konnte nicht überprüfen …“. Das ist
Gatekeeper, die Mac-Ausgabe des SmartScreen-Fensters von oben: Das Setup ist
nicht mit einer Apple-Developer-ID signiert und nicht von Apple notarisiert, und
das kostet eine Jahresgebühr, die dieses Projekt nicht zahlt. An der Datei ist
deshalb nichts falsch. Beide Wege gehen:

- **Ctrl-Klick** (oder Rechtsklick) auf **UwUNotes Setup** → **Öffnen** →
  **Öffnen**. Ab macOS 15 fehlt dieser Knopf im ersten Dialog: einmal zu öffnen
  versuchen, dann **Systemeinstellungen → Datenschutz & Sicherheit**, nach
  unten zu „UwUNotes Setup wurde blockiert“, **Dennoch öffnen**.
- Oder im Terminal die Quarantäne-Markierung von deiner Kopie nehmen und normal
  öffnen:
  `xattr -dr com.apple.quarantine "/Volumes/UwUNotes Setup/UwUNotes Setup.app"`
  (oder vorher auf das `.dmg` selbst).

Gefragt wird einmal, für das Setup. Den Editor schreibt das Setup selbst, er wird
nicht heruntergeladen, also fragt macOS dazu nichts mehr.

**Was es tut.** Dasselbe Fenster wie unter Windows und dieselbe eine Frage —
nach dem Ordner wird nicht gefragt, eine Mac-App gehört in einen
Programme-Ordner:

- `~/Applications/UwUNotes.app` — der Programme-Ordner deines eigenen Benutzers,
  der angelegt wird, wenn es ihn noch nicht gibt. Kein Administrator-Passwort.
  Launchpad, Spotlight und Finder finden es dort.
- **Alias auf dem Schreibtisch**, wenn angehakt.
- `~/Library/Application Support/app.uwunotes.setup/`: welche Version
  installiert wurde, und eine Kopie des Setups als `uninstall`.

UwUNotes muss beendet sein (⌘Q, nicht nur das Fenster zu), damit das Setup es
ersetzen kann.

**Entfernen.** `UwUNotes.app` in den Papierkorb ziehen, wie jede Mac-App — dann
bleiben Sitzung und Einstellungen liegen. Oder das Deinstallationsprogramm
starten, das die übliche Frage dazu stellt:

```bash
"$HOME/Library/Application Support/app.uwunotes.setup/uninstall" --uninstall
```

**Updates.** Eine installierte Kopie meldet eine neuere Version wie überall,
installiert sie aber nicht selbst: Lad das neue Image herunter und lass das
Setup über die alte Installation laufen. Sitzung, Einstellungen und Entwürfe
bleiben.

## Linux

x86_64 oder arm64, Ubuntu 22.04, Debian 12, Fedora 36 oder alles Neuere. Drei
Wege, such dir einen aus:

**Ein Paket für deine Distribution** — der übliche Weg. Es installiert
systemweit nach `/usr` (`/usr/bin/uwunotes`, ein Eintrag im Anwendungsmenü) und
bringt WebKitGTK 4.1, die Browser-Engine, in der der Editor zeichnet, als
Abhängigkeit mit:

```bash
sudo apt install ./UwUNotes-linux-x64.deb      # Debian, Ubuntu, Mint
sudo dnf install ./UwUNotes-linux-x64.rpm      # Fedora
sudo zypper install ./UwUNotes-linux-x64.rpm   # openSUSE
yay -S uwunotes-bin                            # Arch, Manjaro (AUR)
```

(`-arm64` statt `-x64` auf einem ARM-Rechner.) Das `.deb` und das `.rpm`
**aktualisieren sich selbst**: **Installieren und neu starten** lädt das neue
Paket, prüft seine Signatur und gibt es über `pkexec` an `dpkg` oder `rpm`, das
nach deinem Passwort fragt; danach startet UwUNotes neu. Das AUR-Paket
aktualisiert pacman wie alles aus dem AUR — der Editor sagt nur, dass es etwas
Neues gibt. Entfernen ist ebenfalls Sache des Paketmanagers:
`sudo apt remove uwunotes`, `sudo dnf remove uwunotes`,
`sudo pacman -R uwunotes-bin`.

**Der portable Ordner** — nichts wird installiert, nichts braucht root. Irgendwo
entpacken und von dort starten:

```bash
tar -xzf UwUNotes-linux-x64-portable.tar.gz
./UwUNotes/uwunotes
```

Er bringt seine Bibliotheken mit, außer WebKitGTK und dem Grafik-Unterbau, die
dein System haben muss (`libwebkit2gtk-4.1-0`, `webkit2gtk4.1` oder
`webkit2gtk-4.1`, je nach Distribution). Er aktualisiert sich nicht selbst: Er
meldet eine neue Version, und dann entpackst du das neue Archiv darüber.

**Das Setup von 0.4.x.** 0.4.0 und 0.4.1 kamen als Setup in einem tar.gz, das in
deinen Home-Ordner installiert hat. Als Download gibt es dieses Setup nicht mehr;
Kopien, die es installiert hat, melden neue Versionen weiter und werden aus
`UwUNotes-update-linux-x64.tar.gz` auf der Release-Seite aktualisiert —
entpacken und die eine Datei darin starten, genau wie bisher. Oder zum Paket
wechseln: die alte Kopie entfernen (unten) und das `.deb` oder `.rpm`
installieren; Sitzung, Einstellungen und Entwürfe bleiben, wo sie sind. Zur
Vollständigkeit, was dieses Setup tut — dasselbe Fenster und dieselbe Frage wie
überall, der Ordner wird angezeigt, nicht gefragt:

- `~/.local/share/uwunotes/uwunotes` — der Editor (`$XDG_DATA_HOME`, wenn du
  eins gesetzt hast), und `uninstall` daneben, das wieder das Setup ist.
- `~/.local/share/applications/app.uwunotes.desktop` — der Eintrag im
  Anwendungsmenü, der UwUNotes auch unter **Öffnen mit** für Textdateien
  anbietet.
- Das Symbol unter `~/.local/share/icons/hicolor/`.
- `~/.local/bin/uwunotes`, ein Link auf den Editor, damit `uwunotes` im
  Terminal geht, wo `~/.local/bin` im `PATH` liegt — außer etwas Eigenes von dir
  heißt schon so, dann bleibt das unangetastet.
- Ein Starter auf dem Schreibtisch, wenn angehakt und wenn dein Desktop einen
  Schreibtisch-Ordner hat.

Alles wird ganz oder gar nicht geschrieben, mit schlichten Rechten (0755 für die
Programme, 0644 für den Rest), und durch einen Link, den es nicht selbst
angelegt hat, schreibt das Setup nicht.

**Entfernen.** Rechtsklick auf UwUNotes im Anwendungsmenü oder im Dock →
**UwUNotes entfernen**, oder:

```bash
~/.local/share/uwunotes/uninstall --uninstall
```

Es stellt die übliche Frage und entfernt genau die Dateien von oben — jede nur,
solange sie noch das ist, was das Setup dort hingelegt hat.

**Updates.** Eine Kopie, die das Setup installiert hat, meldet eine neuere
Version wie überall, installiert sie aber nicht selbst: Lad
`UwUNotes-update-linux-x64.tar.gz` herunter und starte das Setup darin.
Sitzung, Einstellungen und Entwürfe bleiben.

## 4. Selbst bauen

Das ist der Weg zum aktuellen Stand des Repositories statt zu dem, was ein
Release eingefroren hat.

Du brauchst:

- **Node.js 22 oder neuer** und **pnpm 11** (`corepack enable`)
- **Rust stable**, über [rustup](https://rustup.rs)
- Die Plattform-Voraussetzungen für Tauri —
  [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/). Unter
  Windows sind das die Visual Studio C++ Build Tools und WebView2.

```bash
git clone https://github.com/MinifyX/UwUNotes-Client
cd UwUNotes-Client
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` startet die App, und die Oberfläche lädt beim Bearbeiten neu.
Der erste Lauf kompiliert die Rust-Seite und dauert; jeder weitere nicht mehr.

Für etwas zum Behalten:

```bash
pnpm build:setup
```

Das baut den Editor, packt ihn ins Setup und legt das Setup für dein System nach
`target/release` im Wurzelverzeichnis: `UwUNotes-Setup-<version>.exe`
(`…-windows-arm64.exe` auf ARM), `…-macos-universal.dmg` (mit beiden
Rust-Targets: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`) oder
`…-linux-x86_64.tar.gz`. Die Linux-Pakete und den portablen Ordner baut
`node scripts/build-linux-packages.mjs`, in denselben Ordner.
Unter Linux vorher die `-dev`-Pakete aus Tauris Voraussetzungen installieren. Ohne den
Signaturschlüssel des Projekts in der Umgebung sagt es das und schreibt keine
`.sig` — am Installieren ändert das nichts, denn diese Signatur prüft nur eine
_installierte_ Kopie, bevor sie sich selbst aktualisiert. Windows begrüßt deinen
eigenen Build genau wie oben beschrieben, was eine ganz gute Gelegenheit ist,
diese Warnung einmal zu sehen, wenn man ganz genau weiß, woher die Datei kommt.

Ein schlichtes `pnpm tauri build` ist etwas anderes: Tauris eigene Pakete des
Editors. Es bricht ohne den Signaturschlüssel ab, weil in der Konfiguration die
Updater-Artefakte eingeschaltet sind. `scripts/build-linux-packages.mjs`
schaltet sie für den einen Build aus, der das `.deb` und das `.rpm` macht.

## Updates

**Ab 0.2.0 merkt UwUNotes selbst, wenn es etwas Neueres gibt.** Ungefähr
fünfzehn Sekunden nach dem Öffnen des Fensters — einmal, und in diesem Lauf
nicht wieder — fragt es auf GitHub nach. Gibt es eine neuere Version, erscheint
über der Statusleiste ein Streifen: die Version, auf Wunsch die Release-Notes,
**Später** und **Installieren und neu starten**. Nie ein Dialog über deinem
Text. Gibt es nichts Neueres, hörst du nichts. Kommt überhaupt keine Antwort —
kein Netz, die Datei nicht da —, hörst du auch nichts, und der Grund landet im
Log statt in deinem Weg.

**0.1.0 hat keinen Updater und wird dir 0.2.0 nie anbieten.** Es ist gebaut
worden, bevor es das alles gab, also kann dir nichts darin etwas sagen. Lad das
Setup einmal von Hand herunter und installier es über die vorhandene Version; ab
dieser Installation schaut der Editor selbst nach.

Auf dem Mac, im portablen Linux-Ordner, in einer Kopie vom alten Linux-Setup und
im AUR-Paket sagt der Streifen dasselbe, hat aber kein **Installieren und neu
starten**: Was diese herunterladen, ist ein Image oder ein Archiv, kein
Programm, das der Editor starten kann, oder etwas, um das sich pacman kümmert.
Die neue Version ist dort ein Download von der Releases-Seite, wie unter
[macOS](#macos-1) und [Linux](#linux-1) beschrieben. Das `.deb` und das `.rpm`
installieren sie dagegen: Das Paket geht über `pkexec` an `dpkg` oder `rpm`, und
der Editor startet in der neuen Version neu — aber nur, wenn `dpkg` oder `rpm`
den Editor wirklich als ihren führen.

Unter Windows lädt **Installieren und neu starten** das Setup herunter, prüft es und übergibt:
Der Editor schreibt Sitzung und jeden ungespeicherten Puffer auf die Platte,
startet das Setup mit seiner eigenen Prozess-ID zum Warten und schließt sich. Das
Setup wartet, bis Windows die Datei freigibt, ersetzt sie und startet den Editor
wieder. Ein Fenster siehst du dabei nie — das Einzige, was überhaupt auftauchen
kann, ist eine Meldung, und die nur, wenn das Update nicht geklappt hat. Die Tabs
kommen wieder so, wie du sie verlassen hast.

**Rückwärts geht es nicht.** Bevor ein Update irgendetwas ersetzt, vergleicht das
Setup die Version, die es mitbringt, mit der installierten und bricht ab, wenn
seine die ältere ist. Es bricht auch ab, wenn es nicht lesen kann, welche Version
installiert ist — beim Update schaut niemand zu. Ein Setup von Hand zu starten
ist dagegen eine Entscheidung eines Menschen, und dort wird die ältere Version
mit einem Knopf angeboten, auf dem genau das steht.

### Was die Signatur heißt und was nicht

Jedes Setup und Paket aus einem Release ist mit dem eigenen Schlüssel des Projekts
signiert, und die öffentliche Hälfte dieses Schlüssels steckt in der App. Bevor
ein Update installiert wird, prüft die App die heruntergeladene Datei gegen
diesen Schlüssel und lehnt alles ab, was er nicht signiert hat — eine unterwegs
ausgetauschte Datei oder ein Feed, der auf fremde Programme zeigt, läuft nie.
Sie prüft sogar zweimal: einmal, wenn die Bytes ankommen, und einmal an dem, was
kurz darauf im Ordner liegt, direkt bevor das Setup gestartet wird.

Mehr behauptet sie nicht: Diese Datei kommt aus diesem Projekt und ist
unverändert angekommen. Sie ist **nicht** das Windows-Code-Signing-Zertifikat
aus dem Abschnitt oben. SmartScreen warnt weiterhin — beim Setup, das du von
Hand herunterlädst, und bei dem, das der Updater holt —, und der Schlüssel des
Projekts ändert daran nichts.

### Was gefragt wird, und wo

Eine Adresse, eine kleine JSON-Datei in einem Branch dieses Repositories:

```text
https://raw.githubusercontent.com/MinifyX/UwUNotes-Client/updates/latest.json
```

Das ist eine schlichte Anfrage nach dieser Datei. Nichts über dich, deine
Dateien oder deine Installation geht mit; GitHub sieht eine Anfrage nach einer
öffentlichen Datei wie jede andere, also: dass jemand gefragt hat.
Vorabversionen landen dort absichtlich nie, eine Beta kommt also nie von allein
— die gibt es auf der Releases-Seite oder gar nicht.

Ein neueres Setup darf weiterhin direkt über ein installiertes UwUNotes laufen;
Sitzung, Einstellungen und Makros bleiben in beiden Fällen, wo sie sind.

## Wo deine Daten liegen

| Was                                               | Wo                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------- |
| Offene Tabs, Splits, Cursor, die letzten Dateien  | `%APPDATA%\app.uwunotes.desktop\session.json`                               |
| Ungespeicherter Text, eine Datei pro Puffer       | `%APPDATA%\app.uwunotes.desktop\drafts\`                                    |
| Einstellungen, eigene Themes, gespeicherte Makros | Der Local Storage der Webview, unter `%LOCALAPPDATA%\app.uwunotes.desktop\` |

Auf dem Mac ist derselbe Ordner `~/Library/Application Support/app.uwunotes.desktop`
(die Einstellungen unter `~/Library/WebKit/app.uwunotes.desktop`), unter Linux
`~/.local/share/app.uwunotes.desktop`.

Der `drafts`-Ordner ist der Grund, warum das Schließen mit ungespeichertem Text
nichts kostet: Er wird beim Tippen geschrieben und beim nächsten Start wieder
gelesen. Er ist aber auch einfacher Text in deinem Profil — behandle ihn so, wie
du die Dateien behandelst, von denen er eine Kopie ist.

Setzt du `UWUNOTES_DIR` auf einen Ordner, landen Sitzung und Drafts dort. So
probierst du etwas aus, ohne die Sitzung anzufassen, in der du wirklich
arbeitest, und näher an einer portablen Installation ist es bisher nicht.

Deine Dateien selbst gehören dir, wo immer du sie hast. UwUNotes liest und
schreibt sie, und das ist die ganze Liste — keine Cloud, kein Konto, keine
Telemetrie. Die Updatesuche ist das Einzige, was den Rechner verlässt, und sie
fragt nach einer Datei, statt jemandem etwas zu erzählen.

## Deinstallieren

Für Mac und Linux siehe [macOS](#macos-1) und [Linux](#linux-1); die Frage und
was sie behält, sind dieselben.

**Windows-Einstellungen → Apps → Installierte Apps → UwUNotes →
Deinstallieren**, oder `uninstall.exe` im Installationsordner. Beides ist
dasselbe Programm, und es stellt eine Frage: **Einstellungen und Sitzung
behalten**, angehakt.

Angehakt nimmt es den Editor, beide Verknüpfungen und den Eintrag in der
Windows-Liste weg und lässt die beiden Ordner von oben in Ruhe — eine
Neuinstallation findet deine Tabs dann da, wo du sie gelassen hast. Ohne Haken
gehen auch diese beiden Ordner, und damit die Entwürfe von allem, was du nie
gespeichert hast.

Deine eigenen Dateien bleiben unangetastet, wo immer du sie hast, und ebenso
alles, was du selbst in den Installationsordner gelegt hast: Der Ordner wird nur
entfernt, wenn sonst nichts mehr darin liegt.

## Wenn etwas nicht klappt

- **WebView2 ließ sich nicht installieren**: Hol die Evergreen WebView2 Runtime
  von [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/) und
  starte das Setup noch einmal.
- **„UwUNotes ist noch offen“, ist es aber nicht**: Schau im Task-Manager nach
  `UwUNotes.exe`, und nach `uwunotes-desktop.exe`, falls auf diesem Rechner
  einmal 0.1.0 oder 0.2.0 lag. Geändert ist zu diesem Zeitpunkt nichts — das
  Setup prüft, bevor es irgendetwas schreibt.
- **Der Build scheitert auf der Rust-Seite**: fast immer eine fehlende
  Voraussetzung. Geh die Tauri-Liste oben noch einmal durch, dann `cargo clean`
  und neu versuchen.
- **Nach einem Update ist alles leer**: Schau nach, ob in dieser Shell
  `UWUNOTES_DIR` gesetzt ist. Es verschiebt die Sitzung, und eine Sitzung, die
  woanders liegt, sieht genauso aus wie eine verlorene.
- **Mir sagt nie jemand, dass es etwas Neueres gibt**: Im Über-Fenster steht,
  welche Version du hast, und 0.1.0 hat überhaupt keinen Updater. Ab 0.2.0
  bleibt eine Suche ohne Antwort absichtlich still; starte den Editor mit
  `UWUNOTES_LOG=warn`, dann steht der Grund im Log.
- Etwas anderes? [Issue aufmachen](https://github.com/MinifyX/UwUNotes-Client/issues)
  — ohne Versprechen, wie schnell, siehe README.
