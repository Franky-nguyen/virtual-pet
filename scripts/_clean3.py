#!/usr/bin/env python3
"""
Final cleaning: idle/walk/death imported accessory art is drawn ~1.1-1.3x taller
than the base dog, so those sheets get a per-sheet vertical squash chosen to
maximise lower-body overlap with the base dog (hats keep their relative size).
attack/hurt are pixel-identical composites already -- left untouched by running
this only for idle/walk/death over the _clean2 outputs OR directly here.

Pipeline per sheet:
  remove bg -> segment frames -> per-frame extract -> choose sheet scale sy ->
  squash vertically anchored at the ground line -> align x-centroid to base ->
  alpha = base silhouette OR import art, colour = import art where present else
  base colour.
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
SCALE_ANIMS = {"idle": ["bowtie", "cown", "partyhat", "sunglass", "wizardhat"],
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


def squash_cell(cell, sy, lr):
    """(unused) kept for reference."""
    return None


def project(base, cell, sy, ground_row):
    """Squash cell art by sy anchored at ground_row and place on a 64x64 tile,
    then shift horizontally so its whole-silhouette x-centroid matches base."""
    cell_rgb, cell_ink = cell
    ch, cw = cell_ink.shape
    rows_with_ink = np.nonzero(cell_ink.any(axis=1))[0]
    lr = int(rows_with_ink.max()) if len(rows_with_ink) else 0
    tile_rgb = np.zeros((T, T, 3), dtype=np.uint8)
    tile_ink = np.zeros((T, T), dtype=bool)
    for ty in range(T):
        d_out = ground_row - ty            # distance above tile ground
        d_in = d_out / sy                  # source distance above cell ground
        cy = int(round(lr - d_in))
        if not (0 <= cy < ch):
            continue
        row = cell_ink[cy]
        tile_ink[ty, :cw] = row
        tile_rgb[ty, :cw] = cell_rgb[cy]
    # x-anchor: shift so whole-silhouette x-centroid matches base
    bm = base[:, :, 3] > 0
    bys, bxs = np.nonzero(bm)
    base_xc = bxs.mean() if len(bxs) else 31
    ys, xs = np.nonzero(tile_ink)
    if len(xs):
        imp_xc = xs.mean()
        dx = int(round(base_xc - imp_xc))
        dx = max(-12, min(12, dx))
        if dx:
            nrgb = np.zeros_like(tile_rgb); nink = np.zeros_like(tile_ink)
            if dx > 0:
                nink[:, dx:] = tile_ink[:, :T-dx]
                nrgb[:, dx:] = tile_rgb[:, :T-dx]
            else:
                nink[:, :dx] = tile_ink[:, -dx:]
                nrgb[:, :dx] = tile_rgb[:, -dx:]
            tile_ink, tile_rgb = nink, nrgb
    return tile_rgb, tile_ink


def compose(base, art, dx, oy_fixed, bm):
    """art: tile-form (already placed) rgb+ink arrays of size T. base: 64 frame.
    Returns 64x64 tile RGBA with base-silhouette union."""
    art_rgb, art_ink = art
    am = art_ink
    out = np.zeros((T, T, 4), dtype=np.uint8)
    out[:, :, 3] = np.where(bm | am, 255, 0)
    out[:, :, :3] = base[:, :, :3]
    out[:, :, :3] = np.where(am[..., None], art_rgb, out[:, :, :3])
    return out


def project(base, cell, sy, ground_row):
    """Return (rgb,ink) tile of the squashed+ground-anchored art, plus nothing."""
    cell_rgb, cell_ink = cell
    ch, cw = cell_ink.shape
    rows_with_ink = np.nonzero(cell_ink.any(axis=1))[0]
    lr = int(rows_with_ink.max()) if len(rows_with_ink) else 0
    oy = ground_row - lr          # cell -> tile offset for ground-anchored full art
    # vertical positions after squash are handled below via direct map
    tile_rgb = np.zeros((T, T, 3), dtype=np.uint8)
    tile_ink = np.zeros((T, T), dtype=bool)
    for ty in range(T):
        d_out = T - 1 - ty            # distance above tile bottom (ground 63)
        if oy > 0:
            # ground stays at 63; content compressed: src distance d_in = d_out/sy
            d_in = d_out / sy
        else:
            d_in = (d_out - 0) / sy
        src_y = int(round(lr - d_in))
        if not (0 <= src_y < ch):
            continue
        for tx in range(T):
            sx = tx  # x anchor handled after by centroid shift
            if sx >= cw:
                continue
            if cell_ink[src_y, sx]:
                tile_ink[ty, tx] = True
                tile_rgb[ty, tx] = cell_rgb[src_y, sx]
    # x-anchor: shift so whole-silhouette x-centroid matches base
    bm = base[:, :, 3] > 0
    bys, bxs = np.nonzero(bm)
    base_xc = bxs.mean() if len(bxs) else 31
    ys, xs = np.nonzero(tile_ink)
    if len(xs):
        imp_xc = xs.mean()
        dx = int(round(base_xc - imp_xc))
        dx = max(-12, min(12, dx))
        if dx:
            nrgb = np.zeros_like(tile_rgb); nink = np.zeros_like(tile_ink)
            if dx > 0:
                nink[:, dx:] = tile_ink[:, :T-dx]
                nrgb[:, dx:] = tile_rgb[:, :T-dx]
            else:
                nink[:, :dx] = tile_ink[:, -dx:]
                nrgb[:, :dx] = tile_rgb[:, -dx:]
            tile_ink, tile_rgb = nink, nrgb
    return tile_rgb, tile_ink


def choose_scale(cells, bframes, anim):
    """Per-sheet vertical scale maximising lower-body silhouette overlap."""
    LROW = 24
    best = (0.86, -1.0)
    for sy10 in range(70, 100):
        sy = sy10 / 100.0
        tot = 0.0
        for i, cell in enumerate(cells):
            base = bframes[i]
            bm = base[:, :, 3] > 0
            ys = np.nonzero(bm.any(axis=1))[0]
            ground_row = int(ys.max()) if len(ys) else 63
            rgb_, ink_ = project(base, cell, sy, ground_row)
            # lower-body rows only, base and import
            lo = ink_[LROW:ground_row+1, :]
            bmlo = bm[LROW:ground_row+1, :]
            inter = int((lo & bmlo).sum())
            union = int(lo.sum()) + int(bmlo.sum()) - inter
            tot += inter / union if inter else 0.0
        if tot > best[1]:
            best = (sy, tot)
    return best


report = []
for anim, accs in SCALE_ANIMS.items():
    bframes = base_frames(anim)
    for acc in accs:
        cells = import_cells(anim, acc)
        canon = ACC_OF[acc]
        if len(cells) != len(bframes):
            print(f"{anim}_{acc}: frames {len(cells)} != {len(bframes)} SKIP")
            continue
        sy, score = choose_scale(cells, bframes, anim)
        strip = np.zeros((T, T * len(cells), 4), dtype=np.uint8)
        for i, cell in enumerate(cells):
            base = bframes[i]
            bm = base[:, :, 3] > 0
            ys = np.nonzero(bm.any(axis=1))[0]
            ground_row = int(ys.max()) if len(ys) else 63
            rgb_, ink_ = project(base, cell, sy, ground_row)
            tile = compose(base, (rgb_, ink_), 0, 0, bm)
            strip[:, i*T:(i+1)*T] = tile
        Image.fromarray(strip).save(os.path.join(OUT, f"evolved_{anim}_{canon}.png"))
        report.append(f"{anim}_{canon:11s} sy={sy:.2f} fit={score/len(cells):.2f}")

print("\n".join(report))
print("done ->", OUT)
