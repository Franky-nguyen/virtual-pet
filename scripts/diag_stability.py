#!/usr/bin/env python3
"""Per-sheet intra-frame stability analysis.

For each sheet, register every frame onto frame 0 by searching integer
translations (dx in -9..9, dy in -9..9) maximizing silhouette overlap with
frame 0. Report:
  - translations needed per frame (drift pattern)
  - residual overlap after best registration (art consistency)
If translations vary a lot between frames => the sheet's frames are drifting
(translation mis-registration). If residual overlap is low even after best
registration => frames contain different art (cannot be fixed by shifting).
"""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")

def alpha(p):
    return np.array(Image.open(p).convert("RGBA"))[:, :, 3]

def tile(a, i, t):
    return a[:, i*t:(i+1)*t]

def best_shift(ref, frm, search=9):
    refm = ref > 0
    denom = refm.sum()
    best = (-1.0, 0, 0)
    for dy in range(-search, search+1):
        for dx in range(-search, search+1):
            s = np.roll(np.roll(frm, dy, axis=0), dx, axis=1)
            if dx > 0: s[:, :dx] = 0
            elif dx < 0: s[:, dx:] = 0
            if dy > 0: s[:dy, :] = 0
            elif dy < 0: s[dy:, :] = 0
            inter = np.logical_and(refm, s > 0).sum()
            score = inter / denom
            if score > best[0]:
                best = (score, dx, dy)
    return best

for anim in ["idle", "walk", "hurt", "attack", "death"]:
    sheets = sorted(DIR.glob(f"evolved_{anim}*.png"))
    if not sheets:
        continue
    print("="*72)
    for sp in sheets:
        a = alpha(sp)
        t = a.shape[0]
        n = a.shape[1] // t
        ref = tile(a, 0, t)
        rows = []
        for i in range(n):
            if i == 0:
                rows.append("f0 anchor")
                continue
            sc, dx, dy = best_shift(ref, tile(a, i, t))
            rows.append(f"f{i}: dx={dx:2d} dy={dy:2d} ov={sc:.3f}")
        name = sp.stem
        print(f"\n{name:32s}")
        for r in rows:
            print("   " + r)
