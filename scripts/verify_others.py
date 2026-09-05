#!/usr/bin/env python3
"""Measure internal stability of hurt/attack/death accessory sheets: chest-centre
lurch per frame and accessory band lock. Death/attack have real motion, so we
report consecutive-frame centre deltas (they may legitimately move a few px)."""
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


for anim in ["hurt", "attack", "death"]:
    print("=" * 60)
    for acc in ACC + ["base"]:
        suffix = "" if acc == "base" else f"_{acc}"
        frames = load_frames(f"evolved_{anim}{suffix}")
        cs = [center_band(f, 26, 50) for f in frames]
        # per-frame centre delta to previous frame
        deltas = [f"{cs[i]-cs[i-1]:+4.1f}" for i in range(1, len(cs))]
        spread = max(cs) - min(cs)
        print(f"{anim:6s} {acc:11s} spread={spread:4.1f} centers={' '.join(f'{c:4.1f}' for c in cs)}")
        print(f"{'':19s} deltas: {' '.join(deltas)}")
