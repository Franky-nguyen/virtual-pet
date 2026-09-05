#!/usr/bin/env python3
"""Zoom grid of rebuilt accessory idle (top) & walk (bottom) sheets for review."""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")
T = 64
Z = 8
ACC = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]

for acc in ACC:
    for anim in ["idle", "walk"]:
        a = np.array(Image.open(DIR / f"evolved_{anim}_{acc}.png").convert("RGBA"))
        n = a.shape[1] // T
        canvas = np.zeros((1 * T * Z, n * T * Z, 4), dtype=np.uint8)
        for i in range(n):
            f = a[:, i*T:(i+1)*T]
            zf = np.kron(f, np.ones((Z, Z, 1), dtype=np.uint8))
            canvas[:, i*T*Z:(i+1)*T*Z] = zf
        Image.fromarray(canvas).save(f"_frame_review/fixed_{anim}_{acc}_z{Z}.png")
print("saved review strips")
