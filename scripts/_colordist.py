#!/usr/bin/env python3
"""Colour-distance stats between imported cell and base frame over body overlap."""
import sys
from collections import Counter
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"

def load_base_frame(anim, idx):
    ab = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
    return ab[:, idx*64:(idx+1)*64]

def load_cell(anim, acc, idx):
    a = np.array(Image.open(f"{IMP}/evo_{anim}_{acc}.png").convert("RGBA")).astype(int)
    H = a.shape[0]
    rgb = a[:, :, :3]
    border = np.concatenate([rgb[0], rgb[H-1], rgb[:, 0], rgb[:, -1]], axis=0)
    bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
    ink = np.abs(rgb - bg).sum(axis=2) > 60
    # grid slice: width ~ H per frame (use H pitch, but guard)
    x0 = idx * H
    return rgb[:, x0:x0+H], ink[:, x0:x0+H]

for anim, acc, idx in [("idle", "wizardhat", 0), ("attack", "crown", 0), ("walk", "crown", 2),
                       ("idle", "partyhat", 0), ("hurt", "sunglass", 0)]:
    b = load_base_frame(anim, idx)
    r, m = load_cell(anim, acc, idx)
    # overlap region base body & ink (cell may be H != 64; align y from bottom)
    bh, bw = b.shape[:2]
    dy = bh - r.shape[0]  # place cell bottom-aligned to base bottom (both feet at bottom)
    # simpler: iterate overlap on base rows min
    Hc = min(r.shape[0], bh)
    inter_pix = []
    for yy in range(Hc):
        for xx in range(min(r.shape[1], bw)):
            if m[yy, xx] and b[yy, xx, 3] > 0:
                inter_pix.append((b[yy, xx, :3].astype(int), r[yy, xx]))
    if not inter_pix:
        print(anim, acc, "no inter")
        continue
    d = np.abs(np.array([x[0] for x in inter_pix]) - np.array([x[1] for x in inter_pix])).sum(axis=1)
    print(f"{anim}_{acc} f{idx}: n_inter={len(d)} mean_abs_diff={d.mean():.1f} "
          f"p25={np.percentile(d,25):.0f} med={np.median(d):.0f} p90={np.percentile(d,90):.0f} "
          f"<30px={100*(d<30).mean():.0f}%  <80px={100*(d<80).mean():.0f}%")
