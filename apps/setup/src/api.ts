/**
 * The wire to the setup's engine, and the only file in this page that knows
 * Tauri exists.
 *
 * The six commands in `src-tauri/src/app.rs` are the whole contract, and a
 * test over there reads this folder and fails if a name here is not one of
 * them — an `invoke` of a command that does not exist compiles cleanly and
 * fails in front of the user, so the spelling is checked by a machine.
 *
 * The second half is `previewApi`, which pretends. A page whose only home is
 * inside an installer is a page nobody can work on: `pnpm --filter
 * @uwunotes/setup dev` opens it in an ordinary browser, where `?mode=update`,
 * `?fail=inUse` and friends show the states that are otherwise hard to reach.
 * It never touches a file, and it never runs inside the setup itself.
 *
 * What this module deliberately does not do: translate. `SetupError.message`
 * arrives in English and factual, the page owns the German, and every decision
 * about wording stays in `texts.ts`.
 */

import { Channel, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Computed from what is installed, not from the command line. */
export type Mode = 'install' | 'update' | 'uninstall' | 'reinstall' | 'downgrade';

export interface SetupState {
  /** The version packed into this setup. */
  setupVersion: string;
  /** What is installed now, `null` when nothing is. */
  installedVersion: string | null;
  mode: Mode;
  defaultFolder: string;
  /** `false` in a build made without the editor inside. */
  hasPayload: boolean;
  /**
   * Started by an updater, with nobody in front of the screen. Such a run never
   * opens a window at all today, so a page that reads this reads `false`; it is
   * here so the page never has to assume the opposite of itself.
   */
  silent: boolean;
  /** What was chosen last time, so the checkbox can start where the user left it. */
  desktopShortcut: boolean;
}

export interface InstallOptions {
  folder: string;
  desktopShortcut: boolean;
  /**
   * Start the editor as soon as the files are written. The finish screen has a
   * button of its own, so the page sends `false` and keeps that decision where
   * the user can see it.
   */
  launchWhenDone: boolean;
}

export type Step = 'preparing' | 'writing' | 'shortcuts' | 'registry' | 'done';

export interface Progress {
  step: Step;
  /** 0 to 100 over the whole job, and only ever upwards. */
  percent: number;
}

export interface Installed {
  folder: string;
  exe: string;
}

export type ErrorKind =
  'inUse' | 'permission' | 'diskFull' | 'olderVersion' | 'noPayload' | 'other';

export interface SetupError {
  kind: ErrorKind;
  message: string;
}

const KINDS: readonly ErrorKind[] = [
  'inUse',
  'permission',
  'diskFull',
  'olderVersion',
  'noPayload',
  'other',
];

/**
 * Whatever a rejected command threw, as something the page can branch on.
 *
 * A `SetupError` comes across as a plain object and arrives here intact. A
 * panic, a dropped connection or a bug in this file does not, and the page
 * still has to put a sentence on the screen rather than nothing.
 */
export function toSetupError(reason: unknown): SetupError {
  if (typeof reason === 'object' && reason !== null && 'kind' in reason && 'message' in reason) {
    const { kind, message } = reason as { kind: unknown; message: unknown };
    if (typeof kind === 'string' && typeof message === 'string') {
      return {
        kind: (KINDS as readonly string[]).includes(kind) ? (kind as ErrorKind) : 'other',
        message,
      };
    }
  }
  return { kind: 'other', message: String(reason) };
}

export interface SetupApi {
  state(): Promise<SetupState>;
  install(options: InstallOptions, onProgress: (progress: Progress) => void): Promise<Installed>;
  uninstall(keepSettings: boolean): Promise<void>;
  launchApp(): Promise<void>;
  openExternal(url: string): Promise<void>;
  close(): Promise<void>;
  minimize(): Promise<void>;
}

const tauriApi: SetupApi = {
  state: () => invoke<SetupState>('setup_state'),
  install: (options, onProgress) => {
    const channel = new Channel<Progress>();
    channel.onmessage = onProgress;
    return invoke<Installed>('install', { options, onProgress: channel });
  },
  uninstall: (keepSettings) => invoke<void>('uninstall', { keepSettings }),
  launchApp: () => invoke<void>('launch_installed_app'),
  openExternal: (url) => invoke<void>('open_external', { url }),
  // Not `getCurrentWindow().close()`: the uninstaller is running from a copy of
  // itself in the temp folder, and this is what remembers to delete it.
  close: () => invoke<void>('close_setup'),
  minimize: () => getCurrentWindow().minimize(),
};

/** Pretends to install, for working on the page in a normal browser. */
function previewApi(): SetupApi {
  const parameters = new URLSearchParams(window.location.search);
  const mode = (parameters.get('mode') as Mode | null) ?? 'install';
  const folder = 'C:\\Users\\Nyu\\AppData\\Local\\Programs\\UwUNotes';
  const fail = parameters.get('fail');

  const pretend = async (onProgress: (progress: Progress) => void) => {
    const steps: Step[] = ['preparing', 'writing', 'writing', 'shortcuts', 'registry'];
    for (let percent = 0; percent <= 100; percent += 2) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const step = steps[Math.min(steps.length - 1, Math.floor((percent / 100) * steps.length))];
      onProgress({ step: step ?? 'writing', percent });
    }
    if (fail) throw { kind: fail, message: `Couldn't write ${folder}\\UwUNotes.exe (os error 32)` };
  };

  return {
    state: async () => ({
      setupVersion: '0.3.0',
      installedVersion: mode === 'install' ? null : mode === 'downgrade' ? '0.4.0' : '0.2.0',
      mode,
      defaultFolder: folder,
      hasPayload: !parameters.has('empty'),
      silent: parameters.has('silent'),
      desktopShortcut: true,
    }),
    install: async (_options, onProgress) => {
      await pretend(onProgress);
      return { folder, exe: `${folder}\\UwUNotes.exe` };
    },
    uninstall: async () => {
      await pretend(() => undefined);
    },
    launchApp: async () => undefined,
    openExternal: async (url) => void window.open(url, '_blank', 'noopener'),
    close: async () => window.location.reload(),
    minimize: async () => undefined,
  };
}

export const api: SetupApi = '__TAURI_INTERNALS__' in window ? tauriApi : previewApi();
