#!/usr/bin/env python3
"""Per-file: expected vs detected frame counts via content runs, min gap between
frames, and bottom-row colour sampling (shadow check)."""
import os
from collections import Counter
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"
EXPECT = {"idle": 6, "walk": 8, "hurt": 3, "attack": 4, "death": 6}

print(f"{'file':32s} want got  minGap  bottomRowColours(sample)")
for f in sorted(os.listdir(IMP)):
    if not f.endswith(".png"):
        continue
    anim = f.split("_")[1]
    a = np.array(Image.open(os.path.join(IMP, f)).convert("RGBA")).astype(int)
    H, W = a.shape[0], a.shape[1]
    rgb = a[:, :, :3]
    border = np.concatenate([rgb[0], rgb[H-1], rgb[:, 0], rgb[:, -1]], axis=0)
    bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
    ink = np.abs(rgb - bg).sum(axis=2) > 50
    col_occ = ink.sum(axis=0)
    runs, in_run = [], False
    for x in range(W):
        if col_occ[x] > 0 and not in_run:
            s = x; in_run = True
        elif col_occ[x] == 0 and in_run:
            runs.append((s, x - 1)); in_run = False
    if in_run:
        runs.append((s, W - 1))
    # gaps between runs
    gaps = [runs[i+1][0] - runs[i][1] - 1 for i in range(len(runs) - 1)]
    min_gap = min(gaps) if gaps else -1
    # bottom row: are feet at the last row with ink? collect row of lowest ink
    rows_with_ink = np.nonzero(ink.any(axis=1))[0]
    lowest = rows_with_ink.max() if len(rows_with_ink) else -1
    # sample bottom colours in first frame region
    first = runs[0]
    bot = rgb[lowest, first[0]:first[1]+1] if lowest >= 0 else []
    uniq = Counter(map(tuple, bot)).most_common(3) if len(bot) else []
    print(f"{f:32s} {EXPECT[anim]:3d} {len(runs):3d}  {min_gap:4d}   lowestRow={lowest}/{H-1}  bottomCols={uniq}")
