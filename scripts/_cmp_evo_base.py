#!/usr/bin/env python3
"""Side-by-side: base evolved frames (row 0) vs imported evo cells (row 1),
bg removed. Cell size = sheet height h. 4x zoom."""
import sys
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"
Z = 6

anim, acc = sys.argv[1], sys.argv[2]
evopath = f"{IMP}/evo_{anim}_{acc}.png"
base = Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA")
evo = Image.open(evopath).convert("RGBA")
ab = np.array(base)
h, w = evo.size[1], evo.size[0]
n = w // h
a = np.array(evo).astype(int)
rgb = a[:, :, :3]
border = np.concatenate([rgb[0], rgb[h - 1], rgb[:, 0], rgb[:, w - 1]], axis=0)
from collections import Counter
bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
ink = np.abs(rgb - bg).sum(axis=2) > 60

t = 64
nb = ab.shape[1] // t
cell_rows = max(h, 64)
canvas = np.zeros((2 * cell_rows * Z, (nb + n) * t * Z, 4), dtype=np.uint8)


def draw_frame(arr, row, col, zoom, data_h=None, data_w=None):
    data_h = data_h or arr.shape[0]
    data_w = data_w or arr.shape[1]
    block = np.zeros((cell_rows, t, 4), dtype=np.uint8)
    block[:data_h, :data_w] = arr
    zf = np.kron(block, np.ones((zoom, zoom, 1), dtype=np.uint8))
    canvas[row * cell_rows * zoom:(row + 1) * cell_rows * zoom,
           col * t * zoom:(col + 1) * t * zoom] = zf


for i in range(nb):
    f = ab[:, i*t:(i+1)*t]
    draw_frame(f, 0, i, Z)
for i in range(n):
    cell = np.zeros((h, h, 4), dtype=np.uint8)
    cell[:, :, :3] = a[:, i*h:(i+1)*h, :3]
    cell[:, :, 3] = ink[:, i*h:(i+1)*h] * 255
    # place cell in 64-wide slot (data_w = h cols, but align block col slots to frame index)
    draw_frame(cell, 1, i, Z, data_h=h, data_w=h)

Image.fromarray(canvas).save(f"_frame_review/cmp_base_{anim}_{acc}.png")
print("saved", f"_frame_review/cmp_base_{anim}_{acc}.png", canvas.shape, f"(evo pitch h={h}, n={n})")
