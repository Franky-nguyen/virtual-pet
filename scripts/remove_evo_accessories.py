#!/usr/bin/env python3
"""Remove every evolved-pet accessory sprite from src/assets/pets/evolved/ and
stage them (reversibly) under _backup_evo/removed/.

Covers:
  - the in-use scheme:   evolved_{anim}_{accessory}.png   (25 files)
  - the unused legacy:   evo_{anim}_{accessory}.png       (25 files)

The renderer (getSpriteUrl in PetDisplay.tsx) already falls back to the plain
evolved_{anim}.png sheet when an accessory path is absent, so no code change is
needed after removal.
"""
import os
import shutil

SRC = "src/assets/pets/evolved"
DST = "_backup_evo/removed"
SUFFIXES = ("crown", "bowtie", "partyhat", "wizardhat", "sunglass", "sunglasses", "cown")


def is_accessory_sheet(fname):
    if not fname.lower().endswith(".png"):
        return False
    parts = fname[:-4].split("_")
    return len(parts) >= 3 and parts[-1] in SUFFIXES


os.makedirs(DST, exist_ok=True)
moved = []
for f in sorted(os.listdir(SRC)):
    if is_accessory_sheet(f):
        src = os.path.join(SRC, f)
        dst = os.path.join(DST, f)
        shutil.move(src, dst)
        moved.append(f)

print(f"moved {len(moved)} accessory sheets out of {SRC} -> {DST}")
for f in moved:
    print("  ", f)
