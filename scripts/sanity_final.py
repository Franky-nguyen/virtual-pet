#!/usr/bin/env python3
"""Final sanity: accessory pixels present in rebuilt sheets (diff vs base), and
all PNG dims intact."""
from pathlib import Path
import numpy as np
from PIL import Image

EVO = Path("src/assets/pets/evolved")
T = 64
ACC = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]

base = np.array(Image.open(EVO / "evolved_walk.png").convert("RGBA"))
for acc in ACC:
    a = np.array(Image.open(EVO / f"evolved_walk_{acc}.png").convert("RGBA"))
    assert a.shape == base.shape, f"dims {acc}: {a.shape} != {base.shape}"
    # accessory-only pixels = opaque in accessory frame but transparent in base
    extra = 0
    for i in range(base.shape[1] // T):
        t0 = base[:, i*T:(i+1)*T]
        t1 = a[:, i*T:(i+1)*T]
        extra += int(((t1[:, :, 3] > 0) & (t0[:, :, 3] == 0)).sum())
    print(f"walk_{acc:11s} shape={a.shape}  accessory-only px (all 8 frames) = {extra}")
print("OK")
