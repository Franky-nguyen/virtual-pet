#!/usr/bin/env python3
"""Test: after bottom-anchoring + chest-centroid alignment, is the import dog's
lower body a consistent color transform of the base dog (tint/shade) or a
completely different drawing? Measure residual per-channel over leg band."""
import sys
from collections import Counter
import numpy as np
from PIL import Image

IMP = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"

anim, acc, idx = sys.argv[1], sys.argv[2], int(sys.argv[3])
a = np.array(Image.open(f"{IMP}/evo_{anim}_{acc}.png").convert("RGBA")).astype(int)
H = a.shape[0]
rgb = a[:, :, :3]
border = np.concatenate([rgb[0], rgb[H-1], rgb[:, 0], rgb[:, -1]], axis=0)
bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
ink = np.abs(rgb - bg).sum(axis=2) > 50
# extract idx-th frame via runs
col_occ = ink.sum(axis=0)
runs, in_run = [], False
for x in range(a.shape[1]):
    if col_occ[x] > 0 and not in_run:
        s = x; in_run = True
    elif col_occ[x] == 0 and in_run:
        runs.append((s, x-1)); in_run = False
if in_run:
    runs.append((s, a.shape[1]-1))
x0, x1 = runs[idx]
cell = rgb[:, x0:x1+1]
cell_ink = ink[:, x0:x1+1]

# base frame
b = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA")).astype(int)
bt = b[:, idx*64:(idx+1)*64]
bm = bt[:, :, 3] > 0
brgb = bt[:, :, :3]

# --- anchor: align feet bottom
feet = np.nonzero(cell_ink.any(axis=1))[0].max()
dy = 63 - feet
# --- horizontal: align chest centroid (rows 30..46 of *cell*, below neck) after dy
# approximate: use base chest band rows 32..46; find import rows 32+dy..46+dy
cand_rows = slice(max(0, 32+dy), min(H, 47+dy))
cc = np.nonzero(cell_ink[cand_rows])[1]
import_chest = cc.mean() if len(cc) else None
brows = slice(32, 47)
ccb = np.nonzero(bm[brows])[1]
base_chest = ccb.mean() if len(ccb) else 32
dx = int(round(base_chest - import_chest))

# gather matched pixel pairs in lower body band (belly/legs): rows base 40..(feet-1)
pairs = []
for by in range(40, 63):
    cx = by - dy
    if cx < 0 or cx >= cell_ink.shape[0]:
        continue
    for bx in range(0, 64):
        cxx = bx - dx
        if cxx < 0 or cxx >= cell_ink.shape[1]:
            continue
        if bm[by, bx] and cell_ink[cx, cxx]:
            pairs.append((brgb[by, bx], cell[cx, cxx]))
if not pairs:
    print(anim, acc, "no pairs")
    sys.exit()
P = np.array([p[0] for p in pairs]).astype(int)
Q = np.array([p[1] for p in pairs]).astype(int)
resid = np.abs(P - Q).sum(axis=1)
# linear fit per channel import = m*base + k
slopes, intercepts = [], []
for ch in range(3):
    m, k = np.polyfit(P[:, ch], Q[:, ch], 1)
    pred = m * P[:, ch] + k
    r2 = 1 - ((Q[:, ch] - pred) ** 2).sum() / max(1e-9, ((Q[:, ch] - Q[:, ch].mean()) ** 2).sum())
    slopes.append(m); intercepts.append(k)
sl = ", ".join("%.2f" % s for s in slopes)
itc = ", ".join("%.0f" % k for k in intercepts)
print(f"{anim}_{acc} f{idx}: n={len(pairs)} meanResid={resid.mean():.1f} perChSlope=[{sl}] int=[{itc}]")
