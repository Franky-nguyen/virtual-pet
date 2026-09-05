#!/usr/bin/env python3
"""Compare accessory-sheet dog body (rows 25..63) to the base dog at shift 0:
 - pixel-exact match fraction over opaque pixels
 - leftover acc-only & base-only pixels in that band
This tells whether the accessory sheet is the same art as the base sheet under
the accessory (rows 25..63 shouldn't contain any accessory for hats/crown, but
contain body for sunglasses/bowtie at rows below 25?).
"""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")

def rgba(p):
    return np.array(Image.open(p).convert("RGBA"))

for anim in ["attack", "hurt", "death"]:
    base = rgba(DIR / f"evolved_{anim}.png")
    t = 64
    n = base.shape[1] // t
    print("="*70)
    for accp in sorted(DIR.glob(f"evolved_{anim}_*.png")):
        acc = rgba(accp)
        name = accp.stem
        for i in range(n):
            bt = base[:, i*t:(i+1)*t]
            at = acc[:, i*t:(i+1)*t]
            # rows 25..62
            bmask = bt[25:63, :, 3] > 0
            amask = at[25:63, :, 3] > 0
            inter = bmask & amask
            # color match within intersection (allow alpha diff ignore)
            if inter.sum() == 0:
                continue
            bc = bt[25:63, :, :3][inter]
            ac = at[25:63, :, :3][inter]
            same = (np.abs(bc.astype(int) - ac.astype(int)) < 12).all(axis=1).sum()
            only_acc = (amask & ~bmask).sum()
            only_base = (bmask & ~amask).sum()
            if i == 0:
                print(f"{name:30s} f{i}: inter={inter.sum():4d} same={same:4d} "
                      f"only_acc={only_acc:4d} only_base={only_base:4d}")
            else:
                print(f"{'':30s} f{i}: inter={inter.sum():4d} same={same:4d} "
                      f"only_acc={only_acc:4d} only_base={only_base:4d}")
