#!/usr/bin/env python3
"""
Generate clean, code-drawn accessory overlays for the EVOLVED pet.

The bubbly accessory sheets can't be pixel-extracted (see extract_overlays.py),
so we DRAW the five accessories in crisp pixel art at the base dog's real scale,
anchored to the base dog's head on every frame of Idle and Walk.  Because the
anchor tracks the base dog exactly (same per-frame top row / x-centre), the
accessory rides the animation with zero frame-to-frame wobble and the body stays
the correctly-sized steady base dog.

Only Idle and Walk are generated (per current scope); Hurt/Attack/Death keep
the baked bubbly sheets.

Tuning: every constant (colours, offsets, sizes) is grouped in the DESIGN dict
at the top.  Regenerate with:
    venv\\Scripts\\python.exe make_overlays.py
Outputs: src/assets/pets/evolved/overlay_{accessory}_{anim}.png
"""
import os
import sys
import numpy as np
from PIL import Image

T = 64
EVO = "src/assets/pets/evolved"
OUT = "src/assets/pets/evolved"
ANIMS = ["idle", "walk"]
ACC_NAMES = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]

# ── pixel colours (chosen to read clearly over the tan evolved dog) ──────────
GOLD   = (248, 205, 70)
GOLD_D = (196, 148, 28)
GOLD_L = (255, 238, 168)
RUBY   = (222, 62, 72)
PURP   = (128, 90, 208)
PURP_D = (76, 48, 140)
STAR   = (250, 226, 96)
RED    = (224, 66, 66)
RED_D  = (150, 30, 34)
WHITE  = (250, 250, 250)
BLUE   = (96, 140, 224)
DARK   = (16, 17, 22)
GREY   = (130, 136, 150)

# ── geometry constants (all relative to head anchor) ─────────────────────────
# anchor: (htop, hcx) = top ink row of the base frame + x-centre of the head band
DESIGN = {
    "sunglasses": dict(eye=6, hw=7, th=3),       # bar over rows htop+eye..+eye+th
    "bowtie":     dict(by=11, w=5, h=3),          # bow centre row htop+by
    "crown":      dict(base=2, w=6, peak=4),      # band top row htop+base
    "partyhat":   dict(brim=3, w=8, height=13, stripes=2),
    "wizardhat":  dict(brim=3, w=9, height=16),
}


def canvas():
    return np.zeros((T, T, 4), dtype=np.uint8)


def px(c, x, y, col):
    if 0 <= x < T and 0 <= y < T:
        c[y, x, :3] = col
        c[y, x, 3] = 255


def rect(c, x0, y0, w, h, col):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            px(c, x, y, col)


# ── accessory painters ────────────────────────────────────────────────────────
def draw_sunglasses(c, cx, htop):
    e = DESIGN["sunglasses"]
    y = htop + e["eye"]; hw = e["hw"]; th = e["th"]
    left, right = cx - hw - 1, cx + hw - 1        # cx is CENTRE; shift by hw
    # two lenses with a thin bridge
    rect(c, cx - hw - 1, y, hw, th, DARK)
    rect(c, cx + 1, y, hw, th, DARK)
    px(c, cx - 1, y + 1, GREY)                      # bridge
    px(c, cx, y + 1, GREY)
    for xx in range(cx - hw, cx - 1):               # glossy top highlight
        px(c, xx, y, (52, 56, 66))
    for xx in range(cx + 1, cx + hw + 1):
        px(c, xx, y, (52, 56, 66))
    px(c, left - 1, y + 1, DARK)                    # ear arms
    px(c, right + 2, y + 1, DARK)


def draw_bowtie(c, cx, htop):
    g = DESIGN["bowtie"]
    y0 = htop + g["by"] - g["h"] // 2
    # wings
    rect(c, cx - g["w"] - 2, y0, g["w"], g["h"], RED)
    rect(c, cx + 2, y0, g["w"], g["h"], RED)
    # wing shading
    px(c, cx - g["w"] - 2, y0, RED_D)
    px(c, cx + g["w"] + 1, y0 + g["h"] - 1, RED_D)
    px(c, cx + g["w"] + 1, y0, RED)
    px(c, cx - g["w"] - 2, y0 + g["h"] - 1, RED)
    # knot
    rect(c, cx - 1, y0 + 1, 3, 1, RED_D)
    rect(c, cx - 1, y0, 3, 3, RED_D)
    px(c, cx, y0 - 1, RED_D)


def draw_crown(c, cx, htop):
    k = DESIGN["crown"]
    band_top = htop + k["base"]
    # spikes (3 peaks) above the band
    for d in (-k["w"], 0, k["w"]):
        for i in range(k["peak"]):
            rect(c, cx + d - 1, band_top - i - 1, 3, 1, GOLD)
    for i in range(k["peak"]):
        px(c, cx - k["w"], band_top - i - 1, GOLD_L if i % 2 == 0 else GOLD)
        px(c, cx + k["w"] + 1, band_top - i - 1, GOLD_L if i % 2 == 0 else GOLD)
    # band
    rect(c, cx - k["w"] - 1, band_top, 2 * k["w"] + 3, 3, GOLD)
    # band shading / jewels
    rect(c, cx - k["w"] - 1, band_top, 2 * k["w"] + 3, 1, GOLD_L)
    rect(c, cx - 4, band_top + 1, 2, 1, RUBY)
    rect(c, cx + 2, band_top + 1, 2, 1, RUBY)
    px(c, cx, band_top + 1, GOLD_D)


def _cone(c, cx, htop, brim, w, height, colors):
    """Generic tapered cone hat returning the tip row."""
    yb = htop + brim                      # brim top row
    yt = yb - height                      # tip row
    n = yb - yt
    for i in range(n):
        y = yt + i
        half = max(1, int(round(w * (i + 0.5) / n)))
        for x in range(cx - half, cx + half + 1):
            px(c, x, y, colors(y))
    # brim (two rows; second row slightly darker)
    base_col = colors(yb + 1)
    shade = tuple(max(0, base_col[k] - 35) for k in range(3))
    rect(c, cx - w - 1, yb, 2 * w + 3, 1, base_col)
    rect(c, cx - w - 1, yb + 1, 2 * w + 3, 1, shade)
    return yt


def draw_partyhat(c, cx, htop):
    k = DESIGN["partyhat"]
    def palette(y):
        r = (y - (htop + k["brim"] - k["height"]))
        if (r // k["stripes"]) % 3 == 0:
            return RED
        if (r // k["stripes"]) % 3 == 1:
            return WHITE
        return BLUE
    yt = _cone(c, cx, htop, k["brim"], k["w"], k["height"], palette)
    # pom-pom on top
    rect(c, cx - 1, yt - 2, 3, 2, RED)


def draw_wizardhat(c, cx, htop):
    k = DESIGN["wizardhat"]
    def colors(y):
        rel = y - (htop + k["brim"] - k["height"])
        return PURP_D if (rel // 3) % 2 == 0 else PURP
    yt = _cone(c, cx, htop, k["brim"], k["w"], k["height"], colors)
    # star on the cone front
    sy = yt + k["height"] // 2
    px(c, cx, sy, STAR)
    px(c, cx - 1, sy + 1, STAR); px(c, cx + 1, sy + 1, STAR)
    px(c, cx, sy - 1, STAR); px(c, cx, sy + 2, STAR)
    # brim trim
    px(c, cx - k["w"] - 1, htop + k["brim"] + 1, PURP_D)
    px(c, cx + k["w"] + 2, htop + k["brim"] + 1, PURP_D)


PAINTERS = {
    "bowtie": draw_bowtie,
    "crown": draw_crown,
    "partyhat": draw_partyhat,
    "sunglasses": draw_sunglasses,
    "wizardhat": draw_wizardhat,
}


def load_base(anim):
    return np.array(Image.open(os.path.join(EVO, f"evolved_{anim}.png")).convert("RGBA"))


def anchor(base_frame):
    """(head top row, head x-centre) from the narrow head column at the top."""
    bm = base_frame[:, :, 3] > 0
    rows = np.nonzero(bm.any(axis=1))[0]
    top = int(rows.min()) if len(rows) else 40
    band = bm[top:top + 9]
    xs = np.nonzero(band)[1]
    cx = float(np.median(xs)) if len(xs) else 32.0
    return top, cx


def main():
    if "--anim=" not in " ".join(sys.argv):
        pass
    only = []
    for a in sys.argv:
        if a.startswith("--anim="):
            only = a.split("=", 1)[1].split(",")
    for acc in ACC_NAMES:
        for anim in ANIMS:
            if only and anim not in only:
                continue
            base = load_base(anim)
            n = base.shape[1] // T
            strip = np.zeros((T, T * n, 4), dtype=np.uint8)
            anchors = []
            for i in range(n):
                top, cx = anchor(base[:, i*T:(i+1)*T])
                anchors.append((int(round(cx)), top))
                PAINTERS[acc](strip[:, i*T:(i+1)*T], int(round(cx)), top)
            Image.fromarray(strip).save(os.path.join(OUT, f"overlay_{acc}_{anim}.png"))
            ax = ", ".join(f"(x{a[0]},y{a[1]})" for a in anchors)
            pxpix = int((strip[:, :, 3] > 0).sum())
            print(f"overlay_{acc}_{anim}.png  frames={n}  anchors=[{ax}]  inkPix={pxpix}")
    print("done ->", OUT)


if __name__ == "__main__":
    main()
