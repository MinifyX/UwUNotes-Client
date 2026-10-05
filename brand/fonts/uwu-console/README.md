# UwU Console

A monospace font for the UwUNotes editor: [Atkinson Hyperlegible Mono](https://github.com/googlefonts/atkinson-hyperlegible-next-mono)
with its letters untouched, plus Nyu (U+E000), a heart (U+2665) and arrows
(U+2190-2193), each drawn for the 632-unit cell. Variable, weight 200-800,
about 25 KB as WOFF2. No ligatures: `:3`, `<3` and `->` stay what was typed.
License: SIL OFL 1.1 ([OFL.txt](OFL.txt)), changes in [FONTLOG.txt](FONTLOG.txt).

It is the sibling of UwU Sans (UwUSuite-Design `fonts/uwu-sans-source`); the
drawing code for the new glyphs comes from there, narrowed to the cell.

## What changed

- Renamed per the OFL (family `UwU Console`), MinifyX copyright line added.
- Subset to what upstream has in Latin, Latin Extended, punctuation,
  currency, letterlike and math signs, Greek math letters (all 359 upstream
  code points stay). Hinting dropped, glyph names dropped (post format 3).
- New glyphs Nyu, heart and arrows, drawn as code in `build.py` with
  variation deltas so their stroke follows the weight. Every glyph is one
  cell (632 units) wide, combining marks zero.
- Nothing else: letter shapes, spacing, kerning and upstream's opt-in
  features (`zero`, `frac`, `case`, `sups`, ...) are upstream's. There is no
  `calt`, `liga` or `dlig` at all.

Upstream has no box drawing characters (U+2500-257F), so neither does UwU
Console; the browser falls back to the next font in the stack for them.

## Build

```sh
cd brand/fonts/uwu-console
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python build.py --install   # downloads + verifies upstream, writes UwUConsole[wght].woff2,
                                      # copies it to apps/desktop/src/assets/fonts/ (the shipped file)
.venv/bin/python test_shaping.py      # shaping tests (HarfBuzz)
.venv/bin/python specimen.py proof.png
```

The build is deterministic: the same inputs give a byte-identical WOFF2.
Upstream is pinned by commit and SHA-256 in `build.py`. `.venv/`, `.cache/`
and the local WOFF2 are not committed; only the shipped copy is.

## Where it ships

`apps/desktop/src/assets/fonts/UwUConsole[wght].woff2`, offered in the
editor font menu only (not the default, not an interface font).
