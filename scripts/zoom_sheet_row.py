#!/usr/bin/env python3
"""Zoom row strip of a given rebuilt sheet for visual review."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")
Z = 10
T = 64
sheet = sys.argv[1]
a = np.array(Image.open(DIR / f"{sheet}.png").convert("RGBA"))
n = a.shape[1] // T
canvas = np.zeros((T * Z, n * T * Z, 4), dtype=np.uint8)
for i in range(n):
    f = a[:, i*T:(i+1)*T]
    canvas[:, i*T*Z:(i+1)*T*Z] = np.kron(f, np.ones((Z, Z, 1), dtype=np.uint8))
out = f"_frame_review/fixed_{sheet}_row.png"
Image.fromarray(canvas).save(out)
print("saved", out)
