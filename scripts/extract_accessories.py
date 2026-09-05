#!/usr/bin/env python3
"""
Extract floating accessory overlays from the bubbly accessory sprite sheets.

Strategy
────────
Each accessory sheet contains two things drawn on a transparent background:
  1. The accessory itself (hat, glasses, bowtie …) — distinctive colours
  2. A "bubbly" dog body that fills the tile — warm yellows / oranges / tans

We cannot tell from a single sheet whether a pixel is accessory or dog body,
so we compare the accessory sheet against the base (un-accessorised) sheet.
Pixels that are identical in both are dog body -> erase.
Pixels that differ: check the accessory sheet's colour against the accessory's
known colour SIGNATURE.  If it matches, keep; otherwise erase.

Colour signatures are defined per-accessory as a list of RGB ranges.
Derived by sampling the upper rows of frame-0 of each accessory sheet.

The bubbly dog body sits 7-14 px higher than the base dog.  We correct this
with a per-animation Y offset (shift accessory pixels DOWN so they sit on the
smaller dog's head) and a per-tile horizontal centering pass.

Noise cleanup pass: after colour extraction, isolated single-pixel specks with
fewer than NOISE_THRESHOLD 8-connected opaque neighbours are erased (anti-aliasing
artefacts from the sprite tool).

Usage
─────
    python extract_accessories.py [--src DIR] [--dst DIR]

Output
──────
    overlay_{accessory}_{animation}.png  -- transparent RGBA, 64x64 per frame
    e.g. overlay_crown_idle.png, overlay_wizardhat_walk.png, ...
    Written to --dst (default: src/assets/pets/evolved/)
"""

import sys
import os
import argparse
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:
    print("ERROR: numpy and Pillow required.")
    print("  pip install numpy Pillow")
    sys.exit(1)

# ── Colour signatures per accessory ─────────────────────────────────────────────
# Each entry: list of (r_lo,r_hi, g_lo,g_hi, b_lo,b_hi) ranges.
# Derived from dominant colours in the upper rows of each accessory sheet.
ACCESSORY_SIGNATURES: dict[str, list[tuple]] = {
    "crown": [
        (0, 20, 0, 20, 0, 20),
        (235, 255, 150, 255, 155, 210),
        (185, 210, 125, 150, 45, 65),
        (150, 180, 100, 120, 45, 65),
        (235, 250, 165, 185, 50, 70),
    ],
    "partyhat": [
        (0, 20, 0, 20, 0, 20),
        (55, 90, 130, 160, 195, 225),
        (225, 255, 225, 245, 75, 100),
        (210, 240, 65, 90, 55, 80),
        (235, 255, 225, 255, 80, 100),
    ],
    "wizardhat": [
        (0, 20, 0, 15, 0, 15),
        (85, 120, 55, 85, 100, 130),
        (50, 75, 28, 48, 62, 85),
        (230, 255, 225, 248, 115, 145),
        (240, 255, 210, 235, 120, 135),
    ],
    "bowtie": [
        (235, 255, 155, 185, 45, 65),
        (240, 255, 230, 248, 148, 172),
        (0, 20, 0, 15, 0, 15),
        (150, 175, 100, 118, 45, 65),
    ],
    "sunglasses": [
        (0, 25, 0, 20, 0, 25),
        (35, 65, 28, 50, 40, 65),
        (235, 255, 155, 180, 45, 65),
        (225, 255, 225, 248, 148, 170),
    ],
}

# ── Per-animation Y offsets ───────────────────────────────────────────────────────
# Bubbly dog head sits 7-14 px above the base dog.
# We shift accessory pixels DOWN so they sit on the smaller dog's head.
# Measured: base dog top opaque row vs bubbly dog top opaque row.
ANIMATION_OFFSETS: dict[str, tuple[int, int]] = {
    "idle": (0, -12),   # shift DOWN 12 px
    "walk": (0, -14),   # shift DOWN 14 px
    "hurt": (0, -7),    # shift DOWN 7 px
}

ANIMATIONS = ["idle", "walk", "hurt"]

TILE_PX = 64

# ── Noise cleanup ───────────────────────────────────────────────────────────────
# Any opaque pixel with fewer than this many 8-connected opaque neighbours is
# considered an anti-aliasing artefact and erased.
NOISE_THRESHOLD = 2


def in_color_range(r: int, g: int, b: int, ranges: list[tuple]) -> bool:
    for rlo, rhi, glo, ghi, blo, bhi in ranges:
        if rlo <= r <= rhi and glo <= g <= ghi and blo <= b <= bhi:
            return True
    return False


def extract_color_mask(acc_img: Image.Image, base_img: Image.Image,
                       color_ranges: list[tuple]) -> np.ndarray:
    """
    Return a bool mask (H, W): True = accessory pixel, False = erase.
    Logic: opaque in acc AND differs from base AND matches accessory colour signature.
    """
    base = np.array(base_img.convert("RGBA"))
    acc  = np.array(acc_img.convert("RGBA"))

    h, w = base.shape[:2]
    mask = np.zeros((h, w), dtype=bool)

    for y in range(h):
        for x in range(w):
            apx = acc[y, x]
            bpx = base[y, x]
            ar, ag, ab, aa = int(apx[0]), int(apx[1]), int(apx[2]), int(apx[3])
            br, bg, bb, _ = int(bpx[0]), int(bpx[1]), int(bpx[2]), int(bpx[3])

            if aa == 0:
                continue
            if ar == br and ag == bg and ab == bb:
                continue

            if in_color_range(ar, ag, ab, color_ranges):
                mask[y, x] = True

    return mask


def remove_noise(mask: np.ndarray, threshold: int = NOISE_THRESHOLD) -> np.ndarray:
    """
    Erase isolated specks: any True pixel with fewer than `threshold`
    8-connected opaque neighbours becomes False.
    """
    h, w = mask.shape
    cleaned = mask.copy()

    for y in range(h):
        for x in range(w):
            if not mask[y, x]:
                continue
            count = 0
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dy == 0 and dx == 0:
                        continue
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w:
                        if mask[ny, nx]:
                            count += 1
            if count < threshold:
                cleaned[y, x] = False

    return cleaned


def apply_positional_shift(mask: np.ndarray, rgba: np.ndarray,
                           shift_x: int, shift_y: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Shift all opaque pixels by (shift_x, shift_y).
    Pixels shifted outside canvas bounds are dropped (overhanging pixels).
    Returns (new_mask, new_rgba).
    """
    h, w = mask.shape
    new_mask = np.zeros_like(mask)
    new_rgba = np.zeros_like(rgba)

    for y in range(h):
        for x in range(w):
            if not mask[y, x]:
                continue
            nx = x + shift_x
            ny = y + shift_y
            if 0 <= ny < h and 0 <= nx < w:
                new_mask[ny, nx] = True
                new_rgba[ny, nx] = rgba[y, x]

    return new_mask, new_rgba


def center_per_tile(mask: np.ndarray, rgba: np.ndarray,
                    tile_px: int = TILE_PX) -> tuple[np.ndarray, np.ndarray]:
    """
    For each 64x64 tile, shift all opaque pixels horizontally so the accessory's
    bounding box is centred within the tile width.  This removes systematic
    left/right bias from the extraction.
    """
    h, w = mask.shape
    n_tiles = w // tile_px
    new_mask = np.zeros_like(mask)
    new_rgba = np.zeros_like(rgba)

    for ti in range(n_tiles):
        x0 = ti * tile_px
        x1 = x0 + tile_px

        tile_mask = mask[:, x0:x1]
        tile_rgba = rgba[:, x0:x1]

        rows = np.any(tile_mask, axis=1)
        cols = np.any(tile_mask, axis=0)
        if not rows.any():
            # Nothing in this tile — copy as-is
            new_mask[:, x0:x1]   = tile_mask
            new_rgba[:, x0:x1]   = tile_rgba
            continue

        top_row  = np.where(rows)[0][0]
        bot_row  = np.where(rows)[0][-1]
        left_col = np.where(cols)[0][0]
        right_col = np.where(cols)[0][-1]

        content_w = right_col - left_col + 1
        shift = (tile_px - content_w) // 2 - left_col

        for y in range(h):
            for x in range(tile_px):
                if not tile_mask[y, x]:
                    continue
                nx = x + shift
                if 0 <= nx < tile_px:
                    new_mask[y, x0 + nx]   = True
                    new_rgba[y, x0 + nx]   = tile_rgba[y, x]

    return new_mask, new_rgba


def build_overlay(mask: np.ndarray, rgba: np.ndarray) -> Image.Image:
    """Render a transparent RGBA PIL image from a bool mask and RGBA data."""
    h, w = mask.shape
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[:, :, 3] = 0

    for y in range(h):
        for x in range(w):
            if mask[y, x]:
                out[y, x] = rgba[y, x]

    return Image.fromarray(out, mode="RGBA")


def extract_overlay(base_img: Image.Image, acc_img: Image.Image,
                    color_ranges: list[tuple],
                    shift_x: int, shift_y: int) -> Image.Image:
    """
    Full extraction pipeline:
      1. Colour mask extraction (vs base sheet)
      2. Noise cleanup
      3. Positional shift (align accessories to smaller dog's head)
      4. Per-tile horizontal centering
      5. Render RGBA overlay
    """
    # Step 1: colour mask
    mask = extract_color_mask(acc_img, base_img, color_ranges)

    # Step 2: noise cleanup
    mask = remove_noise(mask, threshold=NOISE_THRESHOLD)

    # Get RGBA pixel data from accessory sheet
    rgba = np.array(acc_img.convert("RGBA"))

    # Step 3: positional shift
    mask, rgba = apply_positional_shift(mask, rgba, shift_x, shift_y)

    # Step 4: per-tile centering
    mask, rgba = center_per_tile(mask, rgba)

    # Step 5: build image
    return build_overlay(mask, rgba)


def process_animation(acc_path: Path, base_path: Path,
                      color_ranges: list[tuple],
                      shift_x: int, shift_y: int,
                      dst_path: Path) -> int:
    """Process one animation sheet. Returns frame count."""
    acc_img  = Image.open(acc_path).convert("RGBA")
    base_img = Image.open(base_path).convert("RGBA")
    overlay  = extract_overlay(base_img, acc_img, color_ranges, shift_x, shift_y)
    overlay.save(dst_path, format="PNG")
    return overlay.width // TILE_PX


def main():
    parser = argparse.ArgumentParser(description="Extract floating accessory overlays.")
    parser.add_argument(
        "--src", default="src/assets/pets/evolved",
        help="Evolved assets directory (default: src/assets/pets/evolved)",
    )
    parser.add_argument(
        "--dst", default=None,
        help="Output directory (default: same as --src)",
    )
    args = parser.parse_args()

    src_dir = Path(args.src)
    dst_dir = Path(args.dst) if args.dst else src_dir

    print("Accessory Overlay Extraction")
    print("=" * 50)

    total_saved = 0

    for acc_name, color_ranges in ACCESSORY_SIGNATURES.items():
        print(f"\nAccessory: {acc_name}")

        for anim in ANIMATIONS:
            shift_x, shift_y = ANIMATION_OFFSETS.get(anim, (0, 0))

            # Try new naming (evolved_*) then old naming (evo_*)
            acc_src = src_dir / f"evolved_{anim}_{acc_name}.png"
            if not acc_src.exists():
                acc_src = src_dir / f"evo_{anim}_{acc_name}.png"

            if not acc_src.exists():
                print(f"  {anim:8s}: [SKIP -- not found]")
                continue

            base_path = src_dir / f"evolved_{anim}.png"
            if not base_path.exists():
                print(f"  {anim:8s}: [SKIP -- base sheet not found: {base_path.name}]")
                continue

            dst_path = dst_dir / f"overlay_{acc_name}_{anim}.png"
            frames = process_animation(
                acc_src, base_path, color_ranges,
                shift_x, shift_y, dst_path
            )
            print(f"  {anim:8s}: shift=({shift_x:+d},{shift_y:+d})  -> "
                  f"{dst_path.name}  ({frames} frames)")
            total_saved += 1

    print(f"\nDone. {total_saved} overlay sheets written.")


if __name__ == "__main__":
    main()
