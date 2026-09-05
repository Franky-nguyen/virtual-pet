#!/usr/bin/env python3
"""Registration QA for cleaned accessory sheets: for each frame find the (dx,dy)
that best aligns its alpha mask onto the matching base frame mask; report drift
mean/stdev across frames. 0,0 mean + tight spread => registered like base."""
import os
import sys
import numpy as np
from PIL import Image

T = 64


def best_shift_msk(m, base):
    ch, cw = m.shape
    best = (-1.0, 0, 0)
    for dy in range(-6, 7):
        for dx in range(-6, 7):
            mm = np.zeros((T, T), dtype=bool)
            y0 = max(0, dy); y1 = min(T, ch + dy)
            x0 = max(0, dx); x1 = min(T, cw + dx)
            if y1 <= y0 or x1 <= x0:
                continue
            sub = m[y0-dy:y1-dy, x0-dx:x1-dx]
            if not sub.any():
                continue
            mm[y0:y1, x0:x1] = sub
            inter = int((mm & base).sum())
            if inter == 0:
                continue
            iou = inter / (int(base.sum()) + int(mm.sum()) - inter)
            if iou > best[0]:
                best = (iou, dy, dx)
    return best


def report(path, anim):
    a = np.array(Image.open(path).convert("RGBA"))
    n = a.shape[1] // T
    base = np.array(Image.open(f"src/assets/pets/evolved/evolved_{anim}.png").convert("RGBA"))
    ds = []
    ios = []
    for i in range(n):
        m = a[:, i*T:(i+1)*T][:, :, 3] > 0
        bm = base[:, i*T:(i+1)*T][:, :, 3] > 0
        io, dy, dx = best_shift_msk(m, bm)
        ds.append((dx, dy)); ios.append(io)
    d = np.array(ds)
    print(f"{os.path.basename(path):34s} bestIouMean={np.mean(ios)*100:.0f}% "
          f"dxMean={d[:,0].mean():+.2f} dyMean={d[:,1].mean():+.2f} "
          f"dxStd={d[:,0].std():.2f} dyStd={d[:,1].std():.2f}")


src = sys.argv[1] if len(sys.argv) > 1 else r"_backup_evo\removed"
for f in sorted(os.listdir(src)):
    if not (f.startswith("evolved_") and f.endswith(".png")):
        continue
    report(os.path.join(src, f), f.split("_")[1])
