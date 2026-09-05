#!/usr/bin/env python3
"""Measure dog vertical/horizontal ink span per cell for a few sheets."""
import numpy as np
from PIL import Image
from collections import Counter

IMP = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"


def sheet_info(path, want):
    a = np.array(Image.open(path).convert("RGBA")).astype(int)
    H, W = a.shape[0], a.shape[1]
    rgb = a[:, :, :3]
    border = np.concatenate([rgb[0], rgb[H - 1], rgb[:, 0], rgb[:, -1]], axis=0)
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
    print(f"{path.split('/')[-1]} H={H} runs={len(runs)} (want {want})")
    for i, (x0, x1) in enumerate(runs[:want]):
        ys, xs = np.nonzero(ink[:, x0:x1 + 1])
        if len(xs):
            print(f"  f{i}: rows {ys.min()}..{ys.max()}  cols(global) {x0}..{x1} (w={x1-x0+1})")


for f, want in [("evo_idle_bowtie.png", 6), ("evo_idle_cown.png", 6),
                ("evo_attack_wizardhat.png", 4), ("evo_walk_crown.png", 8),
                ("evo_hurt_bowtie.png", 3)]:
    sheet_info(f"{IMP}/{f}", want)

# base dog rows
for anim in ["idle", "hurt", "walk"]:
    a = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
    mask = a[:, :, 3] > 0
    n = a.shape[1] // 64
    print(f"base {anim}:")
    for i in range(n):
        tile = mask[:, i*64:(i+1)*64]
        ys, xs = np.nonzero(tile)
        if len(xs):
            print(f"  f{i}: rows {ys.min()}..{ys.max()} cols {xs.min()}..{xs.max()}")
