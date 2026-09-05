#!/usr/bin/env python3
"""App-realistic preview: each cleaned frame rendered the way the app shows it
(64px tile, NEAREST upscale x2, pixelated CSS) on the light pet circle bg."""
import os
import numpy as np
from PIL import Image, ImageDraw

EVO = "src/assets/pets/evolved"
CLEAN = "_cleaned_evo"
SCALE = 2


def frame_img(sheet_path, idx):
    a = np.array(Image.open(sheet_path).convert("RGBA"))
    return a[:, idx*64:(idx+1)*64]


def render(tile, size=64):
    """NEAREST upscale on light backdrop, like the app's pixelated sprite."""
    img = Image.fromarray(tile).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (248, 245, 240, 255))
    return Image.alpha_composite(canvas, img).resize((size*SCALE, size*SCALE), Image.NEAREST)


def strip(anim, idx, accs, labels):
    base = frame_img(f"{EVO}/evolved_{anim}.png", idx)
    parts = [render(base)]
    for acc in accs:
        parts.append(render(frame_img(f"{CLEAN}/evolved_{anim}_{acc}.png", idx)))
    W = 64*SCALE + 8
    sheet = Image.new("RGBA", (len(parts)*W, 64*SCALE + 14), (255, 255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    for i, (p, lab) in enumerate(zip(parts, labels)):
        x = i*W
        sheet.paste(p, (x + 4, 4))
        dr.text((x + 4, 64*SCALE + 4), lab, fill=(0, 0, 0, 255))
    return sheet


anim, idx = "idle", 0
accs = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]
labels = ["base"] + accs
img = strip(anim, idx, accs, labels)
out = "_frame_review/app_preview_idle_f0.png"
img.save(out)
print("saved", out, img.size)
