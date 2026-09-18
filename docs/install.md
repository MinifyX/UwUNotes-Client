# Installing UwUNotes

[Deutsch weiter unten](#uwunotes-installieren)

**There is no release yet.** Nothing has been published, so there is nothing to
download and nothing to double-click. Today the only way to get UwUNotes running
is to [build it yourself](#3-building-it-yourself), which is a clone, two
commands and a first run in which Rust compiles for a while.

The rest of this page is written for the day that changes, so that the warning
Windows will show you is explained before you see it rather than after.

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
what was built: `Get-FileHash .\UwUNotes_0.1.0_x64-setup.exe` in PowerShell,
and compare. It is published by the same job that built the file, so it cannot
tell you the build was honest — only that nothing happened to the file since.

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

## 3. Building it yourself

This is the way in today, and it is also how you get the current state of the
repository rather than whatever a release froze.

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

**There is no updater.** UwUNotes does not check for new versions, does not ping
anything on start, and will not tell you that something newer exists. That is
partly a missing feature and partly the point: an editor that opens a socket to
look at a config file is doing something I do not want.

So it is the releases page, when you think of it. A newer setup can be run
straight over an installed UwUNotes; the session, the settings and the macros
stay where they are.

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
writes them and that is the whole list — no cloud, no account, no telemetry.

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
- Something else? [Open an issue](https://github.com/MinifyX/UwUNotes-Client/issues)
  — no promises on how fast, see the README.

---

# UwUNotes installieren

**Es gibt noch kein Release.** Nichts ist veröffentlicht, also gibt es nichts
herunterzuladen und nichts anzuklicken. Der einzige Weg zu einem laufenden
UwUNotes führt heute über
[selbst bauen](#3-selbst-bauen) — ein Clone, zwei Befehle und ein erster Lauf,
in dem Rust eine Weile kompiliert.

Der Rest dieser Seite ist für den Tag geschrieben, an dem sich das ändert, damit
die Warnung, die Windows dir zeigen wird, vorher erklärt ist und nicht hinterher.

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
die gebaute Datei hast: `Get-FileHash .\UwUNotes_0.1.0_x64-setup.exe` in der
PowerShell, dann vergleichen. Die Datei kommt aus demselben Lauf, der auch das
Setup gebaut hat — sie kann dir also nicht sagen, dass der Build ehrlich war,
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

## 3. Selbst bauen

Das ist heute der Weg hinein, und es ist außerdem der Weg zum aktuellen Stand
des Repositories statt zu dem, was ein Release eingefroren hat.

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

**Es gibt keinen Updater.** UwUNotes sucht nicht nach neuen Versionen, funkt
beim Start nirgendwo hin und sagt dir nicht, dass es etwas Neueres gibt. Das ist
halb eine fehlende Funktion und halb Absicht: Ein Editor, der eine Verbindung
aufmacht, um eine Config-Datei anzuzeigen, tut etwas, das ich nicht will.

Also: die Releases-Seite, wenn du daran denkst. Ein neueres Setup darf direkt
über ein installiertes UwUNotes laufen; Sitzung, Einstellungen und Makros
bleiben, wo sie sind.

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
Telemetrie.

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
- Etwas anderes? [Issue aufmachen](https://github.com/MinifyX/UwUNotes-Client/issues)
  — ohne Versprechen, wie schnell, siehe README.
