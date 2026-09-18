/**
 * The plugin registry: optional behaviour the user can switch on.
 *
 * A plugin is still deliberately small — an id, a label, a German sentence
 * saying what it does, a default — but it now has two ways of being useful
 * instead of one: a `build()` returning a CodeMirror `Extension`, and a list of
 * commands for the palette. Either half may be missing. A plugin that is only
 * commands never appears in the editor's configuration at all and costs a
 * document nothing; a plugin that is only a `build()` is exactly what Phase 1
 * shipped, and none of those had to be touched for this.
 *
 * What a plugin still cannot do is bring UI of its own — a panel, a menu, a
 * settings field, a status bar item. That is the point: every plugin is listed
 * and toggled by the same piece of settings UI and found in the same palette,
 * so a user who has never read this file knows where all of them are.
 *
 * ## Adding a plugin
 *
 * 1. Write it next to `builtin.ts` (or in `builtin.ts` if it is a few lines).
 * 2. `registerPlugin({ id, name, description, defaultEnabled, build, commands })`,
 *    with `build` or `commands` or both. Wrap `name` and `description` in
 *    `N_()` — they are module-level constants, so the catalogue scanner finds
 *    them there and the UI passes them through `t()` when it renders them.
 * 3. Import the module from `editor/setup.ts` so registration happens before
 *    the first state is built. That is the whole wiring.
 *
 * `build()` is called every time the editor is reconfigured, so it must be
 * cheap and must not hold state between calls — anything a plugin needs to
 * remember belongs in a `StateField` inside the extension it returns. A
 * command's `run()` is called once, much later, from wherever the user invoked
 * it, so it has to find its own editor through `lib/views.ts` rather than
 * capture one.
 *
 * Command ids are not namespaced here. They land next to the app's own commands
 * in `lib/commands.ts`, where an id has to be unique and stays stable long
 * enough for a keyboard shortcut to point at it, so the convention is that a
 * plugin's command ids begin with the plugin's id.
 *
 * Which plugins are on is kept here rather than in `lib/settings.ts`: the set
 * of ids is open-ended, and `Settings` is a closed record with a validator
 * that would have to be edited for every new plugin. What this module does not
 * do is decide *when* to apply a change; it announces, and `editor/setup.ts`
 * reconfigures.
 */

import type { Extension } from '@codemirror/state';

/** One entry a plugin contributes to the command palette. */
export type PluginCommand = {
  /** Stable, and by convention prefixed with the plugin's id. */
  id: string;
  /** A function, because the palette can be open while the language changes. */
  title: () => string;
  run: () => void | Promise<void>;
};

export type UwuPlugin = {
  /** Stable: it is what gets written to storage. */
  id: string;
  /** German, via `N_()`. The UI translates it. */
  name: string;
  /** German, via `N_()`. One sentence, shown under the switch. */
  description: string;
  defaultEnabled: boolean;
  /** Optional: a plugin may contribute nothing but commands. */
  build?: () => Extension;
  /** Optional: surfaced in the command palette while the plugin is enabled. */
  commands?: PluginCommand[];
};

/** Insertion order, which is the order the settings page lists them in. */
const plugins: UwuPlugin[] = [];
const listeners = new Set<() => void>();

const KEY = 'uwunotes.plugins';

/**
 * Only the *deviations* from each plugin's default are stored. A plugin added
 * in a later version then arrives with its own default switched on, instead of
 * being silently off because it was missing from a list written last year — and
 * a default we change our minds about later still reaches everyone who never
 * touched the switch.
 */
let overrides: Record<string, boolean> = loadOverrides();

/** Bumped by {@link announce}, so a `useSyncExternalStore` has something cheap to compare. */
let version = 0;

function loadOverrides(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const clean: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') clean[id] = value;
    }
    return clean;
  } catch {
    // A hand-edited or unavailable store means "everything at its default",
    // which is a working editor rather than a broken one.
    return {};
  }
}

function announce() {
  version += 1;
  for (const listener of listeners) listener();
}

/** Registering the same id twice replaces it in place, keeping its position. */
export function registerPlugin(plugin: UwuPlugin): void {
  const index = plugins.findIndex((known) => known.id === plugin.id);
  if (index >= 0) plugins[index] = plugin;
  else plugins.push(plugin);
  announce();
}

export function allPlugins(): UwuPlugin[] {
  return [...plugins];
}

export function pluginById(id: string): UwuPlugin | undefined {
  return plugins.find((plugin) => plugin.id === id);
}

/** Whether a plugin is on right now: its default, unless the user said otherwise. */
export function pluginEnabled(id: string): boolean {
  const override = overrides[id];
  if (typeof override === 'boolean') return override;
  return pluginById(id)?.defaultEnabled ?? false;
}

export function enabledPluginIds(): ReadonlySet<string> {
  return new Set(plugins.filter((plugin) => pluginEnabled(plugin.id)).map((plugin) => plugin.id));
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  const plugin = pluginById(id);
  if (plugin && plugin.defaultEnabled === enabled) delete overrides[id];
  else overrides = { ...overrides, [id]: enabled };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(overrides));
  } catch {
    // Private storage can refuse; the change still holds for this run.
  }
  announce();
}

/** Fires when a plugin is registered or toggled. `setup.ts` reconfigures on it. */
export function subscribePlugins(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A counter that changes whenever {@link subscribePlugins} fires.
 *
 * `allPlugins()` and {@link pluginCommands} hand back a fresh array every call,
 * and `useSyncExternalStore` compares snapshots by identity, so passing either
 * one straight in is an infinite render loop. A number is the cheapest thing
 * that cannot be.
 */
export function pluginsVersion(): number {
  return version;
}

/**
 * The extensions of every enabled plugin, in registration order.
 *
 * A `build()` that throws takes only itself out: one broken optional feature
 * must not cost the user their editor, and the console keeps the evidence.
 */
export function pluginExtensions(enabled: ReadonlySet<string>): Extension {
  const built: Extension[] = [];
  for (const plugin of plugins) {
    if (!enabled.has(plugin.id) || !plugin.build) continue;
    try {
      built.push(plugin.build());
    } catch (error) {
      console.error(`Plugin ${plugin.id} failed to build`, error);
    }
  }
  return built;
}

/**
 * The commands of every enabled plugin, in registration order, for
 * `lib/commands.ts` to fold into the palette.
 *
 * Read fresh each time rather than cached: toggling a plugin off between two
 * palette openings has to remove its commands, and there is no list here long
 * enough for the copy to cost anything.
 *
 * `run` is wrapped for the same reason `build()` is guarded — a command that
 * throws is a failed command, not a failed application. It is awaited inside
 * the wrapper so that a rejected promise is caught too, which is the shape
 * almost every interesting command has.
 */
export function pluginCommands(): PluginCommand[] {
  const surfaced: PluginCommand[] = [];
  for (const plugin of plugins) {
    if (!pluginEnabled(plugin.id)) continue;
    for (const command of plugin.commands ?? []) {
      surfaced.push({
        id: command.id,
        title: command.title,
        run: () => guardedRun(plugin.id, command),
      });
    }
  }
  return surfaced;
}

async function guardedRun(pluginId: string, command: PluginCommand): Promise<void> {
  try {
    await command.run();
  } catch (error) {
    console.error(`Plugin ${pluginId}: command ${command.id} failed`, error);
  }
}
