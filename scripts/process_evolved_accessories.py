#!/usr/bin/env python3
"""
Process evolved accessory sprite sheets in src/assets/pets/evolved/:

  1. Detect the background colour of each file (grey #808080 or white #FFFFFF).
  2. Replace that background with full transparency (alpha=0).
  3. Detect the most-likely 64px tile size from clean WxH multiples.
  4. Rename files to the canonical evolved_ prefix and correct accessory names.
     (e.g. evo_idle_cown.png -> evolved_idle_crown.png)
  5. Report frame counts per file.

Usage:
    python process_evolved_accessories.py [--src DIR]
"""

import sys
import os
import argparse
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow required. Install: pip install Pillow")
    sys.exit(1)

# Background targets
GREY_RGB   = (128, 128, 128)
WHITE_RGB  = (255, 255, 255)
TOLERANCE  = 5

# Canonical tile size for all evolved accessories
TILE_PX = 64

# Rename catalogue: {original_filename: canonical_new_filename}
RENAME_CATALOGUE = {
    "evo_idle_cown.png":          "evolved_idle_crown.png",
    "evo_idle_partyhat.png":      "evolved_idle_partyhat.png",
    "evo_idle_sunglass.png":      "evolved_idle_sunglasses.png",
    "evo_idle_wizardhat.png":     "evolved_idle_wizardhat.png",
    "evo_idle_bowtie.png":        "evolved_idle_bowtie.png",
    "evo_walk_partyhat.png":      "evolved_walk_partyhat.png",
    "evo_walk_crown.png":          "evolved_walk_crown.png",
    "evo_walk_bowtie.png":        "evolved_walk_bowtie.png",
    "evo_walk_sunglass.png":      "evolved_walk_sunglasses.png",
    "evo_walk_wizardhat.png":     "evolved_walk_wizardhat.png",
    "evo_hurt_partyhat.png":       "evolved_hurt_partyhat.png",
    "evo_hurt_crown.png":          "evolved_hurt_crown.png",
    "evo_hurt_bowtie.png":        "evolved_hurt_bowtie.png",
    "evo_hurt_sunglass.png":      "evolved_hurt_sunglasses.png",
    "evo_hurt_wizardhat.png":     "evolved_hurt_wizardhat.png",
    "evo_death_partyhat.png":      "evolved_death_partyhat.png",
    "evo_death_crown.png":         "evolved_death_crown.png",
    "evo_death_bowtie.png":       "evolved_death_bowtie.png",
    "evo_death_sunglass.png":     "evolved_death_sunglasses.png",
    "evo_death_wizardhat.png":     "evolved_death_wizardhat.png",
    "evo_attack_partyhat.png":     "evolved_attack_partyhat.png",
    "evo_attack_crown.png":        "evolved_attack_crown.png",
    "evo_attack_bowtie.png":       "evolved_attack_bowtie.png",
    "evo_attack_sunglass.png":     "evolved_attack_sunglasses.png",
    "evo_attack_wizardhat.png":    "evolved_attack_wizardhat.png",
}


def detect_background(img: Image.Image) -> tuple:
    """Sample the 4 corners + 2 mid-edge pixels; return the most-common colour."""
    w, h = img.size
    samples = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
               (w // 2, 0), (w // 2, h - 1)]
    counts = {}
    for x, y in samples:
        px = img.convert("RGBA").getpixel((x, y))[:3]
        counts[px] = counts.get(px, 0) + 1
    return max(counts, key=counts.get)


def make_transparent(img: Image.Image, target: tuple) -> Image.Image:
    """Convert all pixels matching `target` (+-TOLERANCE) to fully transparent."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    changed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, _ = pixels[x, y]
            if (abs(r - target[0]) <= TOLERANCE
                    and abs(g - target[1]) <= TOLERANCE
                    and abs(b - target[2]) <= TOLERANCE):
                pixels[x, y] = (r, g, b, 0)
                changed += 1
    print(f"    {changed}/{w * h} pixels made transparent ({changed * 100 // (w * h)}%)")
    return img


def main():
    parser = argparse.ArgumentParser(
        description="Process evolved accessory sprites: transparency + rename."
    )
    parser.add_argument(
        "--src", default="src/assets/pets/evolved",
        help="Evolved assets directory (default: src/assets/pets/evolved)"
    )
    args = parser.parse_args()

    evolved_dir = Path(args.src)
    print(f"Processing: {evolved_dir}")
    print("=" * 55)

    evo_files = sorted([
        f for f in os.listdir(evolved_dir)
        if f.startswith("evo_") and f.endswith(".png")
    ])

    written: set = set()

    for src_name in evo_files:
        dst_name = RENAME_CATALOGUE.get(src_name)
        if dst_name is None:
            print(f"[SKIP] {src_name}  -- not in rename catalogue")
            continue
        if dst_name in written:
            print(f"[SKIP] {src_name}  -- duplicate of {dst_name} (already written)")
            continue

        src_path = evolved_dir / src_name
        dst_path = evolved_dir / dst_name

        img = Image.open(src_path)
        w, h = img.size
        bg = detect_background(img)

        # Pick background target
        if all(abs(bg[i] - GREY_RGB[i]) <= TOLERANCE for i in range(3)):
            target, bg_name = GREY_RGB, "grey"
        elif all(abs(bg[i] - WHITE_RGB[i]) <= TOLERANCE for i in range(3)):
            target, bg_name = WHITE_RGB, "white"
        else:
            target, bg_name = None, f"unknown {bg}"

        # Detect tile info
        frames_64 = w // 64 if h >= 60 else 0
        frames_48 = w // 48 if h >= 44 else 0
        if frames_64 > 0 and h >= 60:
            tile_h, frames = 64, frames_64
        elif frames_48 > 0:
            tile_h, frames = 48, frames_48
        else:
            tile_h, frames = None, 0

        tile_desc = f"{frames} frames @ {tile_h}x{tile_h}" if tile_h else "tile size unknown"
        print(f"\n{src_name}")
        print(f"  {w}x{h}  bg={bg_name}  {tile_desc}")

        if target:
            img = make_transparent(img, target)

        img.save(dst_path, format="PNG")
        print(f"  -> saved: {dst_name}")
        written.add(dst_name)

    print(f"\nDone. Processed {len(written)} files.")
