#!/usr/bin/env python3
"""Before/after side-by-side grids: old (backup) vs new accessory walk sheets."""
from pathlib import Path
import numpy as np
from PIL import Image

EVO = Path("src/assets/pets/evolved")
BAK = Path("_backup_evo")
OUT = Path("_frame_review")
T = 64
Z = 5
ACC = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]

for acc in ACC:
    old = np.array(Image.open(BAK / f"evolved_walk_{acc}.png").convert("RGBA"))
    new = np.array(Image.open(EVO / f"evolved_walk_{acc}.png").convert("RGBA"))
    n = old.shape[1] // T
    cols = n + 1  # old frames | separator | new frames
    rows = 1
    canvas = np.zeros((T * Z, (n * 2 + 1) * T * Z, 4), dtype=np.uint8)
    col = 0
    for src in (old, new):
        for i in range(n):
            f = src[:, i*T:(i+1)*T]
            canvas[:, col*T*Z:(col+1)*T*Z] = np.kron(f, np.ones((Z, Z, 1), dtype=np.uint8))
            col += 1
        if src is old:
            canvas[:, col*T*Z:(col+1)*T*Z] = 0  # separator column
            col += 1
    Image.fromarray(canvas).save(OUT / f"cmp_walk_{acc}.png")

print("saved before/after grids")
