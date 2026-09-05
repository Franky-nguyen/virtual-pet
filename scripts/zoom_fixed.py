#!/usr/bin/env python3
"""Per-frame zoom tiles of one rebuilt walk sheet in a 4x2 grid (readable)."""
from pathlib import Path
import sys
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")
T = 64
Z = 10
acc = sys.argv[1] if len(sys.argv) > 1 else "crown"
a = np.array(Image.open(DIR / f"evolved_walk_{acc}.png").convert("RGBA"))
n = a.shape[1] // T
cols = 4
rows = (n + cols - 1) // cols
canvas = np.zeros((rows * T * Z, cols * T * Z, 4), dtype=np.uint8)
for i in range(n):
    f = a[:, i*T:(i+1)*T]
    zf = np.kron(f, np.ones((Z, Z, 1), dtype=np.uint8))
    r, c = divmod(i, cols)
    canvas[r*T*Z:(r+1)*T*Z, c*T*Z:(c+1)*T*Z] = zf
Image.fromarray(canvas).save(f"_frame_review/fixed_walk_{acc}_zoom.png")
print("saved", f"_frame_review/fixed_walk_{acc}_zoom.png", canvas.shape)
