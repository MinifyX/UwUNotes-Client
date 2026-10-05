#!/usr/bin/env python3
"""Shaping tests for UwU Console.

    .venv/bin/python test_shaping.py   (after build.py)

UwU Console has no ligatures and no contextual substitutions: ":3", "<3",
"->" and every other sequence render as the characters that were typed, one
cell each. The drawn glyphs are reachable by code point only: Nyu U+E000,
heart U+2665, arrows U+2190-2193.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
WOFF2 = HERE / "UwUConsole[wght].woff2"
ADVANCE = 632

DRAWN = (0xE000, 0x2665, 0x2190, 0x2191, 0x2192, 0x2193)

PLAIN = [
    ":3",
    "Hallo :3",
    "<3 Nyu",
    "Danke dir <3",
    "(:3)",
    "<3<3",
    ":3 <3",
    "10:30",
    "x<3",
    "a<3b",
    "http://localhost:3000",
    "-> => <- <= >= != == === !== <!-- --> |> <> :: ... www ff fi fl",
    " ♥ ← ↑ → ↓",
]
VARIANTS = (
    ({}, 200),
    ({}, 400),
    ({}, 800),
    ({"calt": True, "liga": True, "dlig": True, "clig": True}, 400),
    ({"zero": True}, 400),
)


def shape(face, text, features=None, wght=400):
    font = hb.Font(face)
    font.set_variations({"wght": wght})
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, features or {})
    return [i.codepoint for i in buf.glyph_infos], [p.x_advance for p in buf.glyph_positions]


def main() -> int:
    # uharfbuzz cannot read woff2; decompress via fontTools
    tt = TTFont(io.BytesIO(WOFF2.read_bytes()))
    tt.flavor = None
    raw = io.BytesIO()
    tt.save(raw)
    face = hb.Face(hb.Blob(raw.getvalue()))
    cmap = tt.getBestCmap()
    gid = {name: i for i, name in enumerate(tt.getGlyphOrder())}
    failures = []
    checks = 0

    for text in PLAIN:
        for feats, wght in VARIANTS:
            checks += 1
            got, adv = shape(face, text, feats, wght)
            want = [gid[cmap[ord(c)]] for c in text]
            # `zero` (slashed zero, opt-in) is upstream's only one-to-one swap
            ok = len(got) == len(want) if feats.get("zero") else got == want
            if not ok:
                failures.append(f"{text!r} ({feats}, {wght}) shaped as {got}, expected {want}")
            if set(adv) != {ADVANCE}:
                failures.append(f"{text!r} ({feats}, {wght}) advances {sorted(set(adv))}")

    # no contextual or ligature features at all
    tags = {r.FeatureTag for r in tt["GSUB"].table.FeatureList.FeatureRecord}
    checks += 1
    if tags & {"calt", "liga", "dlig", "rlig", "clig", "rclt"}:
        failures.append(f"GSUB has ligature features: {sorted(tags)}")

    # the drawn glyphs are reachable by code point and have outlines
    glyf = tt["glyf"]
    for cp in DRAWN:
        checks += 1
        name = cmap.get(cp)
        if name is None or glyf[name].numberOfContours <= 0:
            failures.append(f"U+{cp:04X} missing or empty ({name})")

    # monospace: every glyph is one cell wide (combining marks: zero), at
    # every weight (HVAR must not change advances)
    checks += 1
    gdef = tt["GDEF"].table.GlyphClassDef.classDefs
    for name, (adv, _) in tt["hmtx"].metrics.items():
        want = 0 if gdef.get(name) == 3 else ADVANCE
        if adv != want:
            failures.append(f"{name} advance {adv}, expected {want}")
    for wght in (200, 300, 500, 700, 800):
        checks += 1
        font = hb.Font(face)
        font.set_variations({"wght": wght})
        bad = [n for n, cp in ((cmap[c], c) for c in cmap) if gdef.get(n) != 3 and font.get_glyph_h_advance(gid[n]) != ADVANCE]
        if bad:
            failures.append(f"wght {wght}: {len(bad)} glyphs not {ADVANCE} wide, e.g. {bad[:5]}")
    checks += 1
    if tt["post"].isFixedPitch != 1:
        failures.append("post.isFixedPitch not set")

    # naming: no upstream family name left where the OFL asks for a new one
    names = {r.nameID: r.toUnicode() for r in tt["name"].names if r.platformID == 3}
    for nid in (1, 3, 4, 6, 16, 17, 21, 22, 25):
        checks += 1
        if nid in names and ("Atkinson" in names[nid] or "Hyperlegible" in names[nid]):
            failures.append(f"name {nid} still carries the upstream name: {names[nid]}")
    checks += 1
    if names.get(16) != "UwU Console":
        failures.append(f"typographic family name is {names.get(16)!r}")

    for f in failures:
        print("FAIL", f)
    print(f"{checks - len(failures)}/{checks} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
