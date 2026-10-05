# UwU Sans

The interface font of the UwU apps: [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next)
with its letters untouched, plus Nyu (U+E000), a heart (U+2665), arrows
(U+2190-2193) and `calt` ligatures for `:3` and `<3`. Variable, weight
200-800, about 48 KB as WOFF2. License: SIL OFL 1.1 ([OFL.txt](OFL.txt)),
changes in [FONTLOG.txt](FONTLOG.txt).

It is built in the UwUMail-Client repository (`brand/fonts/uwu-sans`, with
`build.py` and the shaping tests). This repository only carries the built file:

- `apps/desktop/src/assets/fonts/UwUSans[wght].woff2`

It must stay byte-identical to UwUMail-Client's copy. After a rebuild there,
copy it here by hand.

The `:3` and `<3` ligatures never apply in the editor: the editor has its own
font setting and uses a monospace face.
