#!/usr/bin/env python3
"""Per-frame body (chest rows 30..50) x-centroid and left/right margins for each
walk accessory sheet, to decide fix strategy."""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")

for name in sorted([p.stem for p in DIR.glob("evolved_idle*.png")]):
    a = np.array(Image.open(DIR / f"{name}.png").convert("RGBA"))[:, :, 3] > 0
    t = 64
    n = a.shape[1] // t
    centers = []
    margins = []
    xmins, xmaxs = [], []
    for i in range(n):
        tile = a[:, i*t:(i+1)*t]
        band = tile[30:50, :]
        ys, xs = np.nonzero(band)
        centers.append(xs.mean() if len(xs) else -1)
        all_ys, all_xs = np.nonzero(tile)
        xmins.append(all_xs.min()); xmaxs.append(all_xs.max())
        # margins in the shifted direction unknown yet; report min/max
    cs = [c for c in centers if c >= 0]
    print(f"{name:26s} chestCenter spread={max(cs)-min(cs):4.1f}  "
          f"centers=" + " ".join(f"{c:4.1f}" for c in centers) +
          f"   xSpan=({min(xmins)}..{max(xmaxs)})")
