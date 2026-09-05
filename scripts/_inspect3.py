#!/usr/bin/env python3
"""Deep inspection of imported 'evo acessories' sheets:
 - background colour(s) and how much of the image is background
 - per-frame segmentation via content-gap detection
 - per-frame content bbox (to see pitch / consistency)
"""
import os
from collections import Counter
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"


def analyze(path):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)
    h, w = a.shape[:2]
    rgb = a[:, :, :3]
    alpha = a[:, :, 3]

    # corner pixels
    corners = [tuple(rgb[0, 0]), tuple(rgb[0, w - 1]), tuple(rgb[h - 1, 0]), tuple(rgb[h - 1, w - 1])]
    border = np.concatenate([rgb[0, :, :], rgb[h - 1, :, :],
                             rgb[:, 0, :], rgb[:, w - 1, :]], axis=0).reshape(-1, 3)
    cnt = Counter(map(tuple, border))
    bg_cand = cnt.most_common(3)

    # how transparent?
    trans_frac = float((alpha == 0).mean())

    # which pixels are "ink"? = different from most common border colour OR non-transparent
    top_bg = tuple(cnt.most_common(1)[0][0])
    ink = (np.abs(rgb.astype(int) - np.array(top_bg)).sum(axis=2) > 40) | (alpha < 200)
    ink_frac = float(ink.mean())

    # column occupancy of ink
    col_occ = ink.sum(axis=0)
    # find content runs
    runs = []
    in_run = False
    for x in range(w):
        if col_occ[x] > 0 and not in_run:
            start = x
            in_run = True
        elif col_occ[x] == 0 and in_run:
            runs.append((start, x - 1))
            in_run = False
    if in_run:
        runs.append((start, w - 1))

    return {
        "size": (w, h), "corners": corners, "bg_candidates": bg_cand,
        "trans_frac": trans_frac, "ink_frac": ink_frac, "runs": runs,
    }


print("file                          size      bg(border)most      trans%  ink%   content-column-runs")
for f in sorted(os.listdir(IMP)):
    if not f.endswith(".png"):
        continue
    r = analyze(os.path.join(IMP, f))
    w, h = r["size"]
    bgs = ",".join(f"({c[0][0]},{c[0][1]},{c[0][2]})x{c[1]}" for c in r["bg_candidates"][:2])
    runstr = ";".join(f"{s}-{e}" for s, e in r["runs"][:12])
    if len(r["runs"]) > 12:
        runstr += f"...(+{len(r['runs'])-12})"
    print(f"{f:30s} {w:3d}x{h:<3d}  {bgs:24s} {r['trans_frac']*100:5.1f}  {r['ink_frac']*100:5.1f}  {runstr}")
