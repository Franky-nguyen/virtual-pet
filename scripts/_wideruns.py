#!/usr/bin/env python3
import numpy as np
from PIL import Image
from collections import Counter
import os

IMP = r"src\assets\evo acessories"
for f in sorted(os.listdir(IMP)):
    a = np.array(Image.open(os.path.join(IMP, f)).convert("RGBA")).astype(int)
    H, W = a.shape[:2]
    rgb = a[:, :, :3]
    border = np.concatenate([rgb[0], rgb[H-1], rgb[:, 0], rgb[:, -1]], axis=0)
    bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
    ink = np.abs(rgb - bg).sum(axis=2) > 50
    occ = ink.sum(axis=0)
    runs = []; in_run = False
    for x in range(W):
        if occ[x] > 0 and not in_run:
            s = x; in_run = True
        elif occ[x] == 0 and in_run:
            runs.append((s, x-1)); in_run = False
    if in_run:
        runs.append((s, W-1))
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 3:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    widths = [r[1]-r[0]+1 for r in merged]
    if max(widths) > 62:
        print(f, H, widths)
