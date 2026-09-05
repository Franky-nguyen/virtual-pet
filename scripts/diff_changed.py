#!/usr/bin/env python3
"""Report which evolved sheets changed vs _backup_evo and show final stability."""
from pathlib import Path
import hashlib
import numpy as np
from PIL import Image

EVO = Path("src/assets/pets/evolved")
BAK = Path("_backup_evo")


def md5(p):
    return hashlib.md5(p.read_bytes()).hexdigest()


changed = []
for p in sorted(EVO.glob("evolved_*.png")):
    b = BAK / p.name
    if b.exists() and md5(p) != md5(b):
        changed.append(p.name)
    elif not b.exists():
        changed.append(p.name + "  (NO BACKUP)")
print("changed sheets:")
for c in changed:
    print("  ", c)
