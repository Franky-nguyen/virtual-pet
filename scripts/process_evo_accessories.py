#!/usr/bin/env python3
"""
Process evo accessory source sprites into clean 64x64-tile-aligned PNGs.

The source sprites in `src/assets/evo acessories/` have:
  - Opaque backgrounds (white or grey) that need to be made transparent
  - Non-standard dimensions (not exact 64px multiples)
  - Varying frame counts (sometimes fewer frames than the base)

This script:
  1. Detects the background color from border pixels
  2. Makes background transparent
  3. Detects individual frames by finding connected ink columns
  4. Ground-aligns each frame to match the base sprite's positioning
  5. Outputs clean 64x64 tile strips matching the base frame count

Output: src/assets/pets/evolved/evolved_{anim}_{accessory}.png
"""

import os
import sys
import numpy as np
from PIL import Image
from collections import Counter

T = 64  # tile size
SRC = r"src\assets\evo acessories"
EVO = "src/assets/pets/evolved"
OUT = "src/assets/pets/evolved"

# Expected frame counts per animation (must match EVOLVED_ANIMATION_FRAMES in accessories.ts)
FRAME_COUNTS = {
    "idle": 6,
    "walk": 8,
    "hurt": 3,
    "attack": 4,
    "death": 6,
}

# File naming map: source filename token -> canonical accessory name
CANON = {
    "bowtie": "bowtie",
    "crown": "crown",
    "cown": "crown",     # typo in source files
    "partyhat": "partyhat",
    "sunglass": "sunglasses",
    "wizardhat": "wizardhat",
}

# Animation -> accessory source tokens
ANIM_FILES = {
    "idle":   ["bowtie", "cown", "partyhat", "sunglass", "wizardhat"],
    "walk":   ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "hurt":   ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "attack": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "death":  ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
}


def detect_bg_color(arr):
    """Detect background color from border pixels."""
    h, w = arr.shape[:2]
    rgb = arr[:, :, :3]
    border = np.concatenate([
        rgb[0, :],        # top row
        rgb[h-1, :],      # bottom row
        rgb[:, 0],        # left column
        rgb[:, w-1],      # right column
    ], axis=0)
    # Most common border color = background
    colors = [tuple(px) for px in border]
    bg = Counter(colors).most_common(1)[0][0]
    return np.array(bg, dtype=np.uint8)


def remove_bg(arr, bg_color, tolerance=30):
    """Make background pixels transparent. Returns RGBA array."""
    rgb = arr[:, :, :3].astype(int)
    bg = bg_color.astype(int)
    dist = np.abs(rgb - bg).sum(axis=2)
    is_bg = dist <= tolerance
    
    out = np.zeros((arr.shape[0], arr.shape[1], 4), dtype=np.uint8)
    out[:, :, :3] = arr[:, :, :3]
    out[:, :, 3] = np.where(is_bg, 0, 255)
    return out


def find_frames(arr):
    """
    Find individual frames by detecting connected groups of non-transparent columns.
    Returns a list of (x_start, x_end) pairs for each frame's bounding box.
    """
    ink = arr[:, :, 3] > 0
    col_has_ink = ink.any(axis=0)
    
    # Find runs of ink columns
    runs = []
    in_run = False
    for x in range(len(col_has_ink)):
        if col_has_ink[x] and not in_run:
            start = x
            in_run = True
        elif not col_has_ink[x] and in_run:
            runs.append((start, x - 1))
            in_run = False
    if in_run:
        runs.append((start, len(col_has_ink) - 1))
    
    # Merge runs that are very close (< 3px gap = same frame)
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 3:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    
    return merged


def get_base_ground_row(anim):
    """Get the ground row (lowest opaque pixel row) from the base evolved sprite."""
    base_path = os.path.join(EVO, f"evolved_{anim}.png")
    base = np.array(Image.open(base_path).convert("RGBA"))
    n = base.shape[1] // T
    ground_rows = []
    for i in range(n):
        tile = base[:, i*T:(i+1)*T]
        opaque = tile[:, :, 3] > 0
        rows = np.nonzero(opaque.any(axis=1))[0]
        if len(rows):
            ground_rows.append(int(rows.max()))
        else:
            ground_rows.append(T - 1)
    return ground_rows


def align_frame_to_tile(frame_rgba, ground_row_target):
    """
    Place a single frame's content into a 64x64 tile, ground-aligned.
    The frame content is positioned so its bottom opaque row matches ground_row_target.
    Horizontally centered.
    """
    tile = np.zeros((T, T, 4), dtype=np.uint8)
    h, w = frame_rgba.shape[:2]
    
    # Find content bounds
    opaque = frame_rgba[:, :, 3] > 0
    if not opaque.any():
        return tile
    
    rows = np.nonzero(opaque.any(axis=1))[0]
    cols = np.nonzero(opaque.any(axis=0))[0]
    top, bot = int(rows.min()), int(rows.max())
    left, right = int(cols.min()), int(cols.max())
    
    content_h = bot - top + 1
    content_w = right - left + 1
    
    # Extract content
    content = frame_rgba[top:bot+1, left:right+1].copy()
    
    # Ground alignment: place content so bottom row = ground_row_target
    y_offset = ground_row_target - content_h + 1
    
    # Horizontal centering
    x_offset = (T - content_w) // 2
    
    # Clamp to tile bounds
    src_y_start = max(0, -y_offset)
    src_x_start = max(0, -x_offset)
    dst_y_start = max(0, y_offset)
    dst_x_start = max(0, x_offset)
    
    copy_h = min(content_h - src_y_start, T - dst_y_start)
    copy_w = min(content_w - src_x_start, T - dst_x_start)
    
    if copy_h > 0 and copy_w > 0:
        tile[dst_y_start:dst_y_start+copy_h, dst_x_start:dst_x_start+copy_w] = \
            content[src_y_start:src_y_start+copy_h, src_x_start:src_x_start+copy_w]
    
    return tile


def process_sprite(anim, tok):
    """Process a single evo accessory sprite into a clean tile strip."""
    acc = CANON[tok]
    src_path = os.path.join(SRC, f"evo_{anim}_{tok}.png")
    
    if not os.path.exists(src_path):
        print(f"  SKIP {anim}_{acc}: source not found ({src_path})")
        return False
    
    target_frames = FRAME_COUNTS[anim]
    ground_rows = get_base_ground_row(anim)
    
    # Load and process
    img = Image.open(src_path).convert("RGBA")
    arr = np.array(img)
    
    # Step 1: Detect and remove background
    bg_color = detect_bg_color(arr)
    transparent = remove_bg(arr, bg_color)
    
    # Step 2: Find frames
    frame_bounds = find_frames(transparent)
    n_found = len(frame_bounds)
    
    # Step 3: Build output strip
    strip = np.zeros((T, T * target_frames, 4), dtype=np.uint8)
    
    for i in range(target_frames):
        if i < n_found:
            x0, x1 = frame_bounds[i]
            frame_content = transparent[:, x0:x1+1]
        else:
            # Fewer source frames than needed: cycle from available frames
            src_idx = i % n_found
            x0, x1 = frame_bounds[src_idx]
            frame_content = transparent[:, x0:x1+1]
        
        ground_target = ground_rows[i] if i < len(ground_rows) else ground_rows[-1]
        tile = align_frame_to_tile(frame_content, ground_target)
        strip[:, i*T:(i+1)*T] = tile
    
    # Step 4: Save
    out_path = os.path.join(OUT, f"evolved_{anim}_{acc}.png")
    Image.fromarray(strip).save(out_path, format="PNG")
    
    print(f"  {anim}_{acc:12s}: {n_found} source frames -> {target_frames} tiles  ({img.size[0]}x{img.size[1]} -> {T*target_frames}x{T})  -> {os.path.basename(out_path)}")
    return True


def main():
    print("Processing Evo Accessory Sprites")
    print("=" * 60)
    
    total = 0
    for anim, tokens in ANIM_FILES.items():
        print(f"\n{anim.upper()}:")
        for tok in tokens:
            if process_sprite(anim, tok):
                total += 1
    
    print(f"\nDone. {total} sprite sheets created in {OUT}")


if __name__ == "__main__":
    main()
