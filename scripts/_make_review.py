#!/usr/bin/env python3
"""Build review contact sheets: base dog + overlay composite, all frames."""
import os
import numpy as np
from PIL import Image

EVO = "src/assets/pets/evolved"
OUTD = "_overlay_qa"
os.makedirs(OUTD, exist_ok=True)
ACCS = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]
SC = 4

for anim in ["idle", "walk"]:
    base = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
    n = base.shape[1] // 64
    for acc in ACCS:
        ov = np.array(Image.open(f"{EVO}/overlay_{acc}_{anim}.png").convert("RGBA"))
        cells = []
        for i in range(n):
            b = base[:, i*64:(i+1)*64].copy()
            o = ov[:, i*64:(i+1)*64]
            m = o[:, :, 3] > 0
            b[m] = o[m]
            cells.append(b)
        strip = np.concatenate(cells, axis=1)
        im = Image.fromarray(strip).resize((strip.shape[1]*SC, strip.shape[0]*SC), Image.NEAREST)
        p = f"{OUTD}/review_{acc}_{anim}.png"
        im.convert("RGB").save(p)
        print(p)
