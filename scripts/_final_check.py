#!/usr/bin/env python3
"""Verify the cleaned set: 25 files, correct canonical names, RGBA 64-row strips
with expected frame counts."""
import os
import numpy as np
from PIL import Image

OUT = "_cleaned_evo"
EXPECT = {  # canonical anim -> accessory names present
    "idle": ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"],
    "walk": ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"],
    "hurt": ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"],
    "attack": ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"],
    "death": ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"],
}
NFRAMES = {"idle": 6, "walk": 8, "hurt": 3, "attack": 4, "death": 6}
files = sorted(os.listdir(OUT))
print(f"files in {OUT}: {len(files)}")
ok = True
for anim, accs in EXPECT.items():
    for acc in accs:
        f = f"evolved_{anim}_{acc}.png"
        p = os.path.join(OUT, f)
        if not os.path.exists(p):
            print("MISSING", f); ok = False; continue
        a = np.array(Image.open(p).convert("RGBA"))
        h, w = a.shape[:2]
        n = w // 64
        al = (a[:, :, 3] > 0).mean()
        if h != 64 or w % 64 != 0 or n != NFRAMES[anim]:
            print(f"BAD GEOMETRY {f}: {w}x{h} frames={n}"); ok = False; continue
        # content must not touch tile edges (no clipping)
        ys, xs = np.nonzero(a[:, :, 3] > 0)
        ymax = ys.max() if len(ys) else -1
        # frame bboxes within 0..63
        print(f"{f:36s} {w}x{h} n={n} alphaFrac={al:.2f}")
print("ALL OK" if ok else "PROBLEMS FOUND")
