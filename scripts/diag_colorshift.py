#!/usr/bin/env python3
"""Find integer shift maximizing exact color-match of body rows between
accessory sheet and base sheet of the same animation/index.

If a small (dx,dy) makes >90% of overlapping body pixels identical, the
accessory sheet is essentially the base sheet shifted + accessory overlay,
and simple re-registration will produce near-perfect composites.
"""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")

def img_rgba(p):
    return np.array(Image.open(p).convert("RGBA"))

def best_color_shift(base, acc):
    t = 64
    # body band rows 26..62, cols 4..60 (avoid edges)
    bb = base[45:62, 4:60].astype(int)
    ab = acc[45:62, 4:60].astype(int)
    bmask = bb[:, :, 3] > 0
    amask = ab[:, :, 3] > 0
    best = (-1, 0, 0)
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            # shift acc by (dy, dx): acc content moves to y+dy
            row0 = max(0, dy)
            row1 = min(36, 36 + dy)
            col0 = max(0, dx)
            col1 = min(56, 56 + dx)
            aa = np.roll(np.roll(ab, dy, axis=0), dx, axis=1)
            if dx > 0: aa[:, :dx] = 0
            elif dx < 0: aa[:, dx:] = 0
            if dy > 0: aa[:dy, :] = 0
            elif dy < 0: aa[dy:, :] = 0
            am = aa[:, :, 3] > 0
            inter = bmask & am
            if inter.sum() < 200:
                continue
            same = (np.abs(bb[:,:,:3][inter] - aa[:,:,:3][inter]) < 12).all(axis=1).sum()
            frac = same / inter.sum()
            if frac > best[0]:
                best = (frac, dx, dy)
    return best

for anim in ["idle", "walk"]:
    base = img_rgba(DIR / f"evolved_{anim}.png")
    t = 64
    n = base.shape[1] // t
    print("="*70)
    for accp in sorted(DIR.glob(f"evolved_{anim}_*.png")):
        acc = img_rgba(accp)
        name = accp.stem.replace("evolved_", "")
        res = []
        for i in range(n):
            bt = base[:, i*t:(i+1)*t]
            at = acc[:, i*t:(i+1)*t]
            frac, dx, dy = best_color_shift(bt, at)
            res.append(f"f{i}({dx:+d},{dy:+d})={frac*100:.0f}%")
        print(f"{name:22s} " + "  ".join(res))
