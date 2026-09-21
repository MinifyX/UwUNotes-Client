/**
 * Everything the setup says, in German and in English.
 *
 * The editor has `t()` and a catalogue of its own; this window deliberately has
 * neither. It is one page with forty strings in it, it runs once, and it must
 * work on a machine where UwUNotes is not installed yet — so there is no
 * settings file to read a language out of and nothing to load at run time. The
 * system language decides, once, and that is the whole mechanism.
 *
 * The same page runs on Windows, macOS and Linux. `de` and `en` are worded for
 * Windows; `textsFor` swaps in the handful of lines that name the system.
 *
 * What this module does NOT do: pick a tone for failures. The lines under
 * `errors` are plain on purpose. Nyu is allowed to be pleased when an install
 * works; when it does not, the user wants to know what went wrong and what to
 * try, in that order, and a joke is in the way of both.
 */

const de = {
  minimize: 'Minimieren',
  close: 'Schließen',
  soundOn: 'Ton an',
  soundOff: 'Ton aus',

  installTitle: 'UwUNotes einrichten',
  installBody: 'Ich lege den Editor in deinen Benutzerordner — ohne Administrator.',
  updateTitle: 'Auf {version} bringen',
  updateBody: 'Installiert ist {installed}. Einstellungen, Sitzung und Entwürfe bleiben liegen.',
  reinstallTitle: 'Noch einmal installieren',
  reinstallBody:
    '{version} ist schon da. Ich schreibe die Dateien frisch, sonst ändert sich nichts.',
  downgradeTitle: 'Ältere Version installieren',
  downgradeBody: 'Installiert ist {installed}, hier drin steckt {version}. Das geht rückwärts.',

  actionInstall: 'Installieren',
  actionUpdate: 'Aktualisieren',
  actionReinstall: 'Neu installieren',
  actionDowngrade: 'Trotzdem installieren',

  folder: 'Ordner',
  desktopShortcut: 'Verknüpfung auf dem Desktop',
  desktopShortcutHint: 'Im Startmenü liegt sie ohnehin.',

  workingInstall: 'Nyu richtet ein …',
  workingUpdate: 'Nyu tauscht die Dateien …',
  workingUninstall: 'Nyu räumt auf …',
  steps: {
    preparing: 'Ordner vorbereiten',
    writing: 'Dateien schreiben',
    shortcuts: 'Verknüpfungen anlegen',
    registry: 'Bei Windows eintragen',
    done: 'Fertig',
  },

  doneTitle: 'Fertig.',
  doneBody: 'UwUNotes liegt in {folder}.',
  updateDoneTitle: 'Aktualisiert.',
  updateDoneBody: 'UwUNotes ist jetzt {version}.',
  start: 'UwUNotes starten',

  errorTitles: {
    inUse: 'UwUNotes ist noch offen',
    permission: 'Kein Zugriff auf den Ordner',
    diskFull: 'Kein Platz mehr',
    olderVersion: 'Die installierte Version ist neuer',
    noPayload: 'In diesem Build steckt kein UwUNotes',
    other: 'Das hat nicht geklappt',
  },
  errorBodies: {
    inUse: 'Schließe den Editor und versuche es noch einmal. Nichts wurde geändert.',
    permission: 'Windows lässt das Schreiben dort nicht zu. Ein Ordner unter deinem Benutzer geht.',
    diskFull:
      'Auf dem Laufwerk ist kein Platz mehr frei. Mach etwas frei und versuche es noch einmal.',
    olderVersion: 'Es wurde nichts geändert. Die neuere Version bleibt installiert.',
    noPayload: 'Das ist ein Entwicklungs-Build ohne Editor darin. Es gibt nichts zu installieren.',
    other: 'Die Meldung darunter ist die von Windows.',
  },
  retry: 'Nochmal versuchen',

  uninstallTitle: 'UwUNotes entfernen',
  uninstallBody: 'Ich nehme den Editor wieder von diesem PC.',
  keepSettings: 'Einstellungen und Sitzung behalten',
  keepSettingsHint:
    'Praktisch, falls du wiederkommst. Sonst lösche ich auch die zuletzt geöffneten Dateien.',
  actionUninstall: 'Entfernen',
  keep: 'Doch behalten',
  goodbyeTitle: 'Entfernt.',
  goodbyeBody: 'Deine Dateien selbst liegen unangetastet, wo sie lagen.',

  devBuild: 'Entwicklungs-Build: kein Editor mit drin.',
  footer: 'Version {version}',
  project: 'Quelltext auf GitHub',
};

const en: typeof de = {
  minimize: 'Minimize',
  close: 'Close',
  soundOn: 'Sound on',
  soundOff: 'Sound off',

  installTitle: 'Set up UwUNotes',
  installBody: 'I put the editor in your user folder — no administrator needed.',
  updateTitle: 'Bring it to {version}',
  updateBody: '{installed} is installed. Settings, session and drafts stay where they are.',
  reinstallTitle: 'Install it again',
  reinstallBody: '{version} is already here. I write the files fresh, nothing else changes.',
  downgradeTitle: 'Install an older version',
  downgradeBody: '{installed} is installed, {version} is packed in here. That is a step back.',

  actionInstall: 'Install',
  actionUpdate: 'Update',
  actionReinstall: 'Reinstall',
  actionDowngrade: 'Install anyway',

  folder: 'Folder',
  desktopShortcut: 'Shortcut on the desktop',
  desktopShortcutHint: 'The Start menu gets one either way.',

  workingInstall: 'Nyu is setting up …',
  workingUpdate: 'Nyu is swapping the files …',
  workingUninstall: 'Nyu is tidying up …',
  steps: {
    preparing: 'Preparing the folder',
    writing: 'Writing files',
    shortcuts: 'Making shortcuts',
    registry: 'Registering with Windows',
    done: 'Done',
  },

  doneTitle: 'Done.',
  doneBody: 'UwUNotes is in {folder}.',
  updateDoneTitle: 'Updated.',
  updateDoneBody: 'UwUNotes is {version} now.',
  start: 'Start UwUNotes',

  errorTitles: {
    inUse: 'UwUNotes is still open',
    permission: 'No access to that folder',
    diskFull: 'No room left',
    olderVersion: 'The installed version is newer',
    noPayload: 'This build has no UwUNotes in it',
    other: "That didn't work",
  },
  errorBodies: {
    inUse: 'Close the editor and try again. Nothing was changed.',
    permission: 'Windows does not allow writing there. A folder under your user account will work.',
    diskFull: 'The drive is full. Free some space and try again.',
    olderVersion: 'Nothing was changed. The newer version stays installed.',
    noPayload:
      'This is a development build without the editor inside. There is nothing to install.',
    other: "The line below is Windows' own.",
  },
  retry: 'Try again',

  uninstallTitle: 'Remove UwUNotes',
  uninstallBody: 'I take the editor off this PC again.',
  keepSettings: 'Keep settings and session',
  keepSettingsHint: 'Handy if you come back. Otherwise I also delete the list of recent files.',
  actionUninstall: 'Remove',
  keep: 'Keep it',
  goodbyeTitle: 'Removed.',
  goodbyeBody: 'Your own files are untouched, exactly where they were.',

  devBuild: 'Development build: no editor packed in.',
  footer: 'Version {version}',
  project: 'Source on GitHub',
};

export type Texts = typeof de;

export const texts: Texts = navigator.language.toLowerCase().startsWith('de') ? de : en;

export const isGerman = texts === de;

/** What `app.rs` reports as `platform` in the setup's state. */
export type Platform = 'windows' | 'macos' | 'linux';

/** A few lines of `Texts`, one level deep: `steps` may name only one step. */
type Overrides = {
  [Key in keyof Texts]?: Texts[Key] extends string ? string : Partial<Texts[Key]>;
};

/**
 * The lines that say something about the system, for the systems that are not
 * Windows. Everything above is written for Windows and stays true everywhere
 * else except these: where the editor goes, what a shortcut is called, who is
 * being told about it, and whose error message sits under a failure. Nyu, the
 * scenes and the flow are the same on all three.
 */
const deOn: Record<Exclude<Platform, 'windows'>, Overrides> = {
  macos: {
    installBody: 'Ich lege den Editor in deinen eigenen Programme-Ordner — ohne Administrator.',
    desktopShortcut: 'Alias auf dem Schreibtisch',
    desktopShortcutHint: 'Launchpad und Spotlight finden UwUNotes ohnehin.',
    steps: { shortcuts: 'Alias anlegen', registry: 'Bei macOS anmelden' },
    errorBodies: {
      permission:
        'macOS lässt das Schreiben dort nicht zu. Prüf die Rechte deines Programme-Ordners.',
      other: 'Die Meldung darunter ist die des Systems.',
    },
    uninstallBody: 'Ich nehme den Editor wieder von diesem Mac.',
  },
  linux: {
    installBody: 'Ich lege den Editor in deinen Home-Ordner — ohne root.',
    desktopShortcutHint: 'Einen Eintrag im Anwendungsmenü gibt es ohnehin.',
    steps: { shortcuts: 'Menüeintrag anlegen', registry: 'Beim Desktop anmelden' },
    errorBodies: {
      permission:
        'Das System lässt das Schreiben dort nicht zu. Prüf die Rechte deines Home-Ordners.',
      other: 'Die Meldung darunter ist die des Systems.',
    },
    uninstallBody: 'Ich nehme den Editor wieder von diesem Rechner.',
  },
};

const enOn: Record<Exclude<Platform, 'windows'>, Overrides> = {
  macos: {
    installBody: 'I put the editor in your own Applications folder — no administrator needed.',
    desktopShortcut: 'Alias on the desktop',
    desktopShortcutHint: 'Launchpad and Spotlight find UwUNotes either way.',
    steps: { shortcuts: 'Making the alias', registry: 'Telling macOS about it' },
    errorBodies: {
      permission:
        'macOS does not allow writing there. Check the permissions of your Applications folder.',
      other: "The line below is the system's own.",
    },
    uninstallBody: 'I take the editor off this Mac again.',
  },
  linux: {
    installBody: 'I put the editor in your home folder — no root needed.',
    desktopShortcutHint: 'The applications menu gets an entry either way.',
    steps: { shortcuts: 'Adding the menu entry', registry: 'Telling the desktop about it' },
    errorBodies: {
      permission:
        'The system does not allow writing there. Check the permissions of your home folder.',
      other: "The line below is the system's own.",
    },
    uninstallBody: 'I take the editor off this computer again.',
  },
};

/** `texts`, with the lines that name the system worded for `platform`. */
export function textsFor(platform: Platform): Texts {
  if (platform === 'windows') return texts;
  const overrides = (isGerman ? deOn : enOn)[platform];
  const merged: Record<string, unknown> = { ...texts };
  for (const [key, value] of Object.entries(overrides)) {
    const current = merged[key];
    merged[key] =
      typeof value === 'object' && typeof current === 'object' ? { ...current, ...value } : value;
  }
  return merged as Texts;
}

/** `fill('Auf {version} bringen', { version: '0.3.0' })`. A missing key becomes nothing. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}
