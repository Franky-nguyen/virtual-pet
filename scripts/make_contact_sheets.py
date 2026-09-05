#!/usr/bin/env python3
"""Build labelled contact sheets of sprite frames upscaled x4 for visual review."""
import os
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path("_frame_review")
OUT.mkdir(exist_ok=True)

SHEETS = [
    # (relative path, tile px)
    ("src/assets/pets/evolved/evolved_idle.png", 64),
    ("src/assets/pets/evolved/evolved_walk.png", 64),
    ("src/assets/pets/evolved/evolved_idle_crown.png", 64),
    ("src/assets/pets/evolved/evolved_walk_crown.png", 64),
    ("src/assets/pets/evolved/evolved_walk_bowtie.png", 64),
    ("src/assets/pets/evolved/evolved_walk_wizardhat.png", 64),
    ("src/assets/pets/evolved/evolved_walk_sunglasses.png", 64),
    ("src/assets/pets/evolved/evolved_walk_partyhat.png", 64),
    ("src/assets/pets/Walk.png", 48),
    ("src/assets/pets/Idle.png", 48),
]

SCALE = 4

for rel, tile in SHEETS:
    img = Image.open(rel).convert("RGBA")
    w, h = img.size
    frames = w // tile
    cell = tile * SCALE
    pad = 2
    canvas = Image.new("RGBA", (frames * (cell + pad) + pad, cell + pad + 22), (25, 25, 30, 255))
    d = ImageDraw.Draw(canvas)
    d.text((pad, 2), f"{Path(rel).name}  {w}x{h}  {frames}f@{tile}px", fill=(230, 230, 230, 255))
    for i in range(frames):
        f = img.crop((i * tile, 0, (i + 1) * tile, tile))
        f = f.resize((cell, cell), Image.NEAREST)
        x = pad + i * (cell + pad)
        canvas.paste(f, (x, 24), f)
        d.rectangle([x - 1, 23, x + cell, 23 + cell + 1], outline=(90, 90, 110, 255))
        d.text((x, 23 + cell + 3), str(i), fill=(255, 200, 100, 255))
    out = OUT / f"{Path(rel).stem}.png"
    canvas.save(out)
    print(out)
