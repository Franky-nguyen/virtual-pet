#!/usr/bin/env python3
"""
Clean the imported 'evo acessories' sheets so they fit the app exactly like the
base evolved sheets.

For each imported sheet:
  1. Detect the opaque background colour (dominant border colour) and remove it.
  2. Segment the strip into frames via content-column runs (verified to match
     the expected frame count: idle=6 walk=8 hurt=3 attack=4 death=6).
  3. Register each frame onto a transparent 64x64 tile so its dog silhouette
     overlaps the same-index base evolved frame as tightly as possible (IoU).
  4. Composite: start from the clean base frame (crisp alpha + identical body
     art), then paint the imported art (dog + accessory) over it where it
     differs, and fill 1px silhouette rims with base colour so outlines match
     the base dog exactly.
  5. Write transparent RGBA strips named evolved_{anim}_{acc}.png (canonical
     accessory names: cown->crown, sunglass->sunglasses).

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
GROUPS = {
    "idle": ["bowtie", "cown", "partyhat", "sunglass", "wizardhat"],
    "walk": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "hurt": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "attack": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "death": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
}
CANON = {"bowtie": "bowtie", "crown": "crown", "cown": "crown",
         "partyhat": "partyhat", "sunglass": "sunglasses", "wizardhat": "wizardhat"}

os.makedirs(OUT, exist_ok=True)


def load_base_frames(anim):
    a = np.array(Image.open(os.path.join(EVO, f"evolved_{anim}.png")).convert("RGBA"))
    n = a.shape[1] // T
    return [a[:, i*T:(i+1)*T].copy() for i in range(n)]


def import_sheet(anim, acc):
    """Return list of (rgb, ink) cells for the imported sheet."""
    path = os.path.join(IMP, f"evo_{anim}_{acc}.png")
    a = np.array(Image.open(path).convert("RGBA")).astype(int)
    H, W = a.shape[0], a.shape[1]
    rgb = a[:, :, :3]
    border = np.concatenate([rgb[0], rgb[H-1], rgb[:, 0], rgb[:, -1]], axis=0)
    bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
    ink = np.abs(rgb - bg).sum(axis=2) > BG_THRESH
    # frame segmentation via content runs
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
    cells = []
    for (x0, x1) in merged:
        cells.append((rgb[:, x0:x1+1].copy(), ink[:, x0:x1+1].copy()))
    return cells


def best_shift(cell_ink, base_mask):
    """Find (dy,dx) that maximises IoU of shifted ink with base alpha mask."""
    ch, cw = cell_ink.shape
    base_area = int(base_mask.sum())
    best = (-1.0, 0, 0)
    for dy in range(-12, 13):
        for dx in range(-16, 17):
            m = np.zeros((T, T), dtype=bool)
            y0 = max(0, dy)
            y1 = min(T, ch + dy)
            x0 = max(0, dx)
            x1 = min(T, cw + dx)
            if y1 <= y0 or x1 <= x0:
                continue
            cy0, cy1 = y0 - dy, y1 - dy
            cx0, cx1 = x0 - dx, x1 - dx
            sub = cell_ink[cy0:cy1, cx0:cx1]
            if not sub.any():
                continue
            m[y0:y1, x0:x1] = sub
            m_area = int(m.sum())
            inter = int((m & base_mask).sum())
            iou = inter / (base_area + m_area - inter) if inter else 0.0
            if iou > best[0]:
                best = (iou, dy, dx)
    return best


def composite(base, cell, dy, dx):
    """base: 64x64 RGBA frame. cell: (rgb, ink). Returns 64x64 RGBA tile."""
    cell_rgb, cell_ink = cell
    ch, cw = cell_ink.shape
    # project cell art onto the tile at (dy,dx)
    art = np.zeros((T, T, 4), dtype=np.uint8)  # rgba art
    for y in range(T):
        cy = y - dy
        if cy < 0 or cy >= ch:
            continue
        for x in range(T):
            cx = x - dx
            if cx < 0 or cx >= cw:
                continue
            if cell_ink[cy, cx]:
                art[y, x, :3] = cell_rgb[cy, cx]
                art[y, x, 3] = 255
    out = base.copy()
    bm = base[:, :, 3] > 0
    brgb = base[:, :, :3].astype(int)
    for y in range(T):
        for x in range(T):
            if art[y, x, 3] == 0:
                continue
            c = art[y, x, :3].astype(int)
            if bm[y, x]:
                # inside base body: paint only if colour differs from base body
                d = int(np.abs(brgb[y, x] - c).sum())
                if d < 30:
                    continue  # identical body pixel -> keep base
                out[y, x] = art[y, x]
            else:
                # outside base: drop neutral "shadow" pixels (greyish, darker than bg)
                spread = int(c.max() - c.min())
                if spread <= 18:
                    continue
                out[y, x] = art[y, x]
    return out


report = []
for anim, accs in GROUPS.items():
    base_frames = load_base_frames(anim)
    for acc in accs:
        cells = import_sheet(anim, acc)
        canon = CANON[acc]
        if len(cells) != len(base_frames):
            report.append(f"{anim}_{acc}: expected {len(base_frames)} frames, got {len(cells)} -> SKIP")
            print(f"{anim}_{acc}: frame count mismatch -> SKIP")
            continue
        strip = np.zeros((T, T * len(cells), 4), dtype=np.uint8)
        ious = []
        shifts = []
        for i, cell in enumerate(cells):
            base = base_frames[i]
            bmask = base[:, :, 3] > 0
            iou, dy, dx = best_shift(cell[1], bmask)
            ious.append(iou)
            shifts.append((dy, dx))
            tile = composite(base, cell, dy, dx)
            strip[:, i*T:(i+1)*T] = tile
        Image.fromarray(strip).save(os.path.join(OUT, f"evolved_{anim}_{canon}.png"))
        report.append(f"{anim}_{canon:11s} frames={len(cells)} avgIoU={np.mean(ious)*100:.0f}% "
                      f"minIoU={min(ious)*100:.0f}%  shifts=" +
                      " ".join(f"({s[0]:+d},{s[1]:+d})" for s in shifts))

print("\n".join(report))
print("done ->", OUT)
