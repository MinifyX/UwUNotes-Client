# Installing UwUNotes

[Deutsch weiter unten](#uwunotes-installieren)

Two ways in. The setup from the releases page is a download, a warning from
Windows that is explained below before you see it rather than after, and a
double-click. [Building it yourself](#3-building-it-yourself) is a clone, two
commands and a first run in which Rust compiles for a while, and it gets you the
state of the repository rather than what a release froze.

From 0.2.0 on, an installed UwUNotes says so when there is a newer version.
0.1.0 does not and never will — see [Updates](#updates).

## What you need

- **Windows 10 or 11, 64-bit.** That is the only platform I develop on and the
  only one I test. macOS and Linux are a Tauri build target away in theory and
  untried in practice; Windows on ARM has never been started.
- **Microsoft Edge WebView2.** Windows 11 always has it, Windows 10 usually.
  If it is missing, the setup offers to fetch it.

UwUNotes speaks German and English, following Windows.
**Settings → Appearance → Language** switches.

## 1. From a release

Releases are on the
[releases page](https://github.com/MinifyX/UwUNotes-Client/releases). Take the
newest one at the top and download the `.exe` setup under **Assets**.

`SHA256SUMS.txt` sits next to it, if you want to check that what you have is
what was built: `Get-FileHash .\UwUNotes_0.2.0_x64-setup.exe` in PowerShell,
and compare. It is published by the same job that built the file, so it cannot
tell you the build was honest — only that nothing happened to the file since.

The `.sig` beside the setup is not for you. It is what an installed UwUNotes
checks before it installs an update, and it is explained under
[Updates](#updates).

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

## 3. Building it yourself

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
pnpm tauri build
```

The setup lands in `target/release/bundle/` in the repository root. It is the
same unsigned file a release would be, so Windows greets it exactly as described
above — which is a decent way to see that warning once in a context where you
know precisely where the file came from.

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

**Install and restart** downloads the setup and runs it. On Windows that means
UwUNotes closes itself, so the session and every unsaved buffer go to disk
first: the tabs come back afterwards the way you left them.

### What the signature means, and what it does not

Every setup a release publishes is signed with the project's own key, and the
public half of that key is built into the app. Before an update is installed the
app checks the file it downloaded against that key and refuses anything the key
did not sign — a file swapped somewhere on the way, or a feed pointing at
somebody else's program, never runs. An update also has to be a _newer_ version
than the one asking, so the same channel cannot walk you backwards into an older
build.

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

**Windows Settings → Apps → Installed apps → UwUNotes → Uninstall.** That takes
the program away and leaves the two folders above alone, so a reinstall finds
your tabs where you left them. If you want it gone completely, delete
`%APPDATA%\app.uwunotes.desktop\` and `%LOCALAPPDATA%\app.uwunotes.desktop\`
yourself — the first holds the drafts, the second the settings.

## If something goes wrong

- **WebView2 could not be installed**: get the Evergreen WebView2 Runtime from
  [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/) and run
  the setup again.
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
Doppelklick. [Selbst bauen](#3-selbst-bauen) ist ein Clone, zwei Befehle und ein
erster Lauf, in dem Rust eine Weile kompiliert — dafür bekommst du den aktuellen
Stand des Repositories statt dessen, was ein Release eingefroren hat.

Ab 0.2.0 meldet sich ein installiertes UwUNotes, wenn es etwas Neueres gibt.
0.1.0 tut das nicht und wird es nie tun — siehe [Updates](#updates-1).

## Was du brauchst

- **Windows 10 oder 11, 64 Bit.** Das ist die einzige Plattform, auf der ich
  entwickle, und die einzige, die ich teste. macOS und Linux sind theoretisch
  ein Tauri-Build-Target weit weg und praktisch unerprobt; Windows auf ARM habe
  ich nie gestartet.
- **Microsoft Edge WebView2.** Windows 11 hat es immer, Windows 10 meistens.
  Fehlt es, bietet das Setup an, es zu holen.

UwUNotes spricht Deutsch und Englisch, je nach Windows.
**Einstellungen → Erscheinungsbild → Sprache** schaltet um.

## 1. Aus einem Release

Releases stehen auf der
[Releases-Seite](https://github.com/MinifyX/UwUNotes-Client/releases). Nimm das
neueste ganz oben und lade unter **Assets** das `.exe`-Setup herunter.

Daneben liegt `SHA256SUMS.txt`, falls du prüfen möchtest, ob du auch wirklich
die gebaute Datei hast: `Get-FileHash .\UwUNotes_0.2.0_x64-setup.exe` in der
PowerShell, dann vergleichen. Die Datei kommt aus demselben Lauf, der auch das
Setup gebaut hat — sie kann dir also nicht sagen, dass der Build ehrlich war,
nur dass der Datei seitdem nichts passiert ist.

Die `.sig` neben dem Setup ist nicht für dich. Sie ist das, was ein
installiertes UwUNotes prüft, bevor es ein Update installiert, und steht unter
[Updates](#updates-1).

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

## 3. Selbst bauen

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
pnpm tauri build
```

Das Setup landet in `target/release/bundle/` im Wurzelverzeichnis. Es ist
dieselbe unsignierte Datei, die auch ein Release wäre, Windows begrüßt sie also
genau wie oben beschrieben — was eine ganz gute Gelegenheit ist, diese Warnung
einmal zu sehen, wenn man ganz genau weiß, woher die Datei kommt.

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

**Installieren und neu starten** lädt das Setup herunter und startet es. Unter
Windows heißt das: UwUNotes schließt sich selbst. Die Sitzung und jeder
ungespeicherte Puffer gehen vorher auf die Platte, die Tabs kommen danach also
wieder so, wie du sie verlassen hast.

### Was die Signatur heißt und was nicht

Jedes Setup aus einem Release ist mit dem eigenen Schlüssel des Projekts
signiert, und die öffentliche Hälfte dieses Schlüssels steckt in der App. Bevor
ein Update installiert wird, prüft die App die heruntergeladene Datei gegen
diesen Schlüssel und lehnt alles ab, was er nicht signiert hat — eine unterwegs
ausgetauschte Datei oder ein Feed, der auf fremde Programme zeigt, läuft nie.
Ein Update muss außerdem _neuer_ sein als das, was gerade fragt; rückwärts, in
einen älteren Build, führt dieser Weg nicht.

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

**Windows-Einstellungen → Apps → Installierte Apps → UwUNotes →
Deinstallieren.** Das nimmt das Programm weg und lässt die beiden Ordner von
oben in Ruhe, eine Neuinstallation findet deine Tabs also da, wo du sie gelassen
hast. Soll wirklich alles weg, lösch `%APPDATA%\app.uwunotes.desktop\` und
`%LOCALAPPDATA%\app.uwunotes.desktop\` selbst — im ersten liegen die Drafts, im
zweiten die Einstellungen.

## Wenn etwas nicht klappt

- **WebView2 ließ sich nicht installieren**: Hol die Evergreen WebView2 Runtime
  von [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/) und
  starte das Setup noch einmal.
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
