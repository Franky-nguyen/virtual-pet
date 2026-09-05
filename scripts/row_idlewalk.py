#!/usr/bin/env python3
"""Row strips of evolved base idle (6) and walk (8) frames at 5x, labeled."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

DIR = Path("src/assets/pets/evolved")
T = 64
Z = 5

def sheet_frames(name):
    im = Image.open(DIR / f"{name}.png").convert("RGBA")
    a = np.array(im)
    n = a.shape[1] // T
    return [a[:, i*T:(i+1)*T] for i in range(n)]

def row_strip(frames):
    strip = np.zeros((T, T*len(frames), 4), dtype=np.uint8)
    for i, f in enumerate(frames):
        strip[:, i*T:(i+1)*T] = f
    return strip

idle = row_strip(sheet_frames("evolved_idle"))
walk = row_strip(sheet_frames("evolved_walk"))
n_idle = idle.shape[1] // T
n_walk = walk.shape[1] // T
big = np.zeros((T*Z, (n_idle + n_walk + 2) * T * Z, 4), dtype=np.uint8)

def paste(frames_np, start_col, label):
    h, w = frames_np.shape[0], frames_np.shape[1]
    zi = np.kron(frames_np, np.ones((Z, Z, 1), dtype=np.uint8))
    big[0:h*Z, start_col*T*Z:(start_col*T*Z)+w*Z] = zi
    # label
    img = Image.fromarray(big)
    d = ImageDraw.Draw(img)
    d.text((start_col*T*Z + 4, 2), label, fill=(255, 0, 0))
    big[:] = np.array(img)

paste(idle, 0, "IDLE (6)")
paste(walk, n_idle + 1, "WALK (8)")

img = Image.fromarray(big)
img.save("_frame_review/evo_base_idle_vs_walk.png")
print("saved", img.size)
