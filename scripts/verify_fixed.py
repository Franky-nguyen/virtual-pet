#!/usr/bin/env python3
"""Verify rebuilt evolved idle/walk accessory sheets are solid:
 1. chest-centre spread <= 1.5px across frames
 2. no frame content touches the 64px tile edges (>=2px margin)
 3. accessory-to-dog lock: for hats/crown, the accessory band (rows<=22) x-centre
    tracks the head band (rows 23..38) x-centre; spread of the offset <= 2px
"""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")
T = 64
ACC = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]


def load_frames(name):
    a = np.array(Image.open(DIR / f"{name}.png").convert("RGBA"))
    n = a.shape[1] // T
    return [a[:, i*T:(i+1)*T] for i in range(n)]


def center_band(tile, y0, y1):
    band = tile[y0:y1, :, 3] > 0
    _, xs = np.nonzero(band)
    return xs.mean() if len(xs) else -1


for anim in ["idle", "walk"]:
    print("=" * 60)
    for acc in ACC:
        frames = load_frames(f"evolved_{anim}_{acc}")
        cs = [center_band(f, 30, 50) for f in frames]
        spread = max(cs) - min(cs)
        # margins
        l, r = [], []
        for f in frames:
            _, xs = np.nonzero(f[:, :, 3] > 0)
            l.append(xs.min()); r.append(xs.max())
        ml, mr = min(l), max(r)
        # accessory band vs head band lock for top accessories
        lock = []
        for f in frames:
            ac = center_band(f, 3, 22)
            hc = center_band(f, 26, 42)
            if ac >= 0 and hc >= 0:
                lock.append(ac - hc)
        lock_s = f"{max(lock)-min(lock):.1f}px" if lock else "n/a"
        print(f"{anim:4s} {acc:11s} chestSpread={spread:4.1f}  xSpan=({ml:2d}..{mr:2d})  "
              f"centers={' '.join(f'{c:4.1f}' for c in cs)}  accLockDrift={lock_s}")
