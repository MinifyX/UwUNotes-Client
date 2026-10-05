#!/usr/bin/env python3
"""Build UwU Console from Atkinson Hyperlegible Mono (SIL OFL 1.1).

Reproducible: the upstream variable TTF is pinned by commit and SHA-256, the
Python dependencies by requirements.txt. Run from a venv:

    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
    .venv/bin/python build.py --install  # writes UwUConsole[wght].woff2 (+ .ttf in .cache/)
                                         # and copies it to apps/desktop/src/assets/fonts/
    .venv/bin/python test_shaping.py     # shaping tests
    .venv/bin/python specimen.py out.png # proof sheet

What it does (see FONTLOG.txt):
  1. download + verify the upstream variable font (roman, wght 200-800)
  2. subset to Latin, Latin Extended, punctuation, currency, arrows, symbols
  3. add new glyphs drawn here as code, each one cell wide (632 units like
     every upstream glyph): Nyu cat face (U+E000), heart (U+2665), arrows
     (U+2190-2193); every glyph gets gvar deltas so its strokes follow wght
  4. rename everything (family "UwU Console"), rebuild HVAR, write WOFF2

No ligatures and no contextual substitutions: ":3", "<3", "->" stay what was
typed. Letters, spacing and kerning are upstream's.

The drawing code is adapted from UwU Sans (UwUSuite-Design,
fonts/uwu-sans-source/build.py) and narrowed to the monospace cell.
"""

from __future__ import annotations

import hashlib
import math
import shutil
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import flagOverlapSimple as OVERLAP_SIMPLE
from fontTools.ttLib.tables.TupleVariation import TupleVariation
from fontTools.varLib.hvar import add_HVAR

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
REPO = HERE.parents[2]

UPSTREAM_COMMIT = "154d50362016cc3e873eb21d242cd0772384c8f9"
UPSTREAM_FILE = "fonts/variable/AtkinsonHyperlegibleMono%5Bwght%5D.ttf"
UPSTREAM_URL = (
    "https://raw.githubusercontent.com/googlefonts/atkinson-hyperlegible-next-mono/"
    f"{UPSTREAM_COMMIT}/{UPSTREAM_FILE}"
)
UPSTREAM_SHA256 = "5ce8b1698d1ded7dff2178c1a3ad159470085a58ea239e8b2cb88f4fb4a6f646"
UPSTREAM_VERSION = "2.001"

VERSION = "1.000"
FAMILY = "UwU Console"
PS_FAMILY = "UwUConsole"
OUT_NAME = "UwUConsole[wght].woff2"

# Upstream has two masters, wght 200 (the default outlines) and 800, with an
# avar curve in between. The drawn glyphs follow the same scheme: outlines at
# 200, one gvar tuple to 800.
DEFAULT_WGHT = 200
MASTERS = (200, 800)

# Stroke width of the drawn glyphs per master. Upstream stems (l, hyphen) are
# about 55 at 200 and 139 at 800; the pictograms stay a little lighter
# because filled shapes look heavier than letters at the same stroke.
STROKE = {200: 50.0, 800: 128.0}

ADVANCE = 632  # every upstream glyph (except combining marks) is this wide
CELL_MID = ADVANCE / 2
CAP = 668
XHEIGHT = 496
AXIS = 248  # center of upstream hyphen, minus, <, >
OVERSHOOT = 10

SUBSET_UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x250))  # Latin-1, Latin Extended-A/B
    + list(range(0x250, 0x2B0))  # IPA (whatever upstream has)
    + list(range(0x2B0, 0x370))  # modifiers + combining marks (ccmp)
    + list(range(0x370, 0x400))  # Greek: upstream only has Δ Ω μ π (math)
    + list(range(0x1E00, 0x1F00))  # Latin Extended Additional (ẞ)
    + list(range(0x2000, 0x2070))  # general punctuation („ “ « » – … ‰)
    + list(range(0x20A0, 0x20D0))  # currency (€)
    + list(range(0x2100, 0x2150))  # letterlike (™ ℮)
    + list(range(0x2190, 0x2200))  # arrows (drawn here, upstream has none)
    + list(range(0x2200, 0x2300))  # math operators upstream ships
    + list(range(0x2500, 0x2600))  # box drawing, blocks, shapes (upstream: only ◊)
    + [0x2665, 0x266A, 0xE000]
)


# --------------------------------------------------------------------------
# upstream


def fetch_upstream() -> Path:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"AtkinsonHyperlegibleMono-{UPSTREAM_COMMIT[:12]}.ttf"
    if not path.exists():
        print(f"downloading {UPSTREAM_URL}")
        with urllib.request.urlopen(UPSTREAM_URL) as r:  # noqa: S310 (pinned https URL)
            data = r.read()
        path.write_bytes(data)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != UPSTREAM_SHA256:
        path.unlink()
        sys.exit(f"upstream checksum mismatch: {digest}")
    return path


# --------------------------------------------------------------------------
# geometry helpers (from UwU Sans). Contours are lists of (x, y, on_curve).
# Quadratic arcs: on-curve points at the segment ends, one off-curve point in
# between.


def arc(cx, cy, r, a0, a1, n):
    """Arc from angle a0 to a1 (degrees) with n quadratic segments.
    Returns points without the final on-curve point."""
    pts = []
    step = (a1 - a0) / n
    k = r / math.cos(math.radians(step / 2))
    for i in range(n):
        a = a0 + i * step
        pts.append((cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)), True))
        m = a + step / 2
        pts.append((cx + k * math.cos(math.radians(m)), cy + k * math.sin(math.radians(m)), False))
    return pts


def ellipse(cx, cy, rx, ry, n=8, cw=True):
    pts = arc(0, 0, 1, 90, 90 - 360 if cw else 90 + 360, n)
    return [(cx + x * rx, cy + y * ry, on) for x, y, on in pts]


def norm(vx, vy):
    d = math.hypot(vx, vy)
    return vx / d, vy / d


def offset_line(p, q, dist):
    """Line p->q shifted by dist to the LEFT of the travel direction."""
    dx, dy = norm(q[0] - p[0], q[1] - p[1])
    nx, ny = -dy, dx
    return (p[0] + nx * dist, p[1] + ny * dist), (q[0] + nx * dist, q[1] + ny * dist)


def line_x_line(p1, p2, p3, p4):
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    x4, y4 = p4
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    return x1 + t * (x2 - x1), y1 + t * (y2 - y1)


def line_x_circle(p, q, c, r, near):
    """Intersection of the infinite line pq with circle (c, r) closest to `near`."""
    dx, dy = q[0] - p[0], q[1] - p[1]
    fx, fy = p[0] - c[0], p[1] - c[1]
    a = dx * dx + dy * dy
    b = 2 * (fx * dx + fy * dy)
    cc = fx * fx + fy * fy - r * r
    disc = math.sqrt(max(b * b - 4 * a * cc, 0.0))
    sols = [(-b - disc) / (2 * a), (-b + disc) / (2 * a)]
    pts = [(p[0] + t * dx, p[1] + t * dy) for t in sols]
    return min(pts, key=lambda s: math.hypot(s[0] - near[0], s[1] - near[1]))


def angle_of(c, p):
    return math.degrees(math.atan2(p[1] - c[1], p[0] - c[0]))


def rounded_corner(p_in, corner, p_out, radius):
    """Replace a sharp corner by on-off-on: on-curve points `radius` before and
    after the corner along the two edges, the corner itself as off-curve."""
    a = norm(p_in[0] - corner[0], p_in[1] - corner[1])
    b = norm(p_out[0] - corner[0], p_out[1] - corner[1])
    return [
        (corner[0] + a[0] * radius, corner[1] + a[1] * radius, True),
        (corner[0], corner[1], False),
        (corner[0] + b[0] * radius, corner[1] + b[1] * radius, True),
    ]


def rotate(contours, cx, cy, deg):
    s, c = math.sin(math.radians(deg)), math.cos(math.radians(deg))
    return [
        [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c, on) for x, y, on in ct]
        for ct in contours
    ]


def shift(contours, dx, dy):
    return [[(x + dx, y + dy, on) for x, y, on in ct] for ct in contours]


# --------------------------------------------------------------------------
# glyphs. Each function takes the stroke width w and returns the contours,
# drawn into the 632-unit cell. Point structure must not depend on w (gvar).


def nyu(w):
    """Cat face: round head with two ears as one stroked outline (ears open
    into the face), two oval eyes, a ':3' mouth turned into an omega.

    Narrowed from UwU Sans: the head's outer edge stays put across weights
    (the stroke grows inwards), so Nyu never leaves the cell, and the ears are
    a little taller so she still reaches about cap height."""
    # outer radius of the head: 524 of the 632 cell at wght 200, a little
    # wider when bold (like upstream's letters), the rest of the stroke grows
    # inwards so the face keeps room
    outer = 262.0 + (w - STROKE[200]) * 0.30
    # the head stroke grows a little slower than the letters' stems: in a
    # 632 cell a full-weight ring leaves no room for the face
    w = STROKE[200] + (w - STROKE[200]) * 0.82
    R = outer - w / 2  # centerline radius
    cx = CELL_MID
    cy = -OVERSHOOT + outer
    c = (cx, cy)
    jo, ji = 20.0, 78.0  # junction angles (deg) outside / towards the top
    tip_r = (cx + outer * 0.76, cy + outer * 1.30 - w * 0.5)

    def ear_points(side):
        s = 1 if side == "r" else -1

        def mirror(p):
            return (cx + s * (p[0] - cx), p[1])

        a_o = jo if s == 1 else 180 - jo
        a_i = ji if s == 1 else 180 - ji
        J_o = (cx + R * math.cos(math.radians(a_o)), cy + R * math.sin(math.radians(a_o)))
        J_i = (cx + R * math.cos(math.radians(a_i)), cy + R * math.sin(math.radians(a_i)))
        return J_o, mirror(tip_r), J_i

    # Centerline (counter-clockwise): right ear (Jo -> T -> Ji), top arc,
    # left ear (Ji -> T -> Jo), bottom arc back to the right ear.
    rJo, rT, rJi = ear_points("r")
    lJo, lT, lJi = ear_points("l")
    legs = [(rJo, rT), (rT, rJi), (lJi, lT), (lT, lJo)]

    def contour(dist):
        """Offset of the centerline by dist to the left (inside for CCW)."""
        r = R - dist
        L = [offset_line(p, q, dist) for p, q in legs]
        pts = []
        a = line_x_circle(*L[0], c, r, rJo)
        t = line_x_line(*L[0], *L[1])
        b = line_x_circle(*L[1], c, r, rJi)
        pts.append((*a, True))
        tip_round = 30 if dist < 0 else 12
        pts += rounded_corner(a, t, b, tip_round)
        a2 = line_x_circle(*L[2], c, r, lJi)
        pts += arc(cx, cy, r, angle_of(c, b), angle_of(c, a2), 3)
        t2 = line_x_line(*L[2], *L[3])
        b2 = line_x_circle(*L[3], c, r, lJo)
        pts.append((*a2, True))
        pts += rounded_corner(a2, t2, b2, tip_round)
        a_end = angle_of(c, a) + 360
        pts += arc(cx, cy, r, angle_of(c, b2), a_end, 8)
        return pts

    head_out = list(reversed(contour(-w / 2)))  # clockwise
    head_in = contour(w / 2)  # counter-clockwise -> counter
    inner = outer - w  # radius of the face inside the stroke
    # eyes: filled vertical ovals
    er = 28 + w * 0.12
    ey = cy + inner * 0.18
    ex = inner * 0.44
    eyes = [ellipse(cx - ex, ey, er * 0.86, er * 1.14), ellipse(cx + ex, ey, er * 0.86, er * 1.14)]
    # mouth: two lower half-circle strokes with round caps (":3" turned 90°)
    mw = w * 0.52
    m = mw * 0.5 + 15
    my = cy - inner * 0.26

    def bowl(mx):
        ro, ri = m + mw / 2, m - mw / 2
        pts = []
        pts += arc(mx, my, ro, 0, -180, 4)
        pts += arc(mx - m, my, mw / 2, 180, 0, 2)
        pts += arc(mx, my, ri, -180, 0, 4)
        pts += arc(mx + m, my, mw / 2, 180, 0, 2)
        return pts

    mouth = [bowl(cx - m), bowl(cx + m)]
    return [head_out, head_in, *eyes, *mouth]


def heart(w):
    """Filled heart, from the baseline to about cap height, a bit fuller with
    weight. Narrower lobes than UwU Sans so it fits the cell."""
    grow = (w - 80) * 0.30
    r = 150.0 + grow
    d = 116.0
    cx = CELL_MID
    top = CAP - 70 + grow * 0.5
    cy = top - r
    tip = (cx, 40 - grow * 0.6)
    left = (cx - d, cy)
    right = (cx + d, cy)

    def tangent_point(center, sign):
        dx, dy = center[0] - tip[0], center[1] - tip[1]
        dist = math.hypot(dx, dy)
        base = math.atan2(dy, dx)
        off = math.asin(r / dist)
        ang = base + sign * off
        length = math.sqrt(dist * dist - r * r)
        return (tip[0] + math.cos(ang) * length, tip[1] + math.sin(ang) * length)

    tl = tangent_point(left, +1)
    tr = tangent_point(right, -1)
    cusp_y = cy + math.sqrt(max(r * r - d * d, 0))
    cusp = (cx, cusp_y)
    pts = [(*tip, True), (*tl, True)]
    a0 = angle_of(left, tl)
    a1 = angle_of(left, cusp)
    pts += arc(*left, r, a0, a1 - 360 if a1 > a0 else a1, 4)
    pts.append((*cusp, True))
    a_end = angle_of(right, tr)
    a_start = angle_of(right, cusp)
    if a_end > a_start:
        a_end -= 360
    pts += arc(*right, r, a_start, a_end, 4)
    pts.append((*tr, True))
    clean = []
    for p in pts:
        if clean and clean[-1][2] and p[2] and math.hypot(clean[-1][0] - p[0], clean[-1][1] - p[1]) < 0.5:
            continue
        clean.append(p)
    return [clean]


def arrow(w, x0, x1, axis, head=170.0):
    """Horizontal arrow pointing right from x0 to x1 on `axis`: a shaft and an
    open chevron head with 45° arms, cut horizontally."""
    h = w / 2
    t = w * math.sqrt(2)  # horizontal thickness of a 45° arm
    tip = (x1, axis)
    inner_tip = (x1 - t, axis)
    up_o = (x1 - head, axis + head)
    up_i = (up_o[0] - t, up_o[1])
    dn_o = (x1 - head, axis - head)
    dn_i = (dn_o[0] - t, dn_o[1])
    chevron = [
        (*tip, True),
        (*dn_o, True),
        (*dn_i, True),
        (*inner_tip, True),
        (*up_i, True),
        (*up_o, True),
    ]
    end = x1 - w * 1.1  # overlaps into the solid part of the chevron
    shaft = [(x0, axis - h, True), (x0, axis + h, True), (end, axis + h, True), (end, axis - h, True)]
    return [chevron, shaft]


# Horizontal arrows span the width of upstream's minus/equal (68-564) and sit
# on its axis, so "->" and "→" line up. Vertical ones span baseline to cap.
H_X0, H_X1 = 68.0, 564.0


def arrow_right(w):
    return arrow(w, H_X0, H_X1, AXIS)


def arrow_left(w):
    return rotate(arrow_right(w), CELL_MID, AXIS, 180)


def arrow_up(w):
    # drawn horizontally around the cell middle, then turned
    length = CAP + OVERSHOOT
    ct = arrow(w, CELL_MID - length / 2, CELL_MID + length / 2, AXIS)
    ct = rotate(ct, CELL_MID, AXIS, 90)
    return shift(ct, 0, (CAP - OVERSHOOT) / 2 - AXIS)


def arrow_down(w):
    return rotate(arrow_up(w), CELL_MID, CAP / 2 - OVERSHOOT / 2, 180)


NEW_GLYPHS = {
    # name: (codepoint, drawing function)
    "nyu": (0xE000, nyu),
    "heart": (0x2665, heart),
    "arrowleft": (0x2190, arrow_left),
    "arrowup": (0x2191, arrow_up),
    "arrowright": (0x2192, arrow_right),
    "arrowdown": (0x2193, arrow_down),
}


# --------------------------------------------------------------------------
# glyph construction + variations


def signed_area(ct):
    a = 0.0
    for i, (x, y, _) in enumerate(ct):
        x2, y2, _ = ct[(i + 1) % len(ct)]
        a += x * y2 - x2 * y
    return a / 2


def build_glyph(contours):
    pen = TTGlyphPen(None)
    for ct in contours:
        start = next(i for i, p in enumerate(ct) if p[2])  # TTGlyphPen needs an on-curve start
        ct = ct[start:] + ct[:start]
        pen.moveTo((round(ct[0][0]), round(ct[0][1])))
        buf = []
        for x, y, on in ct[1:]:
            pt = (round(x), round(y))
            if on:
                if buf:
                    pen.qCurveTo(*buf, pt)
                    buf = []
                else:
                    pen.lineTo(pt)
            else:
                buf.append(pt)
        if buf:
            pen.qCurveTo(*buf, (round(ct[0][0]), round(ct[0][1])))
        pen.closePath()
    return pen.glyph()


def oriented(name, contours):
    """Outer contours clockwise (negative area in y-up coords), counters
    counter-clockwise. Nyu is built with explicit directions."""
    if name == "nyu":
        return contours
    return [ct if signed_area(ct) < 0 else list(reversed(ct)) for ct in contours]


def _deltas_in_glyph_order(base_contours, master_contours):
    out = []
    for cb, cm in zip(base_contours, master_contours):
        start = next(i for i, p in enumerate(cb) if p[2])
        cb = cb[start:] + cb[:start]
        cm = cm[start:] + cm[:start]
        for (bx, by, _), (mx, my, _) in zip(cb, cm):
            out.append((round(mx) - round(bx), round(my) - round(by)))
    return out


def add_new_glyphs(font: TTFont):
    glyf = font["glyf"]
    hmtx = font["hmtx"]
    gvar = font["gvar"]
    order = font.getGlyphOrder()
    cmap_tables = [t for t in font["cmap"].tables if t.isUnicode()]
    gdef = font["GDEF"].table
    for name, (cp, fn) in NEW_GLYPHS.items():
        assert name not in order and cp not in font.getBestCmap(), f"upstream already has {name}"
        per_master = {m: oriented(name, fn(STROKE[m])) for m in MASTERS}
        base = per_master[DEFAULT_WGHT]
        g = build_glyph(base)
        g.recalcBounds(glyf)
        assert 0 <= g.xMin and g.xMax <= ADVANCE, f"{name} leaves the cell: {g.xMin}..{g.xMax}"
        if g.numberOfContours > 0:
            g.flags[0] |= OVERLAP_SIMPLE  # overlapping contours, for CoreText
        order.append(name)
        glyf.glyphs[name] = g
        glyf.glyphOrder = order
        hmtx.metrics[name] = (ADVANCE, g.xMin)
        for t in cmap_tables:
            t.cmap[cp] = name
        variations = []
        for m in MASTERS:
            if m == DEFAULT_WGHT:
                continue
            pts = [p for ct in per_master[m] for p in ct]
            assert len(pts) == sum(len(ct) for ct in base), f"{name}: point structure differs at {m}"
            xs = [p[0] for p in pts]
            assert 0 <= min(xs) and max(xs) <= ADVANCE, f"{name} leaves the cell at {m}"
            deltas = _deltas_in_glyph_order(base, per_master[m])
            deltas += [(0, 0)] * 4  # phantom points: the advance never changes
            variations.append(TupleVariation({"wght": (0.0, 1.0, 1.0)}, deltas))
        gvar.variations[name] = variations
        if gdef.GlyphClassDef is not None:
            gdef.GlyphClassDef.classDefs[name] = 1
    font.setGlyphOrder(order)
    font["maxp"].numGlyphs = len(order)


# --------------------------------------------------------------------------
# naming


def rename(font: TTFont):
    name = font["name"]
    copyright_ = (
        "Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors "
        "(https://github.com/googlefonts/atkinson-hyperlegible-next-mono). "
        "Copyright 2026 MinifyX (UwU Console, a modified version)"
    )
    # Like upstream, the default outlines are the ExtraLight master.
    style = "ExtraLight"
    values = {
        0: copyright_,
        1: f"{FAMILY} {style}",
        2: "Regular",
        3: f"{VERSION};MFX;{PS_FAMILY}-{style}",
        4: f"{FAMILY} {style}",
        5: f"Version {VERSION}; based on Atkinson Hyperlegible Mono {UPSTREAM_VERSION}",
        6: f"{PS_FAMILY}-{style}",
        8: "MinifyX",
        9: "Elliott Scott, Megan Eiswerth, Linus Boman, Theodore Petrosky, Letters from Sweden "
        "(Atkinson Hyperlegible Mono); MinifyX (UwU Console additions)",
        10: "UwU Console is a modified version of Atkinson Hyperlegible Mono (Braille Institute) "
        "with a Nyu cat face, a heart and arrows. It is not affiliated with or endorsed by "
        "the Braille Institute.",
        11: "https://github.com/MinifyX/UwUNotes-Client",
        12: "https://github.com/MinifyX/UwUNotes-Client",
        16: FAMILY,
        17: style,
        25: PS_FAMILY,
    }
    keep_ids = set(values) | {13, 14} | {r.nameID for r in name.names if r.nameID >= 256}
    name.names = [r for r in name.names if r.nameID in keep_ids]
    for nid, val in values.items():
        name.removeNames(nameID=nid)
        name.setName(val, nid, 3, 1, 0x409)
    font["OS/2"].achVendID = "MFX "
    font["head"].fontRevision = float(VERSION)
    for r in name.names:
        text = r.toUnicode()
        for word in ("Atkinson", "Hyperlegible"):
            assert word not in text or r.nameID in (0, 5, 9, 10), (r.nameID, text)


# --------------------------------------------------------------------------


def restore_glyph_classes(font: TTFont, upstream: TTFont):
    """The subsetter drops the GDEF class of marks that are only reached
    through GSUB (uni0307.large, uni030C.alt). Put upstream's classes back."""
    classes = font["GDEF"].table.GlyphClassDef.classDefs
    up = upstream["GDEF"].table.GlyphClassDef.classDefs
    for name in font.getGlyphOrder():
        if name not in classes and name in up:
            classes[name] = up[name]


def build() -> Path:
    src = fetch_upstream()
    font = TTFont(src)

    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False  # upstream variable font is unhinted in practice
    opts.drop_tables += ["DSIG"]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=SUBSET_UNICODES)
    sub.subset(font)
    restore_glyph_classes(font, TTFont(src))

    gsub_tags = {r.FeatureTag for r in font["GSUB"].table.FeatureList.FeatureRecord}
    assert not gsub_tags & {"calt", "liga", "dlig", "clig", "rlig"}, f"upstream has ligatures: {gsub_tags}"

    add_new_glyphs(font)
    rename(font)
    if "HVAR" in font:
        del font["HVAR"]
    add_HVAR(font)
    font["post"].formatType = 3.0  # no glyph names, smaller
    font["post"].isFixedPitch = 1

    # deterministic output: keep upstream's timestamps instead of "now"
    font.recalcTimestamp = False
    font["head"].modified = font["head"].created

    CACHE.mkdir(exist_ok=True)
    ttf = CACHE / "UwUConsole[wght].ttf"
    font.save(ttf)
    font = TTFont(ttf, recalcTimestamp=False)
    font.flavor = "woff2"
    out = HERE / OUT_NAME
    font.save(out)
    print(f"wrote {out.name}: {out.stat().st_size} bytes (ttf {ttf.stat().st_size})")
    return out


def install(out: Path):
    # The app ships apps/desktop/src/assets/fonts/UwUConsole[wght].woff2.
    dest = REPO / "apps" / "desktop" / "src" / "assets" / "fonts" / OUT_NAME
    shutil.copyfile(out, dest)
    print(f"copied to {dest.relative_to(REPO)}")


if __name__ == "__main__":
    out = build()
    if "--install" in sys.argv:
        install(out)
