/**
 * The token names TypeScript reads, typed, plus the one thing CSS cannot do.
 *
 * The suite's tokens (`--uwu-canvas`, `--uwu-pink`, …) come from
 * `@uwusuite/design`; the editor's own — the code colours in
 * `styles/code.css` and `--uwu-deep`, the ground under the text, in
 * `styles/tokens.css` — live in this app, because no other app shows code yet.
 * What this module adds is a name a compiler can check (`token('--uwu-pink')`
 * fails to build after a rename, a raw string does not) and {@link readToken},
 * for the few places that need the resolved colour as a string: a `<canvas>`
 * cannot take `var(--uwu-pink)` as a fill.
 */

/** Suite tokens this app reads from TypeScript, plus the editor's ground. */
export const BASE_TOKENS = [
  '--uwu-canvas',
  '--uwu-surface',
  '--uwu-elevated',
  '--uwu-ink',
  '--uwu-muted',
  '--uwu-hairline',
  '--uwu-border',
  '--uwu-pink',
  '--uwu-pink-solid',
  '--uwu-on-pink',
  '--uwu-pink-ink',
  '--uwu-pink-tint',
  '--uwu-pink-tint-strong',
  '--uwu-success-ink',
  '--uwu-warning-ink',
  '--uwu-offline',
  '--uwu-deep',
  '--uwu-deep-gutter',
  '--uwu-mono',
] as const;

/** Syntax colour and editor furniture (`styles/code.css`). */
export const CODE_TOKENS = [
  '--uwu-code-keyword',
  '--uwu-code-string',
  '--uwu-code-number',
  '--uwu-code-comment',
  '--uwu-code-function',
  '--uwu-code-type',
  '--uwu-code-variable',
  '--uwu-code-constant',
  '--uwu-code-operator',
  '--uwu-code-tag',
  '--uwu-code-attribute',
  '--uwu-code-heading',
  '--uwu-code-link',
  '--uwu-code-invalid',
  '--uwu-code-cursor',
  '--uwu-code-selection',
  '--uwu-code-selection-blur',
  '--uwu-code-match',
  '--uwu-code-match-active',
  '--uwu-code-active-line',
  '--uwu-code-line-number',
  '--uwu-code-line-number-active',
  '--uwu-code-indent-guide',
  '--uwu-code-matching-bracket',
  '--uwu-code-added',
  '--uwu-code-modified',
  '--uwu-code-deleted',
] as const;

export type BaseToken = (typeof BASE_TOKENS)[number];
export type CodeToken = (typeof CODE_TOKENS)[number];
export type Token = BaseToken | CodeToken;

/** `var(--uwu-pink)`, but misspelling the name is a build error. */
export function token(name: Token): string {
  return `var(${name})`;
}

/**
 * The value a token resolves to right now, e.g. `#ff7fac`.
 *
 * Only for canvas and other places that cannot take a `var()`. Whatever calls
 * this has to read again when the theme changes — the value is a snapshot of
 * the current `data-theme`, not a live binding.
 */
export function readToken(name: Token, element: Element = document.documentElement): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}
