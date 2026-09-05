#!/usr/bin/env python3
"""Diff overlay: imported cell (bg removed, aligned) vs base frame.
red = import-only, blue = base-only, white = both same, black = both transparent,
grey = present in both but different colour."""
import sys
from collections import Counter
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"
Z = 12

anim, acc, idx = sys.argv[1], sys.argv[2], int(sys.argv[3])
# --- base frame
ab = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
bt = ab[:, idx*64:(idx+1)*64]
bm = bt[:, :, 3] > 0
# --- imported cell via content-run segmentation
a = np.array(Image.open(f"{IMP}/evo_{anim}_{acc}.png").convert("RGBA")).astype(int)
H, W = a.shape[0], a.shape[1]
rgb = a[:, :, :3]
border = np.concatenate([rgb[0], rgb[H-1], rgb[:, 0], rgb[:, -1]], axis=0)
bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
ink = np.abs(rgb - bg).sum(axis=2) > 60
col_occ = ink.sum(axis=0)
runs, in_run = [], False
for x in range(W):
    if col_occ[x] > 0 and not in_run:
        s = x; in_run = True
    elif col_occ[x] == 0 and in_run:
        runs.append((s, x-1)); in_run = False
if in_run:
    runs.append((s, W-1))
merged = []
for r in runs:
    if merged and r[0]-merged[-1][1] <= 3:
        merged[-1] = (merged[-1][0], r[1])
    else:
        merged.append(r)
x0, x1 = merged[idx]
cell_rgb = rgb[:, x0:x1+1]
cell_ink = ink[:, x0:x1+1]

# --- align: find best (dy,dx) maximizing exact-match over base body
best = (-1, None)
for dy in range(-6, 7):
    for dx in range(-6, 7):
        # build shifted evo on 64x64
        e = np.zeros((64, 64, 3), dtype=int)
        m = np.zeros((64, 64), dtype=bool)
        for y in range(64):
            sy = y - dy
            if sy < 0 or sy >= cell_rgb.shape[0]:
                continue
            for x in range(64):
                sx = x - dx
                if sx < 0 or sx >= cell_rgb.shape[1]:
                    continue
                if cell_ink[sy, sx]:
                    e[y, x] = cell_rgb[sy, sx]
                    m[y, x] = True
        inter = bm & m
        n = inter.sum()
        if n < 50:
            continue
        eq = (np.abs(bt[:, :, :3].astype(int)[inter] - e[inter]).sum(axis=1) < 30).sum()
        score = eq / n + n / bm.sum()
        if score > best[0]:
            best = (score, (dy, dx, e, m))
dy, dx, e, m = best[1]
# --- overlay
out = np.zeros((64, 64, 4), dtype=np.uint8)
both = bm & m
out[both] = (200, 200, 200, 255)          # default grey (present both)
same = both & (np.abs(bt[:, :, :3].astype(int) - e).sum(axis=2) < 30)
out[same] = (255, 255, 255, 255)          # identical
out[bm & ~m] = (70, 90, 255, 255)         # base only: blue
out[~bm & m] = (255, 60, 60, 255)         # import only: red
zf = np.kron(out, np.ones((Z, Z, 1), dtype=np.uint8))
# add base frame on left, import on right? no: single overlay
Image.fromarray(zf).save(f"_frame_review/diff_{anim}_{acc}_f{idx}.png")
ninter = int((bm & m).sum())
nsame = int((same).sum())
print(f"{anim}_{acc} f{idx}: aligned@({dx:+d},{dy:+d}) inter={ninter} same={nsame} "
      f"same%={100*nsame/max(1,ninter):.0f}  baseonly={(bm&~m).sum()} importonly={(~bm&m).sum()}")
