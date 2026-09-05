#!/usr/bin/env python3
"""Contact sheet of all imported sheets at 4x (labels)."""
import os
import numpy as np
from PIL import Image, ImageDraw

IMP = r"src\assets\evo acessories"
Z = 4
files = sorted(f for f in os.listdir(IMP) if f.endswith(".png"))
cols = 2
cell_h = 70 * Z + 12
cell_w = 520
canvas = np.full((len(files) * cell_h, cell_w, 3), 30, dtype=np.uint8)
im_full = Image.fromarray(canvas)
d = ImageDraw.Draw(im_full)
y = 0
for f in files:
    im = Image.open(os.path.join(IMP, f)).convert("RGBA")
    # paste art with checker behind transparent if any
    w, h = im.size
    ratio = min(500 / w, 2.5)
    nw, nh = max(1, int(w * ratio)), max(1, int(h * ratio))
    im2 = im.resize((nw, nh), Image.NEAREST).convert("RGBA")
    im_full.paste(Image.new("RGBA", (im2.size[0], im2.size[1]), (60, 60, 60, 255)), (10, y + 8), im2)
    d.rectangle([0, y, cell_w - 1, y + cell_h - 1], outline=(90, 90, 90))
    d.text((8, y + 8 + nh + 4), f, fill=(255, 255, 255))
    y += cell_h

im_full = im_full.convert("RGB")
im_full.save("_frame_review/imported_overview.png")
print("saved", im_full.size)
