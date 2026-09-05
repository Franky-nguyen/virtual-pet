#!/usr/bin/env python3
"""Measure whether the accessory stays locked to the head across frames.

For top-worn accessories (crown, partyhat, wizardhat) the accessory occupies
roughly rows [0, head_top+2]. Body head sits around rows [~16..30]. Compute:
  - accessory_center_x = x centroid of pixels in accessory rows (top strip)
  - body_center_x      = x centroid of pixels in rows [head_bottom_zone..63]?
Actually simpler & robust: accessory row window [0..14], body window [24..44].
Report per-frame accessory x-center minus body x-center (delta). If delta is
stable across frames, accessory is locked; if it swings, the accessory wobbles
independently of the body.
"""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")

for acc in ["crown", "partyhat", "wizardhat", "sunglasses", "bowtie"]:
    for anim in ["idle", "walk"]:
        p = DIR / f"evolved_{anim}_{acc}.png"
        if not p.exists():
            continue
        a = np.array(Image.open(p).convert("RGBA"))[:, :, 3] > 0
        t = 64
        n = a.shape[1] // t
        rows = []
        for i in range(n):
            tile = a[:, i*t:(i+1)*t]
            def cx(r0, r1):
                ys, xs = np.nonzero(tile[r0:r1])
                return xs.mean() if len(xs) else float('nan')
            acc_top = cx(0, 15)
            body = cx(24, 46)
            delta = acc_top - body
            rows.append(delta)
        d = max(rows) - min(rows) if rows else -1
        print(f"{anim:5s} {acc:12s} acc2body d={d:4.1f}  deltas=" + " ".join(f"{v:4.1f}" for v in rows))
