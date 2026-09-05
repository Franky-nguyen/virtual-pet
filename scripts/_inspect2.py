#!/usr/bin/env python3
"""Compare imported 'evo acessories' sheets to the ones staged in
_backup_evo/removed and to the base evolved sheets; report geometry."""
import os
import hashlib
from PIL import Image
import numpy as np

IMP = r"src\assets\evo acessories"
REM = "_backup_evo/removed"
EVO = "src/assets/pets/evolved"


def md5(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()


print("== identical to the files staged in _backup_evo/removed? ==")
for f in sorted(os.listdir(IMP)):
    if not f.endswith(".png"):
        continue
    staged = os.path.join(REM, f)
    same = "SAME" if os.path.exists(staged) and md5(os.path.join(IMP, f)) == md5(staged) else "different/new"
    print(f"  {f:34s} {same}")

print()
print("== geometry of imported sheets ==")
for f in sorted(os.listdir(IMP)):
    if not f.endswith(".png"):
        continue
    im = Image.open(os.path.join(IMP, f)).convert("RGBA")
    w, h = im.size
    a = np.array(im)
    # estimate tile: assume square tiles of height h
    print(f"  {f:34s} {w:4d}x{h:<3d} frames(w/h)={w/h:.2f} alpha_bg={'yes' if (a[:,:,3]==0).mean()>0.05 else 'no'}")
