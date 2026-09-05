#!/usr/bin/env python3
"""
Removes the solid grey background (#808080) from the new adult dog evo sprites
and replaces it with full transparency.

Usage:
    python remove_evo_background.py [--src DIR] [--dst DIR]

Defaults:
    --src  .  (project root, where evolution/ lives)
    --dst  .  (overwrites src/assets/pets/evolved/)
"""

import sys
import os
import argparse
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install it with: pip install Pillow")
    sys.exit(1)


# Target files: (src_relative_path, dst_relative_path)
# NOTE: "idle" has a typo in the source filename — "evo ildle.png".
FILES = [
    ("evolution/evo ildle.png",  "src/assets/pets/evolved/idle.png"),
    ("evolution/evo walk.png",   "src/assets/pets/evolved/walk.png"),
    ("evolution/evo hurt.png",   "src/assets/pets/evolved/hurt.png"),
    ("evolution/evo attack.png",  "src/assets/pets/evolved/attack.png"),
    ("evolution/evo death.png",   "src/assets/pets/evolved/death.png"),
]

# The exact grey RGB value of the background in all evo sheets.
# Determined by pixel inspection: R=128, G=128, B=128.
GREY_RGB = (128, 128, 128)

# Tolerance: allow +/-5 on each channel for anti-aliasing artefacts.
TOLERANCE = 5

# Fixed tile height for all evo adult sprites (pixels per frame).
# Confirmed by Python image inspection: all sheets are 64px tall.
TILE_PX = 64


def make_transparent(img: Image.Image) -> Image.Image:
    """
    Replace every pixel that matches the grey background (within TOLERANCE)
    with full transparency (alpha = 0).  Non-background pixels are untouched.
    The result is converted to RGBA so the PNG encoder stores the alpha channel.
    """
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, _ = pixels[x, y]
            if (
                abs(r - GREY_RGB[0]) <= TOLERANCE
                and abs(g - GREY_RGB[1]) <= TOLERANCE
                and abs(b - GREY_RGB[2]) <= TOLERANCE
            ):
                pixels[x, y] = (r, g, b, 0)   # fully transparent

    return img


def describe_sheet(img: Image.Image) -> str:
    w, h = img.size
    frames = w // TILE_PX
    return f"{w}x{h} px  ->  {frames} frame{'s' if frames != 1 else ''}  ({TILE_PX}x{TILE_PX} each)"


def main():
    parser = argparse.ArgumentParser(
        description="Remove solid #808080 grey background from evo adult dog sprites, "
                    "replacing it with full transparency."
    )
    parser.add_argument(
        "--src", default=".",
        help="Project root directory containing evolution/ (default: .)",
    )
    parser.add_argument(
        "--dst", default=None,
        help="Output directory for processed PNGs (default: same as --src, overwrites evolved/)",
    )
    args = parser.parse_args()

    root = Path(args.src)
    dst_root = Path(args.dst) if args.dst else root

    print("Evo Sprite Background Removal")
    print("=" * 45)
    print(f"Background target : rgb{GREY_RGB}  +/-{TOLERANCE}")
    print(f"Tile size         : {TILE_PX}x{TILE_PX} px per frame")
    print()

    for src_rel, dst_rel in FILES:
        src_path = root / src_rel
        dst_path = dst_root / dst_rel

        if not src_path.exists():
            print(f"[SKIP] {src_path}  - file not found")
            continue

        img = Image.open(src_path)
        transparent = make_transparent(img)

        dst_path.parent.mkdir(parents=True, exist_ok=True)
        transparent.save(dst_path, format="PNG")

        print(f"  {src_rel}")
        print(f"    -> {dst_path}")
        print(f"    Sheet: {describe_sheet(transparent)}")
        print()

    print("Done. All evo sprites saved with transparent backgrounds.")


if __name__ == "__main__":
    main()
