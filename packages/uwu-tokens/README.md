# @uwu/tokens

The UwU Suite's design tokens, in one place, so UwUMail, UwUSSH, UwUNotes and
whatever comes next stay one family instead of three apps that happen to be
pink.

```ts
import '@uwu/tokens/tokens.css'; // colour, radius, type — every app
import '@uwu/tokens/code.css'; // syntax colour — only apps that show code
import { readToken, token } from '@uwu/tokens';
```

- **`tokens.css`** is the base palette. `:root` is light, `:root[data-theme='dark']`
  is dark, and the app decides which one it opens in by writing `data-theme`
  onto `<html>` before the first paint. UwUNotes opens dark; UwUMail opens light.
- **`code.css`** adds syntax colour and editor furniture on top. It needs
  `tokens.css` loaded first.
- **`index.ts`** exports the token names as a union type, `token()` for a
  checked `var(…)`, and `readToken()` for the rare spot — a `<canvas>` — that
  needs a resolved colour string instead.

## Rules

1. **No raw hex in a component.** If a colour is missing, add a token here.
2. **Pink means "this one".** Selection, cursor, the active tab, focus. It never
   also means "online", "saved" or "error" — those have their own tokens.
3. **Two pinks.** `--uwu-pink` is the brand. `--uwu-pink-solid` is the only one
   allowed under small white text, because the brand pink only reaches 3.1:1.
4. **A new token is a suite decision.** Adding one here changes every app, so it
   gets a name that means the same thing in all of them.

## Where it came from

UwUMail wrote this palette, UwUSSH copied the file, and UwUNotes is the first
app to depend on the package instead of its own copy. The names did not change
in the move, so the other two can switch over whenever they are touched next.
