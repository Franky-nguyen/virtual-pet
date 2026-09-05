#!/usr/bin/env python3
"""Contact-sheet visual QA: each cleaned accessory frame zoomed, on checker,
with a red outline of the matching base frame overlaid to verify registration.
usage: _visual_qa.py <anim> <zoom>"""
import sys
import os
from PIL import Image, ImageDraw
import numpy as np

CLEAN = "_cleaned_evo"
EVO = "src/assets/pets/evolved"
ZOOM = int(sys.argv[2]) if len(sys.argv) > 2 else 4
anim = sys.argv[1]
accs = sorted(f for f in os.listdir(CLEAN) if f.startswith(f"evolved_{anim}_"))
base = np.array(Image.open(f"{EVO}/evolved_{anim}.png").convert("RGBA"))
n = base.shape[1] // 64

def outline(tile):
    """red outline of opaque pixels."""
    m = tile[:, :, 3] > 0
    m = np.pad(m, 1)[1:-1, 1:-1]
    edge = m & ~(np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1))
    return edge

cell = ZOOM * 64
margin = 16
pad = 4
cols = n
rows = len(accs)
sheet = Image.new("RGBA", (margin * 2 + cols * (cell + pad), margin * 2 + rows * (cell + pad)),
                  (255, 255, 255, 255))
dr = ImageDraw.Draw(sheet)
for r, f in enumerate(accs):
    strip = np.array(Image.open(os.path.join(CLEAN, f)).convert("RGBA"))
    for c in range(n):
        tile = strip[:, c*64:(c+1)*64]
        # checker
        chk = np.zeros((64, 64, 3), dtype=np.uint8)
        for yy in range(64):
            for xx in range(64):
                chk[yy, xx] = (235, 235, 235) if ((yy // 8 + xx // 8) % 2 == 0) else (210, 210, 210)
        comp = np.array(Image.new("RGBA", (64, 64)))
        img = Image.fromarray(tile).convert("RGBA")
        ch_img = Image.fromarray(chk).convert("RGBA")
        comp = Image.alpha_composite(ch_img, img)
        big = comp.resize((cell, cell), Image.NEAREST)
        # overlay base outline in red
        bf = base[:, c*64:(c+1)*64]
        o = outline(bf)
        ov = np.array(big)
        for yy in range(64):
            for xx in range(64):
                if o[yy, xx]:
                    for k in range(ZOOM):
                        for j in range(ZOOM):
                            ov[yy*ZOOM+k, xx*ZOOM+j] = (255, 60, 60, 255)
        big = Image.fromarray(ov)
        x = margin + c * (cell + pad)
        y = margin + r * (cell + pad)
        sheet.paste(big, (x, y))
    dr.text((margin, y - 16), f.split(".")[0].replace("evolved_", ""), fill=(0, 0, 0, 255))
outp = f"_frame_review/qa_{anim}.png"
os.makedirs("_frame_review", exist_ok=True)
sheet.save(outp)
print("saved", outp, sheet.size)
