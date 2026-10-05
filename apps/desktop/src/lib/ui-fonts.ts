/**
 * The interface font (Settings → Erscheinungsbild → Schrift der Oberfläche):
 * menus, dialogs, the sidebar, the tabs, the status bar, the Nyu-Zentrale.
 *
 * The same four choices as UwUMail, and the same mechanism: local font files
 * (no network, CSP `font-src 'self' data:`), one custom property on <html>
 * that `styles/fonts.css` points `--uwu-font` at. The editor's text is not
 * this: it has its own font setting, `fontFamily`, a monospace by default.
 */

export const UI_FONT_CHOICES = ['uwu', 'rubik', 'dmsans', 'system'] as const;
export type UiFont = (typeof UI_FONT_CHOICES)[number];

const SYSTEM_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif";

/** The family list for each choice; the web fonts fall back to the system's. */
export const UI_FONT_STACKS: Record<UiFont, string> = {
  uwu: `'UwU Sans', ${SYSTEM_STACK}`,
  rubik: `'Rubik Variable', ${SYSTEM_STACK}`,
  dmsans: `'DM Sans Variable', ${SYSTEM_STACK}`,
  system: SYSTEM_STACK,
};

/** What the picker calls them. Font names stay untranslated; "System" is the picker's. */
export const UI_FONT_NAMES: Record<Exclude<UiFont, 'system'>, string> = {
  uwu: 'UwU Sans',
  rubik: 'Rubik',
  dmsans: 'DM Sans',
};

/**
 * A little tighter than the fonts are set, for interface text. UwU Sans
 * (Atkinson Hyperlegible) is spaced generously for reading; the others are
 * fine as they come.
 */
export const UI_FONT_TRACKING: Record<UiFont, string> = {
  uwu: '-0.008em',
  rubik: '0em',
  dmsans: '-0.004em',
  system: '0em',
};

export function isUiFont(value: unknown): value is UiFont {
  return (UI_FONT_CHOICES as readonly unknown[]).includes(value);
}

/** Puts the chosen font on the whole interface at once. */
export function applyUiFont(choice: UiFont, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('--font-ui', UI_FONT_STACKS[choice]);
  root.style.setProperty('--tracking-ui', UI_FONT_TRACKING[choice]);
  root.dataset.font = choice;
}
