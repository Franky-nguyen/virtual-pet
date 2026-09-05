#!/usr/bin/env python3
"""
Clean the imported 'evo acessories' sheets so they fit the app exactly like the
base evolved sheets.

Strategy (verified against the imports):
  * hurt/attack imports are pixel-composites of the base dog + accessory.
  * idle/walk/death imports are re-drawn accessory art (dog ~1.1x taller, new
    shading) -- cannot be pixel-identical to base, so we register them so the
    dog stands on the SAME ground line and centre as the base dog.

Per imported sheet:
  1. Detect the opaque background colour (dominant border colour) and remove it.
  2. Segment the strip into frames via content-column runs (verified to match
     the expected frame count: idle=6 walk=8 hurt=3 attack=4 death=6).
  3. Anchor each frame onto a transparent 64x64 tile:
       vertical: ground line = that frame's lowest opaque row in the base
                 evolved sheet (always 63 except attack frame 2 = 61).
       horizontal: x-centroid of the whole dog aligned to the base frame's.
  4. Composite: alpha = base silhouette OR import art; colour = import art
     where present, else base colour (fills 1px rims trimmed by background
     removal so outlines stay crisp and match the base dog).
  5. Write transparent RGBA strips named evolved_{anim}_{acc}.png with
     canonical accessory names (cown->crown, sunglass->sunglasses).

Output goes to _cleaned_evo/ for review before installing into the app.
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
ACC_OF = {  # file accessory token -> canonical accessory name
    "bowtie": "bowtie", "crown": "crown", "cown": "crown",
    "partyhat": "partyhat", "sunglass": "sunglasses", "wizardhat": "wizardhat",
}
ANIM_FILES = {  # accessory tokens actually present per animation
    "idle": ["bowtie", "cown", "partyhat", "sunglass", "wizardhat"],
    "walk": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "hurt": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "attack": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "death": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
}

os.makedirs(OUT, exist_ok=True)


def base_frames(anim):
    a = np.array(Image.open(os.path.join(EVO, f"evolved_{anim}.png")).convert("RGBA"))
    n = a.shape[1] // T
    return [a[:, i*T:(i+1)*T].copy() for i in range(n)]


def import_cells(anim, acc):
    """Return (rgb, ink) per frame cell of the imported sheet."""
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


def place(base, cell, ground_row, ):
    """Anchor cell onto a 64x64 tile aligned to base's ground & x-centroid.
    Returns 64x64 tile (RGBA) with import art painted over base silhouette."""
    cell_rgb, cell_ink = cell
    ch, cw = cell_ink.shape
    # --- vertical anchor
    rows_with_ink = np.nonzero(cell_ink.any(axis=1))[0]
    lr = int(rows_with_ink.max()) if len(rows_with_ink) else 0
    oy = ground_row - lr
    # --- horizontal anchor: whole-silhouette x-centroid
    ys, xs = np.nonzero(cell_ink)
    import_xc = xs.mean()
    bm = base[:, :, 3] > 0
    bys, bxs = np.nonzero(bm)
    base_xc = bxs.mean()
    dx = int(round(base_xc - import_xc))
    dx = max(-12, min(12, dx))

    # build art tile: shifted import ink+colour
    art = np.zeros((T, T, 4), dtype=np.uint8)
    y0c, y1c = max(0, -oy), min(ch, T - oy)      # cell row range that fits
    for cy in range(y0c, y1c):
        ty = cy + oy
        for cx in range(cw):
            tx = cx + dx
            if 0 <= tx < T and cell_ink[cy, cx]:
                c = cell_rgb[cy, cx]
                # drop neutral 'shadow'/halo pixels outside the base silhouette
                if not bm[ty, tx]:
                    spread = int(c.max() - c.min())
                    if spread <= 16:
                        continue
                art[ty, tx, :3] = c
                art[ty, tx, 3] = 255
    am = art[:, :, 3] > 0

    # compose
    out = np.zeros((T, T, 4), dtype=np.uint8)
    out[:, :, 3] = np.where(bm | am, 255, 0)
    out[:, :, :3] = base[:, :, :3]                     # base colour as backdrop
    out[:, :, :3] = np.where(am[..., None], art[:, :, :3], out[:, :, :3])
    return out


report = []
for anim, accs in ANIM_FILES.items():
    bframes = base_frames(anim)
    for acc in accs:
        cells = import_cells(anim, acc)
        canon = ACC_OF[acc]
        if len(cells) != len(bframes):
            report.append(f"{anim}_{acc}: expected {len(bframes)} frames, got {len(cells)} -> SKIP")
            continue
        strip = np.zeros((T, T * len(cells), 4), dtype=np.uint8)
        grounds = []
        for i, cell in enumerate(cells):
            base = bframes[i]
            gtile = base[:, :, 3].copy()
            gmask = gtile > 0
            gys = np.nonzero(gmask.any(axis=1))[0]
            ground_row = int(gys.max()) if len(gys) else 63
            grounds.append(ground_row)
            tile = place(base, cell, ground_row)
            strip[:, i*T:(i+1)*T] = tile
        Image.fromarray(strip).save(os.path.join(OUT, f"evolved_{anim}_{canon}.png"))
        report.append(f"{anim}_{canon:11s} frames={len(cells)} grounds={grounds}")

print("\n".join(report))
print("done ->", OUT)
