from PIL import Image, ImageDraw
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
out = Path(root) / "_vid_zone"
out.mkdir(exist_ok=True)
BOX = (180, 220, 560, 450)
cols = 8
SCALE = 2
files = sorted(src.glob("f_*.png"))
for start in range(0, len(files), cols):
    group = files[start:start+cols]
    tw = (BOX[2]-BOX[0])*SCALE
    th = (BOX[3]-BOX[1])*SCALE
    canvas = Image.new("RGB", (tw*cols, th+16), (25,25,30))
    d = ImageDraw.Draw(canvas)
    for i, p in enumerate(group):
        im = Image.open(p).convert("RGB").crop(BOX).resize((tw, th), Image.NEAREST)
        canvas.paste(im, (i*tw, 16))
        d.text((i*tw+2, 2), p.stem.split("_")[1], fill=(255,220,120))
    canvas.save(out / f"zone_{start:03d}.png")
print("ok")
