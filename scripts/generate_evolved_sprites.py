#!/usr/bin/env python3
"""
generate_evolved_sprites.py

Upscales the Level 10 evolved-dog sprite sheets so each animation TILE is a
larger grid (default 64x64 px instead of the current 48x48 px).

This is a PLACEHOLDER generator: it uses nearest-neighbour so the pixel-art
edges stay crisp, but it adds no new detail — it just bakes the current 48px
art up to the larger tile. For genuinely better art, hand the spec in this
folder (or see the SPEC section at the bottom) to an artist / image tool and
drop the results into src/assets/pets/evolved/ (lowercase filenames).

Usage:
    python generate_evolved_sprites.py                 # 48px -> 64px tiles
    python generate_evolved_sprites.py --tile 96       # 48px -> 96px tiles
    python generate_evolved_sprites.py --out src/assets/pets/evolved   # in-place

Requirements:
    pip install pillow
"""

import argparse
import os
from PIL import Image

SRC_DIR = os.path.join("src", "assets", "pets", "evolved")
OUT_DIR = os.path.join("src", "assets", "pets", "evolved64")

# Each sheet is a single horizontal strip of N equal-sized tiles. The source
# tile size is the image HEIGHT (every current evolved sheet is 48px tall).
def upscale(path: str, target_tile: int, out_dir: str) -> None:
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    scale = target_tile / h
    new_w = round(w * scale)
    new_h = target_tile
    out = img.resize((new_w, new_h), Image.NEAREST)

    name = os.path.basename(path)
    out_path = os.path.join(out_dir, name)
    out.save(out_path)
    frames = round(w / h)
    print(f"  {name:32s} {w}x{h} ({frames}f @ {h}px) -> {new_w}x{new_h} ({frames}f @ {target_tile}px)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Upscale evolved-dog sprite tiles.")
    parser.add_argument("--tile", type=int, default=64, help="Target tile size in px (default 64)")
    parser.add_argument("--src", default=SRC_DIR, help="Source directory")
    parser.add_argument("--out", default=OUT_DIR, help="Output directory")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    files = sorted(
        f for f in os.listdir(args.src)
        if f.lower().endswith(".png")
    )
    if not files:
        raise SystemExit(f"No PNGs found in {args.src}")

    print(f"Upscaling {len(files)} sheets: {args.src} -> {args.out} (tile {args.tile}px)")
    for f in files:
        upscale(os.path.join(args.src, f), args.tile, args.out)

    print("\nDone. To activate, copy the output over the evolved/ folder:")
    print(f"  (or set --out src/assets/pets/evolved next time to write in place)")
    print("\nNOTE: the renderer already draws evolved tiles at 64px via")
    print("'image-rendering: pixelated', so a nearest-neighbour 48->64 bake is")
    print("visually identical to what ships today. Real improvement needs new")
    print("64px art — see the SPEC below / in SPEC.md.")


if __name__ == "__main__":
    main()
