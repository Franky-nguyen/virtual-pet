#!/usr/bin/env python3
"""Compare accessory-sheet tiles to base-sheet tiles of the same animation.

For each accessory sheet vs base sheet, same index: compute alpha overlap
(how much of the base tile's opaque silhouette is present in the accessory
tile) and the best horizontal/vertical shift maximizing overlap (registration
offset). A low overlap at shift 0 => accessory sheets are NOT the base dog +
accessory, they are redrawn art.
"""
import os
from pathlib import Path
from PIL import Image
import numpy as np

DIR = Path("src/assets/pets/evolved")

def alpha_mask(p):
    img = Image.open(p).convert("RGBA")
    a = np.array(img)[:, :, 3]
    return a

def tile(a, i, t):
    return a[:, i * t:(i + 1) * t]

def overlap_and_best_shift(base, acc, search=6):
    """Return (overlap@0, best_dx, best_dy, best_overlap)."""
    best = (-1, 0, 0)
    s0 = None
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            s = acc
            shifted = np.roll(np.roll(acc, dx, axis=1), dy, axis=0)
            # but roll wraps; set wrapped cols/rows to 0 to avoid false positive
            work = shifted.copy()
            if dx > 0:
                work[:, :dx] = 0
            elif dx < 0:
                work[:, dx:] = 0
            if dy > 0:
                work[:dy, :] = 0
            elif dy < 0:
                work[dy:, :] = 0
            inter = np.logical_and(base > 0, work > 0).sum()
            denom = (base > 0).sum()
            score = inter / denom if denom else 0
            if dx == 0 and dy == 0:
                s0 = score
            if score > best[0]:
                best = (score, dx, dy)
    return s0, best

for anim in ["idle", "walk", "hurt", "attack", "death"]:
    base_p = DIR / f"evolved_{anim}.png"
    if not base_p.exists():
        continue
    base = alpha_mask(base_p)
    t = base.shape[0]
    base_frames = base.shape[1] // t
    print(f"\n=== {anim} (base frames={base_frames}) ===")
    for acc_p in sorted(DIR.glob(f"evolved_{anim}_*.png")):
        acc = alpha_mask(acc_p)
        n = acc.shape[1] // t
        name = acc_p.stem.replace("evolved_", "").replace(f"{anim}_", "")
        vals = []
        for i in range(min(base_frames, n)):
            s0, best = overlap_and_best_shift(tile(base, i, t), tile(acc, i, t))
            vals.append(f"f{i}:o={s0:.2f} best({best[1]},{best[2]})={best[0]:.2f}")
        print(f"  {name:14s} " + "  ".join(vals))
