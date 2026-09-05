#!/usr/bin/env python3
"""For each walk accessory frame compute shift to center chest at 32, then the
left/right clip (pixels pushed outside the 64px tile)."""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")

for name in sorted([p.stem for p in DIR.glob("evolved_walk*.png")]):
    if name == "evolved_walk":
        continue
    a = np.array(Image.open(DIR / f"{name}.png").convert("RGBA"))[:, :, 3] > 0
    t = 64
    n = a.shape[1] // t
    res = []
    for i in range(n):
        tile = a[:, i*t:(i+1)*t]
        ys, xs = np.nonzero(tile[30:50, :])
        c = xs.mean() if len(xs) else -1
        s = round(32 - c)
        all_y, all_x = np.nonzero(tile)
        nx0 = all_x.min() + s
        nx1 = all_x.max() + s
        res.append(f"f{i}:s={s:+d} clipL={-nx0 if nx0<0 else 0} clipR={nx1-63 if nx1>63 else 0}")
    print(f"{name:24s} " + "  ".join(res))
