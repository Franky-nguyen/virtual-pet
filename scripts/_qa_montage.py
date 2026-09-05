#!/usr/bin/env python3
"""QA contact sheet: bubbly idle accessory frames vs base idle frame."""
import numpy as np
from PIL import Image
import os

EVO = "src/assets/pets/evolved"
IMP = r"src\assets\evo acessories"
os.makedirs("_overlay_qa", exist_ok=True)

TOK = {"bowtie": "bowtie", "crown": "cown", "partyhat": "partyhat",
       "sunglasses": "sunglass", "wizardhat": "wizardhat"}
T = 64

base = Image.open(f"{EVO}/evolved_idle.png").convert("RGBA")

cols = []
for acc in ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]:
    tok = TOK[acc]
    a = Image.open(os.path.join(IMP, f"evo_idle_{tok}.png")).convert("RGBA")
    w, h = a.size
    n = w // 64
    row = [a.crop((i*64, 0, i*64+64, 64)) for i in range(n)]
    cols.append((acc, row))

# build a labelled grid: column per accessory frame 0.., row per accessory
CELL = 64
PAD = 2
grid_w = CELL + sum(len(r) for _, r in cols) * (CELL + PAD)
grid_h = 24 + len(cols) * (CELL + PAD)
img = Image.new("RGBA", (grid_w, grid_h), (240, 240, 240, 255))
y = 24
for acc, row in cols:
    x = CELL + PAD
    img.paste(base.crop((0, 0, T, T)), (2, y + 2))  # base idle frame0 reference
    for fr in row:
        img.paste(fr, (x, y))
        x += CELL + PAD
    y += CELL + PAD
img.convert("RGB").save("_overlay_qa/raw_idle_compare.png")
print("saved", img.size)
