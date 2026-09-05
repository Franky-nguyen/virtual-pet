import os
from PIL import Image, ImageDraw
from pathlib import Path

root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
out = Path(root) / "_vid_strips"
out.mkdir(exist_ok=True)

frames = sorted(p for p in src.glob("f_*.png"))
cols = 6
SCALE = 1  # frames already scaled
for start in range(0, len(frames), cols):
    group = frames[start:start+cols]
    imgs = [Image.open(p) for p in group]
    w = max(im.width for im in imgs)
    h = max(im.height for im in imgs)
    canvas = Image.new("RGB", (w * cols, h + 16), (20, 20, 24))
    d = ImageDraw.Draw(canvas)
    for i, im in enumerate(imgs):
        canvas.paste(im, (i * w, 16))
        d.text((i * w + 2, 2), group[i].stem, fill=(255, 220, 120))
    op = out / f"strip_{start:03d}.png"
    canvas.save(op)
print("saved", len(range(0, len(frames), cols)), "strips")
