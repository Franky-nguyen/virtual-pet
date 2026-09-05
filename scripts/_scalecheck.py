#!/usr/bin/env python3
"""Measure dog body size ratio import-vs-base (height/width of the opaque span
of the lower 'body-only' rows) to gauge scale differences."""
import os
from collections import Counter
import numpy as np
from PIL import Image

EVO = "src/assets/pets/evolved"
IMP = r"src\assets\evo acessories"

ACC_OF = {"bowtie": "bowtie", "crown": "crown", "cown": "crown", "partyhat": "partyhat",
          "sunglass": "sunglasses", "wizardhat": "wizardhat"}
ANIMS = ["idle", "walk", "death"]

for anim in ANIMS:
    b = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
    nb = b.shape[1] // 64
    b_masks = [(b[:, i*64:(i+1)*64][:, :, 3] > 0) for i in range(nb)]
    b_h = []
    b_w = []
    for i in range(nb):
        ys, xs = np.nonzero(b_masks[i])
        b_h.append(ys.max() - ys.min() + 1)
        b_w.append(xs.max() - xs.min() + 1)
    print(f"== base {anim}: h={np.mean(b_h):.0f} w={np.mean(b_w):.0f}")
    for f in sorted(os.listdir(IMP)):
        if not (f.startswith(f"evo_{anim}_") and f.endswith(".png")):
            continue
        a = np.array(Image.open(os.path.join(IMP, f)).convert("RGBA")).astype(int)
        H, W = a.shape[0], a.shape[1]
        rgb = a[:, :, :3]
        border = np.concatenate([rgb[0], rgb[H-1], rgb[:, 0], rgb[:, -1]], axis=0)
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
        merged = []
        for r in runs:
            if merged and r[0] - merged[-1][1] <= 3:
                merged[-1] = (merged[-1][0], r[1])
            else:
                merged.append(r)
        if len(merged) != nb:
            print(f"  {f}: frames {len(merged)} != {nb} skip")
            continue
        hh = []; ww = []
        for i, (x0, x1) in enumerate(merged[:nb]):
            cell = ink[:, x0:x1+1]
            ys, xs = np.nonzero(cell)
            # import ground = lowest row -> anchor bottom same as base(63)
            # dog body height above ground equals base frame's height extent
            hh.append(ys.max() - ys.min() + 1)
            ww.append(xs.max() - xs.min() + 1)
        print(f"  {f:28s} h={np.mean(hh):.0f} (x{np.mean(hh)/np.mean(b_h):.2f}) "
              f"w={np.mean(ww):.0f} (x{np.mean(ww)/np.mean(b_w):.2f})")
