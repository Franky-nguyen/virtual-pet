#!/usr/bin/env python3
"""Base-frame ground rows & import feet rows per sheet (first/last frames); and
x-centroid of lower body band for chest anchoring sanity."""
import os
from collections import Counter
import numpy as np
from PIL import Image

EVO = "src/assets/pets/evolved"
IMP = r"src\assets\evo acessories"

# base ground row (lowest opaque row) per anim per frame
for anim in ["idle", "walk", "hurt", "attack", "death"]:
    a = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
    m = a[:, :, 3] > 0
    n = a.shape[1] // 64
    lows = []
    tops = []
    for i in range(n):
        t = m[:, i*64:(i+1)*64]
        ys = np.nonzero(t.any(axis=1))[0]
        lows.append(ys.max())
        tops.append(ys.min())
    print(f"base {anim}: n={n} lowestRows={lows} topRows={tops}")
