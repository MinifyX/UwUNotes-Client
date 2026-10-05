/**
 * The menus in the macOS menu bar, built from the same data as the in-app row.
 *
 * On macOS the page shows no menu row (`components/TitleBar.tsx`). Instead the
 * tree in `lib/menus.ts` is walked here, written out as plain data and handed
 * to Rust (`src-tauri/src/menu.rs`), which builds a native menu from it. A
 * click comes back as a `native-menu` event carrying the entry's id; the tree
 * is walked again and that entry's own `run` is called — the same function the
 * in-app menu calls, so there is still exactly one code path per command.
 *
 * Around the app's menus come the ones every Mac app has: the app menu (About,
 * Settings ⌘,, Services, Hide, Quit), Bearbeiten with the system's own undo,
 * cut, copy, paste and select-all — so they work in every text field, not only
 * in the editor — Fenster, and Hilfe.
 *
 * **Keyboard shortcuts.** The app's table (`lib/shortcuts.ts`) is written for
 * Ctrl. Here every Ctrl becomes ⌘, and the menu item carries it as a real
 * accelerator, so the menu shows ⌘S and macOS answers ⌘S. The page's own
 * keydown listener only ever answers Ctrl chords *without* ⌘, so a ⌘ chord has
 * exactly one listener: the menu. (Ctrl+S, with the Control key, keeps working
 * through the page, as before; nothing is lost.) The function keys are the one
 * overlap — F2, F8 and F11 carry no modifier for either side to tell them
 * apart — so while this menu is installed the page stops answering them
 * (`setFunctionKeysNative`) and the menu has them alone. The other way round,
 * leaving the keys to the page and not registering them natively, would show
 * a menu with no shortcuts in it.
 *
 * A few of the app's chords mean something else on a Mac, and move:
 * ⌘H hides the app (Ersetzen goes to ⌥⌘F, as in every Mac editor), ⌘⇧Q logs
 * out (closing a pane keeps no key), ⌘⇧3 takes a screenshot (the column
 * layouts go to ⌥⌘2 and ⌥⌘3). And an accelerator is only given once: the
 * app menu's ⌘, wins over the Einstellungen menu's.
 *
 * **Keeping it current.** The in-app lists are built when they open; a native
 * menu is built once and shown as it is. So it is rebuilt — debounced, and only
 * sent when something actually changed — whenever a store a menu reads from
 * changes (`components/NativeMenu.tsx` subscribes to them all), after each
 * click on it, and when the window gets the focus back, which catches
 * anything no store announces.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { runCommand } from './commands';
import { N_, t } from './i18n';
import { MENUS, type MenuEntry, type TopMenu } from './menus';
import { KEY_CTRL, KEY_SHIFT, setFunctionKeysNative, shortcutKeys } from './shortcuts';

/* ── The data Rust gets ────────────────────────────────── */

/** Items macOS draws and runs itself. */
export type NativeRole =
  | 'services'
  | 'hide'
  | 'hideOthers'
  | 'showAll'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'minimize'
  | 'zoom'
  | 'fullscreen'
  | 'bringAllToFront';

export type NativeEntry =
  | {
      kind: 'item';
      id: string;
      label: string;
      accelerator: string | null;
      enabled: boolean;
      /** `null`: a plain item. A boolean: a check item, ticked or not. */
      checked: boolean | null;
    }
  | { kind: 'separator' }
  | { kind: 'predefined'; role: NativeRole; label: string | null }
  | {
      kind: 'submenu';
      label: string;
      enabled: boolean;
      /** Fenster and Hilfe get macOS's own extras: the window list, the help search. */
      role: 'window' | 'help' | null;
      items: NativeEntry[];
    };

export type NativeMenu = {
  /** What the page runs for each clickable id. Not sent to Rust. */
  actions: Map<string, () => void>;
  menus: Extract<NativeEntry, { kind: 'submenu' }>[];
};

/* ── Shortcuts ─────────────────────────────────────────── */

/** Chords that macOS has already taken, moved to keys that are free. `null`: no key at all. */
const MAC_KEYS: Record<string, string | null> = {
  // ⌘H hides the app.
  'find.replace': 'CmdOrCtrl+Alt+F',
  // ⌘⇧Q logs out of the Mac.
  'view.closePane': null,
  // ⌘⇧3 is a screenshot; ⌘⇧2 moves along for symmetry.
  'view.columns2': 'CmdOrCtrl+Alt+2',
  'view.columns3': 'CmdOrCtrl+Alt+3',
};

/**
 * The table's keys as an accelerator: `[Strg, Umschalt, S]` → `CmdOrCtrl+Shift+S`.
 * `CmdOrCtrl` rather than `Cmd` so the same string would mean Ctrl anywhere
 * else; the menu is only installed on macOS, where it is ⌘.
 */
export function acceleratorFromKeys(keys: readonly string[]): string {
  return keys
    .map((key) => {
      if (key === KEY_CTRL) return 'CmdOrCtrl';
      if (key === KEY_SHIFT) return 'Shift';
      return key;
    })
    .join('+');
}

/** The macOS accelerator for a command, or `null` when it has none there. */
export function macAccelerator(command: string): string | null {
  if (command in MAC_KEYS) return MAC_KEYS[command] ?? null;
  const keys = shortcutKeys(command);
  return keys ? acceleratorFromKeys(keys) : null;
}

/* ── Building ──────────────────────────────────────────── */

/** `&` marks a mnemonic in a native label; a literal one is written twice. */
function plain(label: string): string {
  return label.replace(/&/g, '&&');
}

type Builder = { actions: Map<string, () => void>; usedKeys: Set<string> };

function item(
  builder: Builder,
  id: string,
  label: string,
  run: () => void,
  options: { accelerator?: string | null; enabled?: boolean; checked?: boolean } = {},
): NativeEntry {
  builder.actions.set(id, run);
  let accelerator = options.accelerator ?? null;
  if (accelerator) {
    const key = accelerator.toLowerCase();
    if (builder.usedKeys.has(key)) accelerator = null;
    else builder.usedKeys.add(key);
  }
  return {
    kind: 'item',
    id,
    label: plain(label),
    accelerator,
    enabled: options.enabled ?? true,
    checked: options.checked ?? null,
  };
}

function entries(builder: Builder, path: string, list: readonly MenuEntry[]): NativeEntry[] {
  const out: NativeEntry[] = [];
  for (const entry of list) {
    if (entry.kind === 'separator') {
      // macOS draws doubled and edge separators as they are; drop them here.
      if (out.length > 0 && out[out.length - 1]!.kind !== 'separator') {
        out.push({ kind: 'separator' });
      }
      continue;
    }
    const id = `${path}/${entry.id}`;
    if (entry.kind === 'submenu') {
      out.push({
        kind: 'submenu',
        label: plain(entry.label),
        enabled: !entry.disabled,
        role: null,
        items: entry.disabled ? [] : entries(builder, id, entry.items()),
      });
      continue;
    }
    out.push(
      item(builder, id, entry.label, entry.run, {
        // Only an entry that shows a shortcut in the app gets one here, so
        // a recent file never inherits a command's key by sharing its id.
        accelerator: entry.shortcut ? macAccelerator(entry.id) : null,
        enabled: !entry.disabled,
        checked: entry.checked,
      }),
    );
  }
  while (out.length > 0 && out[out.length - 1]!.kind === 'separator') out.pop();
  return out;
}

function predefined(role: NativeRole, label: string | null = null): NativeEntry {
  return { kind: 'predefined', role, label };
}

const separator: NativeEntry = { kind: 'separator' };

/**
 * The whole menu bar: the app menu, Bearbeiten, the app's own menus in their
 * order, Fenster and Hilfe. Pure apart from reading the stores the menus read,
 * so a test can check what a Mac would show.
 *
 * `quit` is the page's own: the app menu's Beenden must go through the
 * window's close request like the close button does, so the session and the
 * drafts are written first. macOS's own Quit would end the process without.
 */
export function buildNativeMenu(
  menus: readonly TopMenu[] = MENUS,
  quit: () => void = () => void getCurrentWindow().close(),
): NativeMenu {
  const builder: Builder = { actions: new Map(), usedKeys: new Set() };
  const command = (id: string, label: string, path = 'app') =>
    item(builder, `${path}/${id}`, label, () => runCommand(id), {
      accelerator: macAccelerator(id),
    });

  const appMenu: NativeEntry = {
    kind: 'submenu',
    label: 'UwUNotes',
    enabled: true,
    role: null,
    items: [
      command('app.about', t('Über UwUNotes')),
      separator,
      command('app.settings', t('Einstellungen…')),
      separator,
      predefined('services', t('Dienste')),
      separator,
      predefined('hide', t('UwUNotes ausblenden')),
      predefined('hideOthers', t('Andere ausblenden')),
      predefined('showAll', t('Alle einblenden')),
      separator,
      item(builder, 'app/quit', t('UwUNotes beenden'), quit, { accelerator: 'CmdOrCtrl+Q' }),
    ],
  };

  const editMenu: NativeEntry = {
    kind: 'submenu',
    label: t(N_('Bearbeiten')),
    enabled: true,
    role: null,
    items: [
      predefined('undo', t('Rückgängig')),
      predefined('redo', t('Wiederholen')),
      separator,
      predefined('cut', t('Ausschneiden')),
      predefined('copy', t('Kopieren')),
      predefined('paste', t('Einfügen')),
      predefined('selectAll', t('Alles auswählen')),
    ],
  };

  const own = menus.map((menu): Extract<NativeEntry, { kind: 'submenu' }> => ({
    kind: 'submenu',
    label: plain(menu.label()),
    enabled: true,
    role: null,
    items: entries(builder, menu.id, menu.items()),
  }));

  const windowMenu: Extract<NativeEntry, { kind: 'submenu' }> = {
    kind: 'submenu',
    label: t('Fenster'),
    enabled: true,
    role: 'window',
    items: [
      predefined('minimize', t('Minimieren')),
      predefined('zoom', t('Zoomen')),
      separator,
      predefined('bringAllToFront', t('Alle nach vorne bringen')),
    ],
  };

  const helpMenu: Extract<NativeEntry, { kind: 'submenu' }> = {
    kind: 'submenu',
    label: t('Hilfe'),
    enabled: true,
    role: 'help',
    items: [
      command('app.palette', t('Befehlspalette…'), 'help'),
      command('nyu.open', t('Nyu-Zentrale öffnen…'), 'help'),
      separator,
      command('app.about', t('Über UwUNotes'), 'help'),
    ],
  };

  return {
    actions: builder.actions,
    menus: [
      appMenu as Extract<NativeEntry, { kind: 'submenu' }>,
      editMenu as Extract<NativeEntry, { kind: 'submenu' }>,
      ...own,
      windowMenu,
      helpMenu,
    ],
  };
}

/* ── Installing ────────────────────────────────────────── */

/** Long enough to fold a burst of store changes into one rebuild, short enough not to notice. */
const REBUILD_DELAY_MS = 120;

let installed = false;
let sent = '';
let timer = 0;

function send(): void {
  timer = 0;
  if (!installed) return;
  const { menus } = buildNativeMenu();
  const json = JSON.stringify(menus);
  if (json === sent) return;
  sent = json;
  void invoke('set_app_menu', { menus }).catch((error: unknown) => {
    // An out-of-date menu bar is worth a line in the log, and a retry next time.
    console.warn('native menu', error);
    sent = '';
  });
}

/**
 * Asks for a rebuild soon. Cheap to call often: calls within the delay fold
 * into one, and a rebuild that comes out the same is not sent.
 */
export function refreshNativeMenu(): void {
  if (installed && !timer) timer = window.setTimeout(send, REBUILD_DELAY_MS);
}

/**
 * Puts the menu into the macOS menu bar and answers its clicks. Returns the
 * teardown. Call only on macOS (`lib/platform.ts`): elsewhere the in-app row
 * is the menu, and Rust ignores the call anyway. What it is rebuilt on is up
 * to the caller (`components/NativeMenu.tsx` re-renders on the stores);
 * the window getting the focus back is handled here.
 */
export function installNativeMenu(): () => void {
  installed = true;
  sent = '';
  setFunctionKeysNative(true);
  send();
  window.addEventListener('focus', refreshNativeMenu);

  let gone = false;
  let unlisten: (() => void) | undefined;
  void listen<string>('native-menu', (event) => {
    // Walked again, not looked up in the last build: the entry runs with the
    // state of now — the file that is active now, the recent list of now.
    buildNativeMenu().actions.get(event.payload)?.();
    refreshNativeMenu();
  })
    .then((stop) => {
      if (gone) stop();
      else unlisten = stop;
    })
    .catch(() => undefined);

  return () => {
    gone = true;
    installed = false;
    window.clearTimeout(timer);
    timer = 0;
    setFunctionKeysNative(false);
    window.removeEventListener('focus', refreshNativeMenu);
    unlisten?.();
  };
}
