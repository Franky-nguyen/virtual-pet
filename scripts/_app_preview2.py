#!/usr/bin/env python3
"""Render app-like previews for several anim/frame combos (native clean set)."""
import numpy as np
from PIL import Image, ImageDraw

EVO = "src/assets/pets/evolved"
CLEAN = "_cleaned_evo"
SCALE = 2


def frame_img(sheet_path, idx):
    a = np.array(Image.open(sheet_path).convert("RGBA"))
    return a[:, idx*64:(idx+1)*64]


def render(tile, size=64):
    img = Image.fromarray(tile).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (248, 245, 240, 255))
    return Image.alpha_composite(canvas, img).resize((size*SCALE, size*SCALE), Image.NEAREST)


def strip(anim, idx, accs):
    labels = ["base"] + accs
    base = frame_img(f"{EVO}/evolved_{anim}.png", idx)
    parts = [render(base)]
    for acc in accs:
        parts.append(render(frame_img(f"{CLEAN}/evolved_{anim}_{acc}.png", idx)))
    W = 64*SCALE + 6
    sheet = Image.new("RGBA", (len(parts)*W, 64*SCALE + 12), (255, 255, 255, 255))
    dr = ImageDraw.Draw(sheet)
    for i, (p, lab) in enumerate(zip(parts, labels)):
        x = i*W
        sheet.paste(p, (x + 3, 3))
        dr.text((x + 3, 64*SCALE + 3), lab, fill=(0, 0, 0, 255))
    return sheet


accs = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]
for anim, idx in [("walk", 2), ("death", 0), ("death", 4), ("hurt", 0), ("attack", 0)]:
    img = strip(anim, idx, accs)
    out = f"_frame_review/app_preview_{anim}_f{idx}.png"
    img.save(out)
    print("saved", out, img.size)
