#!/usr/bin/env python3
"""Inspect the previously-fixed evolved_* accessory sheets in _backup_evo/removed:
dims, alpha, coverage vs base frame, provenance vs current imports."""
import os
from collections import Counter
import numpy as np
from PIL import Image

BK = r"_backup_evo\removed"
EVO = "src/assets/pets/evolved"
IMP = r"src\assets\evo acessories"


def frame_of_sheet(path, i, T=64):
    a = np.array(Image.open(path).convert("RGBA"))
    return a[:, i*T:(i+1)*T]


def coverage(img, base):
    return (img[:, :, 3] > 0).mean(), (base[:, :, 3] > 0).mean()


for f in sorted(os.listdir(BK)):
    if not (f.startswith("evolved_") and f.endswith(".png")):
        continue
    parts = f[:-4].split("_")  # evolved anim acc
    anim = parts[1]
    p = os.path.join(BK, f)
    im = Image.open(p)
    w, h = im.size
    a = np.array(im.convert("RGBA"))
    n = w // 64
    al = (a[:, :, 3] > 0).mean()
    # compare first frame to base frame & to current import cell
    b = np.array(Image.open(os.path.join(EVO, f"evolved_{anim}.png")).convert("RGBA")).astype(int)
    bf = b[:, :64]
    f0 = a[:, :64]
    m0 = f0[:, :, 3] > 0
    same = None
    if n >= 1:
        bm = bf[:, :, 3] > 0
        inter = int((m0 & bm).sum())
        same = inter / max(1, int(bm.sum()))
    print(f"{f:34s} {w}x{h} n={n} alphaFrac={al:.2f} f0vBaseOverlap={same*100:.0f}%" if same is not None else
          f"{f:34s} {w}x{h} n={n} alphaFrac={al:.2f}")
