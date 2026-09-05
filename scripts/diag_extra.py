#!/usr/bin/env python3
"""For each accessory frame vs base frame (best-registered), measure where the
'extra' opaque pixels of the accessory sheet lie (spatial histogram by row).
If extras concentrate near the top (0..20) => accessories only. If they are
smeared all over the dog body => the dog art itself differs per frame/sheet.
"""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")

def alpha(p):
    return np.array(Image.open(p).convert("RGBA"))[:, :, 3] > 0

def best_shift(ref, frm, search=9):
    denom = ref.sum()
    best = (0, 0, 0)
    for dy in range(-search, search+1):
        for dx in range(-search, search+1):
            s = np.roll(np.roll(frm, dy, axis=0), dx, axis=1)
            if dx > 0: s[:, :dx] = False
            elif dx < 0: s[:, dx:] = False
            if dy > 0: s[:dy, :] = False
            elif dy < 0: s[dy:, :] = False
            inter = np.logical_and(ref, s).sum()
            score = inter / denom
            if score > best[0]:
                best = (score, dx, dy)
    return best

for anim in ["idle", "walk", "attack", "death"]:
    base_p = DIR / f"evolved_{anim}.png"
    if not base_p.exists():
        continue
    base = alpha(base_p)
    t = 64
    n = base.shape[1] // t
    print("="*72)
    for acc_p in sorted(DIR.glob(f"evolved_{anim}_*.png")):
        acc = alpha(acc_p)
        rows = []
        for i in range(n):
            bt = base[:, i*t:(i+1)*t]
            at = acc[:, i*t:(i+1)*t]
            sc, dx, dy = best_shift(bt, at)
            ats = np.roll(np.roll(at, dy, axis=0), dx, axis=1)
            if dx > 0: ats[:, :dx] = False
            elif dx < 0: ats[:, dx:] = False
            if dy > 0: ats[:dy, :] = False
            elif dy < 0: ats[dy:, :] = False
            extra = np.logical_and(ats, np.logical_not(bt))  # acc-only pixels (top region ~ accessory)
            missing = np.logical_and(bt, np.logical_not(ats))  # base pixels not in acc
            row_dist = extra.sum(axis=1)
            top = row_dist[:20].sum()      # accessory zone
            mid = row_dist[20:45].sum()
            low = row_dist[45:].sum()
            # also body-region only extra: rows 20..45 where base dog head/body is
            rows.append(
                f"f{i}: extraT={top} extraM={mid} extraL={low} "
                f"missing={missing.sum()}")
        print(f"\n{acc_p.stem:32s} (best shift used per frame)")
        for r in rows:
            print("   " + r)
