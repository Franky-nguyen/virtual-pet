#!/usr/bin/env python3
"""
fix_attack_frames.py — align the attack sprite sheets (base + accessory) to a
single frame count at the ASSET level, so the React CSS never needs special
per-sheet frame math.

Background: the sprite renderer assumes the base sheet and every accessory sheet
share the exact same frame count and 64×64px tile size. When an accessory sheet
has fewer frames than the base, `steps(N)` misaligns `background-position` and
the accessory slides/glitches on the dog.

What this script does, for every attack sheet under `src/assets/pets/evolved/`:

  1. Splits the horizontal strip into its 64px tiles (source frames).
  2. Expands (or truncates) the frame list to the target count. Extra frames
     are produced by duplicating the tail frames — e.g. 4 -> 6 maps
     [1, 2, 3, 3, 4, 4] (1-indexed), holding the strike pose.
  3. Re-composes a padded strip at the target width.
  4. Flood-fills the gray (rgb 128,128,128) and white placeholder backgrounds
     to perfect transparency (skipped when the sheet is already transparent).

Usage:
  python fix_attack_frames.py               # target = base sheet's frame count
  python fix_attack_frames.py --frames 6    # force a 6-frame attack (pads base too)

Requirements:
  pip install pillow numpy
"""

import argparse
import glob
import os
from collections import deque

import numpy as np
from PIL import Image

DIR = os.path.join("src", "assets", "pets", "evolved")
BASE_SHEET = os.path.join(DIR, "evolved_attack.png")
TILE = 64
BG_TOLERANCE = 30


def detect_frames(path: str) -> int:
    img = Image.open(path).convert("RGBA")
    return round(img.size[0] / img.size[1])


def remove_background(img: Image.Image) -> Image.Image:
    """Flood-fill the gray/white placeholder background to transparency.

    Returns the image unchanged if the background is already transparent.
    """
    arr = np.array(img.convert("RGBA"))
    h, w = arr.shape[:2]
    corners_alpha = [arr[0, 0, 3], arr[0, w - 1, 3], arr[h - 1, 0, 3], arr[h - 1, w - 1, 3]]
    if all(a == 0 for a in corners_alpha):
        return img  # already transparent

    corners = np.array(
        [arr[0, 0], arr[0, w - 1], arr[h - 1, 0], arr[h - 1, w - 1]], dtype=int
    )
    seed = corners.mean(axis=0)

    diff = np.abs(arr[:, :, :3].astype(int) - seed[:3]).max(axis=2)
    bg = diff <= BG_TOLERANCE

    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if bg[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and bg[ny, nx] and not visited[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    arr[visited] = (0, 0, 0, 0)
    return Image.fromarray(arr)


def expand_indices(source_frames: int, target_frames: int) -> list[int]:
    """Map `target_frames` slots onto `source_frames` frames.

    When padding, the extra slots duplicate the tail frames (holding the final
    strike pose): 4 -> 6 yields [0, 1, 2, 2, 3, 3] (i.e. 1,2,3,3,4,4 1-indexed).
    """
    if target_frames <= source_frames:
        return list(range(target_frames))
    extra = target_frames - source_frames
    result: list[int] = []
    for i in range(source_frames):
        result.append(i)
        if i >= source_frames - extra:
            result.append(i)
    while len(result) < target_frames:  # safety for large paddings
        result.append(source_frames - 1)
    return result[:target_frames]


def process(path: str, target_frames: int) -> None:
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    n = round(w / h)

    # Normalize the strip to clean 64px tiles, then split.
    img = img.resize((n * TILE, TILE), Image.LANCZOS)
    frames = [img.crop((i * TILE, 0, (i + 1) * TILE, TILE)) for i in range(n)]
    frames = [remove_background(f) for f in frames]

    indices = expand_indices(n, target_frames)
    out = Image.new("RGBA", (target_frames * TILE, TILE), (0, 0, 0, 0))
    for slot, src in enumerate(indices):
        out.paste(frames[src], (slot * TILE, 0), frames[src])
    out.save(path)

    name = os.path.basename(path)
    print(f"{name:40s} {n} frames -> {target_frames} frames ({target_frames * TILE}px wide)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Align attack sprite sheets to one frame count.")
    parser.add_argument(
        "--frames",
        type=int,
        default=None,
        help="Target frame count (default: auto-detect from the base sheet).",
    )
    args = parser.parse_args()

    target = args.frames if args.frames is not None else detect_frames(BASE_SHEET)
    print(f"Target attack frame count: {target} ({target * TILE}px wide)\n")

    # Base sheets first, then every attack accessory sheet (both naming schemes).
    targets = [BASE_SHEET]
    if os.path.basename(BASE_SHEET) == "evolved_attack.png":
        plain = os.path.join(DIR, "attack.png")
        if os.path.exists(plain):
            targets.append(plain)
    targets += sorted(glob.glob(os.path.join(DIR, "*attack_*.png")))

    for path in targets:
        process(path, target)


if __name__ == "__main__":
    main()
