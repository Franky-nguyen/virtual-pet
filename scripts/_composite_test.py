#!/usr/bin/env python3
"""Exact composite test at the per-frame level.

For every imported evo_* sheet cell vs the same-index base evolved frame, find
the integer shift that best aligns and report:
  same%  = exact-colour match fraction over the base's opaque body pixels
  cover% = fraction of base body pixels covered by evo ink (not background)
High same%+cover% (>=~0.8) => the sheets are composites of the base evolved art.
"""
import os
from collections import Counter
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"
GROUPS = {
    "idle": ["bowtie", "cown", "partyhat", "sunglass", "wizardhat"],
    "walk": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "hurt": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "attack": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "death": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
}


def best_alignment(base_rgb, base_mask, evo_rgb, evo_mask, rng=3):
    """Evo cell (padded to 64) placed over 64x64. Return best same%,cover%."""
    # pad evo into a 64x64 canvas at origin (0,0); crop if larger than 64
    ep_rgb = np.zeros((64, 64, 3), dtype=int)
    ep_mask = np.zeros((64, 64), dtype=bool)
    Hh, Ww = evo_rgb.shape[:2]
    Hh = min(Hh, 64)
    Ww = min(Ww, 64)
    ep_rgb[:Hh, :Ww] = evo_rgb[:Hh, :Ww]
    ep_mask[:Hh, :Ww] = evo_mask[:Hh, :Ww]
    best = (-1, -1, 0, 0)
    for dy in range(-rng, rng + 1):
        for dx in range(-rng, rng + 1):
            # evo shifted by (dy,dx) within 64 canvas; content outside drops
            e = np.zeros((64, 64, 3), dtype=int)
            m = np.zeros((64, 64), dtype=bool)
            for y in range(64):
                sy = y - dy
                if sy < 0 or sy >= 64:
                    continue
                for x in range(64):
                    sx = x - dx
                    if sx < 0 or sx >= 64:
                        continue
                    if ep_mask[sy, sx]:
                        e[y, x] = ep_rgb[sy, sx]
                        m[y, x] = True
            inter = base_mask & m
            n_inter = inter.sum()
            if n_inter < 50:
                continue
            eq = (np.abs(base_rgb[inter] - e[inter]).sum(axis=1) < 30).sum()
            same = eq / n_inter
            cover = n_inter / max(1, base_mask.sum())
            if same + cover > best[0] + best[1]:
                best = (same, cover, dx, dy)
    return best


for anim, accs in GROUPS.items():
    ab = np.array(Image.open(os.path.join(EVO, f"evolved_{anim}.png")).convert("RGBA"))
    nbase = ab.shape[1] // 64
    print("=" * 78)
    for acc in accs:
        p = os.path.join(IMP, f"evo_{anim}_{acc}.png")
        if not os.path.exists(p):
            print(f"{anim}_{acc:9s} MISSING")
            continue
        a = np.array(Image.open(p).convert("RGBA")).astype(int)
        H = a.shape[0]
        rgb = a[:, :, :3]
        border = np.concatenate([rgb[0], rgb[H - 1], rgb[:, 0], rgb[:, -1]], axis=0)
        bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
        ink = np.abs(rgb - bg).sum(axis=2) > 60
        n = a.shape[1] // H
        res = []
        for i in range(min(n, nbase)):
            bt = ab[:, i*64:(i+1)*64]
            bmask = bt[:, :, 3] > 0
            cell_rgb = rgb[:, i*H:(i+1)*H]
            cell_ink = ink[:, i*H:(i+1)*H]
            same, cover, dx, dy = best_alignment(bt[:, :, :3].astype(int), bmask,
                                                 cell_rgb, cell_ink)
            res.append(f"f{i}:s={same*100:.0f}/c={cover*100:.0f}@({dx:+d},{dy:+d})")
        print(f"{anim}_{acc:9s} [{H}px] " + "  ".join(res))
