#!/usr/bin/env python3
"""QA preview: overlay result on top of base dog (idle frame 0) + raw mask."""
import sys, os
import numpy as np
from PIL import Image
sys.path.insert(0, ".")
from extract_overlays import (EVO, aligned_frames, load_base,
                              extract_exact, extract_bubbly, make_overlay,
                              ANIM_FILES, CANON)

T = 64
ACC = sys.argv[1] if len(sys.argv) > 1 else "crown"
ANIM = sys.argv[2] if len(sys.argv) > 2 else "idle"
TOK = next(k for k in ANIM_FILES[ANIM] if CANON[k] == ACC)
SCALE = int(sys.argv[3]) if len(sys.argv) > 3 else 4

os.makedirs("_overlay_qa", exist_ok=True)
tile = aligned_frames(ANIM, TOK)[0]
base = load_base(ANIM)[:, 0:T]

if ANIM in ("attack", "hurt"):
    mask = extract_exact(tile, base)
else:
    mask = extract_bubbly(tile, base, ACC)

# highlight selected pixels on a copy of the bubbly frame (red overlay)
hl = tile.copy().astype(int)
hl[mask] = (255, 0, 0, 255)

def up(a):
    im = Image.fromarray(a)
    return im.resize((im.width * SCALE, im.height * SCALE), Image.NEAREST)

base_img = up(base)
tile_img = up(tile)
hl_img = up(np.clip(hl, 0, 255).astype(np.uint8))
ov_img = up(make_overlay(tile, mask))

# row: bubbly source | mask | base+overlay | base alone
W = base_img.width
h = base_img.height
canvas = Image.new("RGBA", (W * 4 + 30, h), (60, 60, 60, 255))
canvas.paste(tile_img, (0, 0))
canvas.paste(hl_img, (W + 10, 0))
canvas.paste(ov_img, (W * 2 + 20, 0))
canvas.paste(base_img, (W * 3 + 30, 0))
out = f"_overlay_qa/{ANIM}_{ACC}_f0.png"
canvas.convert("RGB").save(out)
n = int((mask).sum())
print(out, "maskPix=", n)
