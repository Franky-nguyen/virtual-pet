#!/usr/bin/env python3
"""Export upscaled single-frame previews (base+overlay) for visual QA."""
import os
import numpy as np
from PIL import Image

EVO = "src/assets/pets/evolved"
OUTD = "_overlay_qa"
os.makedirs(OUTD, exist_ok=True)
ACCS = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]
SC = 8

for anim, frames in [("idle", 6), ("walk", 8)]:
    base = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
    for acc in ACCS:
        ov = np.array(Image.open(f"{EVO}/overlay_{acc}_{anim}.png").convert("RGBA"))
        cells = []
        for i in [0, frames // 2]:
            b = base[:, i*64:(i+1)*64].copy()
            o = ov[:, i*64:(i+1)*64]
            m = o[:, :, 3] > 0
            b[m] = o[m]
            cells.append(np.pad(b, ((1, 1), (1, 1), (0, 0)), constant_values=255))
        strip = np.concatenate(cells, axis=1)
        im = Image.fromarray(strip).resize((strip.shape[1]*SC, strip.shape[0]*SC), Image.NEAREST)
        p = f"{OUTD}/crop_{acc}_{anim}.png"
        im.convert("RGB").save(p)
print("ok")
