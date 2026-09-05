#!/usr/bin/env python3
"""Numeric QA: per-frame overlay bbox + relationship to base head geometry."""
import numpy as np
from PIL import Image

T = 64
EVO = "src/assets/pets/evolved"
ACCS = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]

def base_head(anim, i):
    b = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))[:, i*T:(i+1)*T]
    m = b[:, :, 3] > 0
    rows = np.nonzero(m.any(axis=1))[0]
    top = int(rows.min())
    xs = np.nonzero(m[top:top+9])[1]
    cx = float(np.median(xs))
    # head ink span (cols) across full head rows top..top+9
    hm = m[top:top+10]
    cols = np.nonzero(hm)[1]
    return top, cx, int(cols.min()), int(cols.max())

for anim, nf in [("idle", 6), ("walk", 8)]:
    for acc in ACCS:
        ov = np.array(Image.open(f"{EVO}/overlay_{acc}_{anim}.png").convert("RGBA"))
        out = []
        ok = True
        for i in range(nf):
            o = ov[:, i*T:(i+1)*T]
            m = o[:, :, 3] > 0
            ys, xs = np.nonzero(m)
            if len(xs) == 0:
                out.append("EMPTY"); ok = False; continue
            top, cx, hmin, hmax = base_head(anim, i)
            x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
            # overlay ink that sits on rows below the head band should overlap head cols
            below = m[top+10:]
            overhang = 0
            if below.any():
                bys, bxs = np.nonzero(below)
                overhang = int(((bxs < hmin) | (bxs > hmax)).sum())
            clip = "CLIP" if (y0 < 0 or x0 < 0 or x1 >= T or y1 >= T) else ""
            out.append(f"f{i}:bbox x[{x0}-{x1}] y[{y0}-{y1}] headRows{top}-{top+9} hCols[{hmin}-{hmax}] overhangBelow={overhang}")
            if clip:
                ok = False
        print(f"{acc}_{anim}: {'; '.join(out)}")
