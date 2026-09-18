# UwUNotes — Konzept

> Der Editor mit Notepad++-Manieren, VS-Code-Optik und ohne jede Wolke.

|                 |                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Stand**       | 2026-09-18 · Entwurf v0.1                                                                                            |
| **Basis**       | Tauri 2 + React 18 + CodeMirror 6 + Rust                                                                             |
| **Bundle-ID**   | `app.uwunotes.desktop`                                                                                               |
| **Repo**        | [MinifyX/UwUNotes-Client](https://github.com/MinifyX/UwUNotes-Client) · GPL-3.0                                      |
| **Maskottchen** | Nyu, diesmal als Notizblock-Katze                                                                                    |
| **Plattformen** | Windows zuerst, danach Linux/macOS, irgendwann Android                                                               |
| **Suite**       | [UwUMail](https://github.com/MinifyX/UwUMail-Client) · [UwUSSH](https://github.com/MinifyX/UwUSSH-Client) · UwUNotes |

---

## 1. Positionierung

Der Markt ist zweigeteilt:

- **Notepad++ / EditPlus / UltraEdit** — schnell, lokal, ehrlich zu Encodings,
  und optisch in 2004 stehengeblieben. Dialoge, die man bei jedem Start neu
  aufzieht, Einstellungen als Checkbox-Wand.
- **VS Code und alles, was so aussieht** — schön und modern, aber eine IDE. Will
  einen Workspace, bevor es nützlich wird, braucht Sekunden für eine 40-Zeilen-
  Config, bringt Marketplace, Telemetrie und einen Account-Button mit.

UwUNotes besetzt die Lücke: **Notepad++-Verhalten, moderne Optik, null Cloud.**

**Zielgruppe:** Leute, die am Tag zwanzig Dateien kurz aufmachen und wieder
zumachen — eine Config, ein Log, ein `.env`, ein Skript, eine Funktion aus einem
Repo, das sie nicht klonen wollen.

**Versprechen in einem Satz:** _Datei auf, Datei da — und nichts davon geht
kaputt._

### Nicht-Ziele

- **Keine IDE.** Kein Language Server, kein Debugger, kein Build-System, kein
  integriertes Terminal, kein Test-Runner.
- **Keine Cloud.** Keine Synchronisierung deiner Dateien, auch nicht über meinen
  Server. Deine Dateien liegen schon irgendwo; ein Editor ist die falsche
  Schicht für eine zweite Kopie.
- **Keine Telemetrie, kein Account, kein Abo.** Die App macht mit einem
  Netzwerk-Stack exakt nichts.
- **Kein Team-Produkt.** Keine geteilten Workspaces, keine fremden Cursor, keine
  Kommentare.
- **Kein Marketplace.** Eine Plugin-Schnittstelle ist geplant (Phase 2), ein
  Laden dafür nicht.

---

## 2. Tech-Stack

| Schicht     | Wahl                                        | Warum                                                                                                                                            |
| ----------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| App-Shell   | **Tauri 2**                                 | Wie UwUMail und UwUSSH. Ein Binary im zweistelligen MB-Bereich statt 150 MB Electron, WebView2 unter Windows.                                    |
| Frontend    | **React 18 + TypeScript**, Node 24, pnpm 11 | Derselbe Stack wie die Geschwister. Tokens, Komponenten, Nyu und die Build-Pipeline sind übertragbar.                                            |
| Editor      | **CodeMirror 6**                            | Kein Monaco: CodeMirror ist kleiner, modular, und sein Zustandsmodell (Transaktionen, Compartments) passt genau zu dem, was hier gebraucht wird. |
| UI-Font     | **Manrope** (variabel, gebündelt)           | Wie UwUMail — keine Netzwerk-Fonts.                                                                                                              |
| Editor-Font | **JetBrains Mono**, **Fira Code**           | Beide gebündelt, beide variabel. Ligaturen aus per Default.                                                                                      |
| Encoding    | **`encoding_rs`** + **`chardetng`**         | Der eigentliche Grund für eine Rust-Seite. Jede Legacy-Codepage, sauber dekodiert und wieder kodiert.                                            |
| Suche       | **`ignore`** + **`grep-searcher`**          | Respektiert `.gitignore`, liest große Dateien zeilenweise statt am Stück.                                                                        |
| Tokens      | **`@uwu/tokens`**                           | Das Paket im Workspace, das die ganze Suite teilt. UwUNotes ist die erste App, die es importiert statt kopiert.                                  |
| Papierkorb  | **`trash`**                                 | Löschen aus dem Dateibaum geht in den Papierkorb, nie hart.                                                                                      |

Kein Electron, kein Monaco, kein Node im Hintergrund. Was bleibt, ist ein
WebView, eine React-Oberfläche und eine Rust-Seite, die Bytes anfasst.

---

## 3. Architektur

Drei Schichten, je eine Regel. Ausführlich in
[`docs/architecture.md`](docs/architecture.md).

```
┌───────────────────────────────────────────────────────────┐
│  React 18 + TypeScript     Chrome: Tabs, Sidebar,         │
│                            Statusleiste, Dialoge          │
├───────────────────────────────────────────────────────────┤
│  CodeMirror 6              Der Text selbst: State,        │
│                            Auswahl, Undo, Syntax          │
├───────────────────────────────────────────────────────────┤
│  Rust (Tauri 2)            Bytes: dekodieren, kodieren,   │
│                            schreiben, laufen, suchen      │
└───────────────────────────────────────────────────────────┘
```

**Rust besitzt Bytes, die Seite besitzt Text.** Wenn eine Datei bei React
ankommt, ist sie ein JavaScript-String mit `\n`, und alles darüber, wie sie
dahin gekommen ist — Codepage, BOM, Zeilenenden, Zustand auf der Platte —
reist daneben mit, damit das Speichern es exakt zurückbauen kann.

**React besitzt die Möbel, CodeMirror den Text.** Ein Tastendruck darf das
Fenster nicht neu zeichnen.

### Die eine Tür: `lib/api.ts`

Jedes `invoke` läuft durch [`apps/desktop/src/lib/api.ts`](apps/desktop/src/lib/api.ts),
sonst importiert nichts in `src/` aus `@tauri-apps/api`. Damit ist die gesamte
IPC-Fläche eine Datei, die man von oben nach unten liest — und die TypeScript-
Typen und die `#[tauri::command]`s werden zusammen geändert oder gar nicht.

Fehler kommen typisiert zurück: `{ kind, message, path }` mit einem kleinen,
geschlossenen Satz an `kind`s. Die Oberfläche reagiert auf `changed` mit
„Datei wurde geändert, überschreiben?" — und nicht auf einen Prosatext, der
beim Übersetzen kaputtgeht.

### Crates

| Crate                     | Verantwortung                                                     |
| ------------------------- | ----------------------------------------------------------------- |
| `crates/uwunotes-fs`      | Dekodieren, kodieren, atomar schreiben, Verzeichnisse, Dateisuche |
| `crates/uwunotes-session` | Die Sitzungsdatei und die Entwürfe daneben                        |
| `apps/desktop/src-tauri`  | Die Tauri-Shell: Commands, Fenster, Dialoge, Papierkorb           |

### Warum der Text nicht im React-State liegt

Ein Dokument ist seine Metadaten plus ein CodeMirror-`EditorState`, und dieser
State liegt in `lib/documents.ts`, außerhalb von React. Zwei Gründe:

1. **Tippen darf nicht rendern.** CodeMirror aktualisiert sein eigenes DOM. Über
   `useState` würde jeder Tastendruck das ganze Fenster neu zeichnen, um ein
   Zeichen anzuzeigen, das schon auf dem Schirm steht.
2. **Ein Tab behält seine Undo-Historie.** Beim Zurückwechseln bekommt der
   Editor denselben `EditorState` — Ctrl+Z reicht weiterhin bis gestern.

Das Dirty-Flag wird nicht mitgeführt, sondern bei jeder Änderung neu berechnet:
`state.doc` gegen den Text auf der Platte. Wer bis zum gespeicherten Stand
zurück-undot, sieht den Punkt am Tab wieder verschwinden.

### Einstellungen ohne Neuaufbau: Compartments

CodeMirror-Extensions stehen beim Erzeugen des States fest. Tab-Breite,
Zeilennummern oder Theme zu ändern hieße, jeden State neu zu bauen — und damit
genau die Undo-Historie wegzuwerfen, die oben so mühsam gerettet wurde. Deshalb
zwei `Compartment`s: eines für alles aus den Einstellungen, eines für die
Sprache, die später eintrifft als das Dokument, weil Sprachpakete nachgeladen
werden.

---

## 4. Datenmodell

Es gibt keine Datenbank. Es gibt Dateien auf deiner Platte und zwei kleine
Dateien im Konfigverzeichnis der App.

**Dokument** (`DocMeta` in `lib/documents.ts`): Pfad oder `null` für einen
ungespeicherten Puffer, Name, Encoding, BOM-Flag, Zeilenende, gemischte
Zeilenenden, manuell gewählte Sprache, Dirty-Flag, `FileStamp`, sowie die drei
Warnflaggen `lossy`, `binary` und `readOnly`.

**Sitzung** (`StoredSession`): welche Dokumente offen waren, in welchen Panes,
in welcher Reihenfolge, mit Cursor und Scrollposition, dazu der Split-Baum, der
geöffnete Ordner und die Zuletzt-Listen.

**Entwürfe**: der ungespeicherte Text, eine Datei pro Dokument-ID, neben der
Sitzung geparkt. Deshalb kostet das Schließen der App nichts. Ein Entwurf
verschwindet, sobald sein Dokument gespeichert oder sein Tab bewusst geschlossen
wird.

**Einstellungen**: reine Vorlieben, im Speicher der Seite, und alles, was von
dort zurückkommt, läuft durch `sanitize()`. Die Datei liegt auf der Platte des
Nutzers; eine Handbearbeitung, die `fontSize` zu `"big"` macht, darf den Editor
nicht lahmlegen.

---

## 5. Encoding — der Grund für die Rust-Seite

```
lesen  ─▶ erkennen ─▶ dekodieren ─▶ Zeilenenden normalisieren ─▶ Text mit \n
                                                                    │
                                                                 bearbeiten
                                                                    ▼
schreiben ◀─ kodieren ◀─ EOL zurück ◀─ BOM zurück ◀─────────────────┘
```

- **Erkennen.** Ein BOM ist maßgeblich (`encodingSource: 'bom'`). Ohne BOM rät
  `chardetng`, und das Raten wird als solches gemeldet (`'guessed'`) — ein
  Ratespiel, das der Nutzer nicht sieht, kann er auch nicht korrigieren. Wer die
  Datei mit einer gewählten Codepage neu öffnet, bekommt `'forced'`.
- **Dekodieren.** `encoding_rs` macht die Arbeit. Zwei Flaggen kommen mit:
  `lossy` (es gab Ersatzzeichen — die Vermutung war falsch oder es ist kein
  Text) und `binary` (NUL-Bytes im ersten Block). Beide öffnen die Datei
  trotzdem und warnen. Stilles Verstümmeln ist das Schlimmste, was ein Editor
  tun kann.
- **Normalisieren.** Im Editor ist alles `\n`; das Original steht als `eol` in
  den Metadaten. Gemischte Zeilenenden gewinnt die Mehrheit, und die
  Statusleiste sagt es einmal.
- **Schreiben.** Kodieren, `eol` zurück, BOM zurück. „UTF-8 mit BOM" ist eine
  Checkbox neben dem Encoding, keine eigene Codepage.

**Stamps.** `FileStamp` ist `{ mtimeMs, size, readOnly }` — wie die Datei
aussah, als wir sie zuletzt gelesen oder geschrieben haben. Jedes Speichern
schickt den Stamp mit, den der Editor für aktuell hält; Rust vergleicht, bevor
es schreibt, und verweigert mit `kind: 'changed'`, wenn er nicht passt. Erst
dann gibt es eine echte Auswahl — neu laden, überschreiben, vergleichen —
statt einer stillen Zerstörung dessen, was der Compiler, der Formatter oder das
andere Fenster gerade geschrieben hat.

**Atomar schreiben.** Temporärdatei im selben Verzeichnis, flushen, über das
Ziel umbenennen. Im selben Verzeichnis, weil ein Rename über Laufwerksgrenzen
eine Kopie und damit nicht atomar ist. Ein Absturz mitten im Schreiben lässt die
alte Datei heil, nicht eine halbe.

---

## 6. Features

### Phase 1 — das, was gebaut wird

- **Tabs und Splits.** Der Split ist ein Baum: rechts teilen, unten teilen, eine
  Hälfte nochmal teilen. Notepad++' zwei Views sind derselbe Baum, eine Ebene
  tief. Tabs ziehen zwischen Panes um.
- **Ein Dokument lebt in genau einem Pane.** Eine schon offene Datei wird dort
  gezeigt, wo sie ist, statt doppelt geöffnet zu werden — zwei Editoren auf
  einem Puffer müssten sich einen `EditorState` teilen, und das schenkt
  CodeMirror einem nicht. „In andere Ansicht klonen" ist deshalb Phase 2.
- **Dateibaum** in der Sidebar, optional. Ein Ordner ist eine Bequemlichkeit,
  keine Voraussetzung. Umbenennen, anlegen, in den Papierkorb legen, im Explorer
  zeigen.
- **Statusleiste als Bedienelement**, nicht als Beschriftung: Encoding,
  Zeilenende, Sprache und Cursorposition sind je einen Klick vom Ändern
  entfernt. Das ist die halbe Existenzberechtigung dieser App.
- **Suchen und Ersetzen** im Dokument als Leiste (nie als Modal) und über einen
  Ordner als Panel. Regex, Groß-/Kleinschreibung, ganzes Wort, Include- und
  Exclude-Globs, `.gitignore` respektiert. Treffer strömen herein, während der
  Lauf noch läuft.
- **Ersetzen wiederholt den Lauf nicht.** Ersetzt wird genau in den Dateien, die
  der Nutzer in der Trefferliste gesehen hat. Eine Datei, die zwischen Suche und
  Klick aufgetaucht ist, darf keine Überraschung werden.
- **Sitzung und Entwürfe**: Fenster kommt zurück, wie es war, inklusive
  Split-Layout, Cursorpositionen und ungespeicherter Texte.
- **Kommandopalette** (`Ctrl+Shift+P`) und Datei-Sprung (`Ctrl+P`). Jedes
  Kommando hat einen Titel, eine Gruppe, optional ein Kürzel und weiß selbst, ob
  es gerade sinnvoll ist.
- **Sprachen und Themes**: die üblichen Verdächtigen gebündelt, nachgeladen bei
  Bedarf, plus die Möglichkeit, für ein Dokument von Hand etwas anderes zu
  wählen.
- **Einstellungen**: Darstellung, Schrift, Einrücken, Zeilenumbruch, Cursor,
  Speicherverhalten, Autosave, Standard-Encoding, Sitzung wiederherstellen,
  Git-Marker, Töne.
- **Deutsch und Englisch.** Deutsch ist die Quellsprache.

### Phase 2 — geplant

- **Plugin-Schnittstelle nach außen.** Die Registry gibt es schon und sie trägt
  bereits die gebündelten Nicht-Kern-Features. Nach außen zu öffnen heißt: ein
  Ordner, ein Manifest, eine Version, die die App ablehnen darf, und eine
  ehrliche Antwort darauf, was ein Plugin anfassen darf. Eine CodeMirror-
  `Extension` ist eine große Fläche, die man Fremden verspricht.
- **Makros aufzeichnen und abspielen.** Das Notepad++-Feature, das mir am
  meisten fehlt. CodeMirror-Transaktionen sind die richtige Einheit zum
  Aufzeichnen; die Arbeit steckt darin, welche man behält.
- **Git-Diff im Gutter.** `git_statuses` liefert schon, welche Dateien Git
  erwähnenswert findet. Der Gutter braucht mehr: den Blob gegen den Puffer
  gediffed, als anklickbare Marken. Grün und Bernstein, nie Pink.
- **In andere Ansicht klonen.** Dieselbe Datei in zwei Panes, jede mit eigener
  Auswahl und eigenem Scroll, beide auf einem State.
- **Großdatei-Modus.** Ein 400-MB-Log soll aufgehen — ohne Highlighting, ohne
  Minimap, aber scrollbar und mit Sprung zur Zeile. Das heißt: häppchenweise
  lesen auf der Rust-Seite und ein Dokument, das weiß, dass es unvollständig
  ist.
- **Mehr Suite-Themes**, und wichtiger: ein Theme-Format, das Daten sind und
  nicht Code.
- **macOS, Linux, irgendwann Android**, ein **UwU-Suite-Launcher**. Details in
  [`docs/roadmap.md`](docs/roadmap.md).

---

## 7. Designsprache

Goth-clean mit pinken Highlights. Dunkel ist Default — anders als bei den
Geschwistern, weil man in einen Editor stundenlang hineinschaut. Die volle
Tabelle steht in [`docs/design.md`](docs/design.md).

| Token              | Hell      | Dunkel    |
| ------------------ | --------- | --------- |
| `--uwu-canvas`     | `#f8f4f6` | `#141016` |
| `--uwu-surface`    | `#ffffff` | `#1c171f` |
| `--uwu-ink`        | `#1c1420` | `#f8f2f6` |
| `--uwu-pink`       | `#ff4d8d` | `#ff7fac` |
| `--uwu-pink-solid` | `#e11d74` | `#ff7fac` |
| `--uwu-deep`       | `#ffffff` | `#0e0b11` |

**Zwei Pinks**, aus demselben Grund wie bei UwUMail: weißer Text auf `#ff4d8d`
schafft nur 3,1:1, gefüllte Buttons brauchen deshalb `#e11d74` (4,5:1, WCAG AA).
Das hellere Marken-Pink bleibt für alles, was kein kleiner Text auf pinker
Fläche ist — Cursor, Focus-Ring, die 1-px-Kante am aktiven Tab.

**`--uwu-deep` ist neu und der Kern des Ganzen.** Im Dunkelmodus ist es
_dunkler_ als `--uwu-canvas`, nicht heller: der Text liegt am Boden des
Fensters, die Chrome schwebt darüber. Daher kommt „goth, nicht pastell".

- **Pink heißt „dieses hier"** — ausgewählt, aktiv, fokussiert, gefunden.
  Gespeichert ist Mint, geändert ist Bernstein, gelöscht ist Rot. Ein Editor,
  der Pink auch für „ungespeichert" benutzt, hat nichts erklärt.
- **Im Syntax-Highlighting ist Pink für Keywords reserviert.** Das ist das eine,
  was das Auge beim Überfliegen zuerst finden soll, und der einzige Ort, an dem
  die Marke _im_ Text etwas zu suchen hat.
- **Manrope** für die Oberfläche, **JetBrains Mono** und **Fira Code** im Editor.
  Radien 10 px für Controls, 16 px für Karten, 999 px für Pills, 4-px-Raster.
  Der Editor selbst hat keinen Radius: abgerundete Ecken auf einer Textfläche
  fressen das erste Zeichen von Zeile eins.
- **Custom Titlebar**, keine OS-Chrome-Kante. Die Sidebar klappt mit einem
  Tastendruck weg, weil Vollbild-Text so nah sein muss.

### Nyu

Dieselbe Katze wie in UwUMail und UwUSSH — aus dem Briefumschlag wurde dort ein
Terminal, hier wird er zum **Notizblock**: ein Block mit Spiralbindung von vorn,
die Ohren gucken oben heraus, und die Seite ist das Gesicht mit UwU-Augen,
`w`-Mund und Blush. Ein pinker Cursor blinkt neben dem Mund, als würde sie gleich
losschreiben.

Sticker-Stil unverändert: Pflaumen-Outlines `#4B1D3F`, pinker Body `#FF6FA6`,
helle Seite `#FFB8D3`, weiße Die-Cut-Kante. Als App-Icon eine **dunkle
Pflaumen-Kachel** mit pinkem Notizblock, Ohren, einer Linierung, einem gelben
Stift und einem Funkeln — damit man sie in der Taskleiste bei 16 px nicht mit
UwUMail verwechselt. Quellen in `brand/` und
`apps/desktop/src/components/nyu/`.

**Bewegung:** Einstellungen → Darstellung → Animationen (System / An / Aus) löst
nach `<html data-motion="reduced">` auf; dann fällt jede Transition auf 1 ms und
Nyu steht still.

**Töne** sind standardmäßig aus und bleiben es. Ein Glöckchen beim Speichern ist
in der Demo charmant und in Stunde drei einer Datei, die man alle zwölf Sekunden
speichert, unerträglich.

### Tonfall

Verspielt als Default. **Einstellungen → Tonfall → Neutral** tauscht die Worte,
nie Layout oder Farben.

| Situation         | Neutral                             | Verspielt                               |
| ----------------- | ----------------------------------- | --------------------------------------- |
| Nichts offen      | Keine Datei geöffnet                | Ganz schön leer hier (・_・;)           |
| Gespeichert       | Gespeichert                         | Gespeichert ✨                          |
| Keine Treffer     | Keine Treffer                       | Nichts gefunden (・_・;)                |
| Sitzung zurück    | Sitzung wiederhergestellt           | Alles wieder da (๑˃ᴗ˂)ﻭ                 |
| Entwürfe gerettet | 3 nicht gespeicherte Dateien zurück | Hab deine 3 Entwürfe aufgehoben (๑˃ᴗ˂)ﻭ |

**Die harte Ausnahme: Warnungen und Fehler sind nie verspielt**, in beiden
Tonfällen. In einem Editor heißt das präzise: alles, was Text kosten kann, ist
schmucklos. Eine Datei überschreiben, die sich auf der Platte geändert hat,
einen ungespeicherten Puffer schließen, über einen Ordner ersetzen, eine
verlustbehaftet dekodierte Datei speichern — kein Kaomoji, keine Nyu, kein
Ausrufezeichen. Buttons sagen, was sie tun: `Löschen` bleibt `Löschen`.

Deutsch ist die Quellsprache, und sie duzt.

---

## 8. Mehrsprachigkeit

Jeder sichtbare String steht auf Deutsch dort, wo er benutzt wird, in `t()`.
Der englische Katalog in `src/i18n/en/` bildet deutschen String auf englischen
ab; ohne Eintrag bleibt der String deutsch.

Die Richtung ist ungewöhnlich und Absicht: der Schlüssel ist der Satz selbst,
also liest man im Code den echten Satz statt `settings.editor.tabSize.label`,
und eine fehlende Übersetzung degradiert zu einem richtigen Satz in der falschen
Sprache statt zu einem Bezeichner in der Oberfläche. Der Preis — ein deutscher
String lässt sich nicht nebenbei umformulieren, er ist der Schlüssel — wird von
`scripts/check-i18n.mjs` bezahlt: läuft in `pnpm lint`, findet jedes `t()`- und
`N_()`-Literal, meckert über jeden fehlenden englischen Eintrag, über denselben
deutschen String mit zwei verschiedenen Übersetzungen und über Katalogeinträge,
die niemand mehr benutzt.

`N_()` gibt es für Strings in Konstanten auf Modulebene, die entstehen, bevor
eine Sprache feststeht. Zur Laufzeit tut es nichts; es markiert den String für
die Prüfung, und `t()` passiert dort, wo er angezeigt wird.

---

## 9. Repos und Aufbau

| Pfad                      | Was dort lebt                                                  |
| ------------------------- | -------------------------------------------------------------- |
| `apps/desktop`            | Die Tauri-2-App: React-Oberfläche, CodeMirror-Kern, Rust-Shell |
| `packages/uwu-tokens`     | `@uwu/tokens` — die Palette der ganzen Suite                   |
| `crates/uwunotes-fs`      | Bytes: Encoding, atomare Writes, Baum, Dateisuche              |
| `crates/uwunotes-session` | Sitzungsdatei, Entwürfe, Zuletzt-Listen                        |
| `brand/`                  | Nyu im Notizblock-Körper: App-Icon, Symbol, Mono-Symbol        |
| `docs/`                   | Vision, Architektur, Design, Roadmap                           |
| `scripts/`                | Die Übersetzungsprüfung                                        |

Ein Repo, ein pnpm-Workspace, ein Cargo-Workspace. Kein Server, kein zweites
Repo, nichts, was betrieben werden müsste.

---

## 10. Stand und offene Punkte

**Stand: 0.1.0, nichts veröffentlicht.** Es gibt keinen Download, kein Setup,
kein Release. Was es gibt, ist dieses Repository: die Tauri-Shell, die
Rust-Crates, das Token-Paket und das TypeScript-Rückgrat, auf dem der Editor
gebaut wird.

Offene Entscheidungen, die noch niemand getroffen hat:

- **Minimap ja oder nein?** Sie ist in den Einstellungen vorgesehen und
  standardmäßig aus. Ob sie in einem Editor, der bewusst keine IDE ist, ihren
  Platz verdient, entscheidet sich, wenn sie einmal da ist.
- **Autovervollständigung wie weit?** Wörter aus der Datei sind sicher, Snippets
  wahrscheinlich, alles darüber wäre der erste Schritt Richtung IDE.
- **Wie viel Git?** Marker im Gutter und am Tab sind geplant. Mehr als das —
  stagen, committen — wäre ein zweites Programm im ersten.
- **Setup und Updates.** Die Geschwister haben ein eigenes Installer-Projekt.
  Ob UwUNotes das erbt oder erst einmal als portables Verzeichnis ausgeliefert
  wird, ist offen.

---

## Nächster Schritt

Phase 1 fertig bauen, selbst benutzen, und alles wegwerfen, was sich dabei als
Unfug herausstellt.
