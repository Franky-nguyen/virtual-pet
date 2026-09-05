#!/usr/bin/env python3
"""Zoom individual base idle/walk frames for close visual diff."""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")
T = 64
Z = 10

def sheet_frames(name):
    im = Image.open(DIR / f"{name}.png").convert("RGBA")
    a = np.array(im)
    n = a.shape[1] // T
    return [a[:, i*T:(i+1)*T] for i in range(n)]

idle = sheet_frames("evolved_idle")
walk = sheet_frames("evolved_walk")

def save_grid(name, frames, cols, path):
    rows = (len(frames) + cols - 1) // cols
    canvas = np.zeros((rows * T * Z, cols * T * Z, 4), dtype=np.uint8)
    for k, f in enumerate(frames):
        zf = np.kron(f, np.ones((Z, Z, 1), dtype=np.uint8))
        r, c = divmod(k, cols)
        canvas[r*T*Z:(r+1)*T*Z, c*T*Z:(c+1)*T*Z] = zf
    Image.fromarray(canvas).save(path)

save_grid("idle", idle, 6, "_frame_review/evo_idle_zoom10.png")
save_grid("walk", walk, 8, "_frame_review/evo_walk_zoom10.png")
print("ok")
