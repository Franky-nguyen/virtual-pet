#!/usr/bin/env python3
"""Diagnostic: report dimensions and per-frame alignment of sprite sheets."""
import os
from pathlib import Path
from PIL import Image

ROOTS = [
    Path("src/assets/pets"),
    Path("src/assets/pets/evolved"),
]

def alpha_bbox(img):
    """Return (min_x, min_y, max_x, max_y, count) of non-transparent pixels."""
    a = img.convert("RGBA")
    w, h = a.size
    px = a.load()
    min_x, min_y, max_x, max_y = w, h, -1, -1
    count = 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0:
                count += 1
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
    if count == 0:
        return None
    return (min_x, min_y, max_x, max_y, count)

for root in ROOTS:
    print("=" * 80)
    print(f"DIR: {root}")
    for p in sorted(root.glob("*.png")):
        try:
            img = Image.open(p)
            w, h = img.size
            # guess frame count assuming uniform square tiles = height
            tile = h
            frames = round(w / tile) if tile else 0
            print(f"\n{p.name:45s} {w}x{h}  frames(if tile={tile}): {frames}")
            # per-tile alpha bbox
            for i in range(frames):
                crop = img.crop((i * tile, 0, (i + 1) * tile, tile))
                bb = alpha_bbox(crop)
                if bb:
                    min_x, min_y, max_x, max_y, count = bb
                    cw = max_x - min_x + 1
                    ch = max_y - min_y + 1
                    print(f"   tile{i:2d}: bbox x[{min_x:2d}..{max_x:2d}] w={cw:2d} "
                          f"y[{min_y:2d}..{max_y:2d}] h={ch:2d} px={count:4d}")
                else:
                    print(f"   tile{i:2d}: EMPTY")
        except Exception as e:
            print(f"{p.name}: ERROR {e}")
