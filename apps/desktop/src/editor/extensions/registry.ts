/**
 * The plugin registry: optional editor behaviour the user can switch on.
 *
 * A plugin is deliberately small — an id, a label, a German sentence saying
 * what it does, a default, and a `build()` that returns a CodeMirror
 * `Extension`. Nothing else. It cannot add a menu, a panel or a setting of its
 * own, which is the point: everything in here is listed and toggled by the
 * same piece of settings UI, and adding one costs a file and a call.
 *
 * ## Adding a plugin
 *
 * 1. Write it next to `builtin.ts` (or in `builtin.ts` if it is a few lines).
 * 2. `registerPlugin({ id, name, description, defaultEnabled, build })`. Wrap
 *    `name` and `description` in `N_()` — they are module-level constants, so
 *    the catalogue scanner finds them there and the UI passes them through
 *    `t()` when it renders them.
 * 3. Import the module from `editor/setup.ts` so registration happens before
 *    the first state is built. That is the whole wiring.
 *
 * `build()` is called every time the editor is reconfigured, so it must be
 * cheap and must not hold state between calls — anything a plugin needs to
 * remember belongs in a `StateField` inside the extension it returns.
 *
 * Which plugins are on is kept here rather than in `lib/settings.ts`: the set
 * of ids is open-ended, and `Settings` is a closed record with a validator
 * that would have to be edited for every new plugin. What this module does not
 * do is decide *when* to apply a change; it announces, and `editor/setup.ts`
 * reconfigures.
 */

import type { Extension } from '@codemirror/state';

export type UwuPlugin = {
  /** Stable: it is what gets written to storage. */
  id: string;
  /** German, via `N_()`. The UI translates it. */
  name: string;
  /** German, via `N_()`. One sentence, shown under the switch. */
  description: string;
  defaultEnabled: boolean;
  build: () => Extension;
};

/** Insertion order, which is the order the settings page lists them in. */
const plugins: UwuPlugin[] = [];
const listeners = new Set<() => void>();

const KEY = 'uwunotes.plugins';

/**
 * Only the *deviations* from each plugin's default are stored. A plugin added
 * in a later version then arrives with its own default switched on, instead of
 * being silently off because it was missing from a list written last year.
 */
let overrides: Record<string, boolean> = loadOverrides();

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
 * The extensions of every enabled plugin, in registration order.
 *
 * A `build()` that throws takes only itself out: one broken optional feature
 * must not cost the user their editor, and the console keeps the evidence.
 */
export function pluginExtensions(enabled: ReadonlySet<string>): Extension {
  const built: Extension[] = [];
  for (const plugin of plugins) {
    if (!enabled.has(plugin.id)) continue;
    try {
      built.push(plugin.build());
    } catch (error) {
      console.error(`Plugin ${plugin.id} failed to build`, error);
    }
  }
  return built;
}
