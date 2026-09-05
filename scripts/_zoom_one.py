#!/usr/bin/env python3
"""Zoom frame0: base evolved vs imported evo cell (bg removed), 16x, for one (anim,acc)."""
import sys
from collections import Counter
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"
Z = 16

anim, acc, idx = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 0
base = Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA")
evo = Image.open(f"{IMP}/evo_{anim}_{acc}.png").convert("RGBA")
ab = np.array(base)
a = np.array(evo).astype(int)
h, w = a.shape[1], a.shape[0]  # note: a shape (h_img, w_img,4) rows=h_img? careful below

# a shape is (H, W, 4) with H = height = tile pitch
H = a.shape[0]
rgb = a[:, :, :3]
border = np.concatenate([rgb[0], rgb[H - 1], rgb[:, 0], rgb[:, -1]], axis=0)
bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
ink = (np.abs(rgb - bg).sum(axis=2) > 60)

bf = ab[:, idx * 64:(idx + 1) * 64]
cell = np.zeros((H, H, 4), dtype=np.uint8)
cell[:, :, :3] = rgb[:, idx * H:(idx + 1) * H]
cell[:, :, 3] = ink[:, idx * H:(idx + 1) * H] * 255

img = Image.new("RGBA", (2 * 64 * Z, 64 * Z))
def put(arr, col):
    block = np.zeros((64, 64, 4), dtype=np.uint8)
    hh = min(arr.shape[0], 64)
    ww = min(arr.shape[1], 64)
    block[:hh, :ww] = arr[:hh, :ww]
    zf = np.kron(block, np.ones((Z, Z, 1), dtype=np.uint8))
    img.paste(Image.fromarray(zf, "RGBA"), (col * 64 * Z, 0))
put(bf, 0)
put(cell, 1)

img.save(f"_frame_review/zoom_{anim}_{acc}_f{idx}.png")
print("saved", img.size)
