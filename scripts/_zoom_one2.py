#!/usr/bin/env python3
"""Render one cleaned frame over a checker with red base outline at high zoom."""
import sys
import numpy as np
from PIL import Image

CLEAN = "_cleaned_evo"
EVO = "src/assets/pets/evolved"
anim, acc, idx, zoom = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
strip = np.array(Image.open(f"{CLEAN}/evolved_{anim}_{acc}.png").convert("RGBA"))
tile = strip[:, idx*64:(idx+1)*64]
base = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
bf = base[:, idx*64:(idx+1)*64]
m = bf[:, :, 3] > 0
edge = m & ~(np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1))
chk = np.zeros((64, 64, 3), dtype=np.uint8)
for yy in range(64):
    for xx in range(64):
        chk[yy, xx] = (235, 235, 235) if ((yy // 8 + xx // 8) % 2 == 0) else (210, 210, 210)
comp = Image.alpha_composite(Image.fromarray(chk).convert("RGBA"),
                             Image.fromarray(tile).convert("RGBA"))
big = np.array(comp.resize((64*zoom, 64*zoom), Image.NEAREST))
for yy in range(64):
    for xx in range(64):
        if edge[yy, xx]:
            big[yy*zoom:(yy+1)*zoom, xx*zoom:(xx+1)*zoom] = (255, 60, 60, 255)
out = f"_frame_review/zoom_final_{anim}_{acc}_f{idx}.png"
Image.fromarray(big).save(out)
print("saved", out)
