#!/usr/bin/env python3
"""
Rebuild idle/walk/death accessory sheets using the UNTOUCHED native art
(no vertical rescale, no base-ghost fill).  This is the pixel-clean path:
every colour/alpha pixel comes straight from the imported sheet, only moved
(ground-anchored + x-centroid-aligned) onto the 64x64 grid.

attack/hurt are pixel-exact composites of the base dog already (drift 0, union
is harmless there), so they are not rebuilt.
"""
import os
from collections import Counter
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"
OUT = "_cleaned_evo"
T = 64
BG_THRESH = 50
ACC_OF = {"bowtie": "bowtie", "crown": "crown", "cown": "crown", "partyhat": "partyhat",
          "sunglass": "sunglasses", "wizardhat": "wizardhat"}
NATIVE = {"idle": ["bowtie", "cown", "partyhat", "sunglass", "wizardhat"],
          "walk": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
          "death": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"]}
os.makedirs(OUT, exist_ok=True)


def base_frames(anim):
    a = np.array(Image.open(os.path.join(EVO, f"evolved_{anim}.png")).convert("RGBA"))
    n = a.shape[1] // T
    return [a[:, i*T:(i+1)*T].copy() for i in range(n)]


def import_cells(anim, acc):
    path = os.path.join(IMP, f"evo_{anim}_{acc}.png")
    a = np.array(Image.open(path).convert("RGBA")).astype(int)
    H, W = a.shape[0], a.shape[1]
    rgb = a[:, :, :3]
    border = np.concatenate([rgb[0], rgb[H-1], rgb[:, 0], rgb[:, -1]], axis=0)
    bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
    ink = np.abs(rgb - bg).sum(axis=2) > BG_THRESH
    col_occ = ink.sum(axis=0)
    runs, in_run = [], False
    for x in range(W):
        if col_occ[x] > 0 and not in_run:
            s = x; in_run = True
        elif col_occ[x] == 0 and in_run:
            runs.append((s, x - 1)); in_run = False
    if in_run:
        runs.append((s, W - 1))
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 3:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    return [(rgb[:, x0:x1+1].copy(), ink[:, x0:x1+1].copy()) for (x0, x1) in merged]


def place_native(base, cell, ground_row):
    """Ground + x-centroid anchor, pure import pixels, no union, no rescale."""
    cell_rgb, cell_ink = cell
    ch, cw = cell_ink.shape
    rows_with_ink = np.nonzero(cell_ink.any(axis=1))[0]
    lr = int(rows_with_ink.max()) if len(rows_with_ink) else 0
    oy = ground_row - lr
    tile = np.zeros((T, T, 4), dtype=np.uint8)
    for cy in range(ch):
        ty = cy + oy
        if not (0 <= ty < T):
            continue
        for cx in range(min(cw, T)):
            if cell_ink[cy, cx]:
                tile[ty, cx, :3] = cell_rgb[cy, cx]
                tile[ty, cx, 3] = 255
    # x-centroid anchor
    bm = base[:, :, 3] > 0
    bys, bxs = np.nonzero(bm)
    base_xc = bxs.mean() if len(bxs) else 31
    tm = tile[:, :, 3] > 0
    txs = np.nonzero(tm.any(axis=0))[0]
    # centroid over whole dog in tile coords (filled rows count weighted)
    ys, xs = np.nonzero(tm)
    imp_xc = xs.mean() if len(xs) else 31
    dx = int(round(base_xc - imp_xc))
    dx = max(-12, min(12, dx))
    if dx:
        out = np.zeros_like(tile)
        if dx > 0:
            out[:, dx:, :] = tile[:, :T-dx, :]
        else:
            out[:, :dx, :] = tile[:, -dx:, :]
        tile = out
    return tile


report = []
for anim, accs in NATIVE.items():
    bframes = base_frames(anim)
    for acc in accs:
        cells = import_cells(anim, acc)
        canon = ACC_OF[acc]
        if len(cells) != len(bframes):
            print(f"{anim}_{acc}: frames {len(cells)} != {len(bframes)} SKIP")
            continue
        strip = np.zeros((T, T * len(cells), 4), dtype=np.uint8)
        for i, cell in enumerate(cells):
            base = bframes[i]
            bm = base[:, :, 3] > 0
            ys = np.nonzero(bm.any(axis=1))[0]
            ground_row = int(ys.max()) if len(ys) else 63
            tile = place_native(base, cell, ground_row)
            strip[:, i*T:(i+1)*T] = tile
        Image.fromarray(strip).save(os.path.join(OUT, f"evolved_{anim}_{canon}.png"))
        report.append(f"{anim}_{canon}")
print("rebuilt:", ", ".join(report))
print("done ->", OUT)
