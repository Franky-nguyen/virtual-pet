from PIL import Image, ImageDraw
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
files = sorted(src.glob("f_*.png"))
# 1-second sampling: every 4th frame, resized 360 wide
samp = files[::4]
out = Path(root) / "_vid_overview"
out.mkdir(exist_ok=True)
cols = 6
tw, th = 360, 225
for start in range(0, len(samp), cols):
    group = samp[start:start+cols]
    canvas = Image.new("RGB", (tw * cols, th + 18), (20, 20, 24))
    d = ImageDraw.Draw(canvas)
    for i, p in enumerate(group):
        im = Image.open(p).resize((tw, th), Image.LANCZOS)
        canvas.paste(im, (i * tw, 18))
        d.text((i * tw + 2, 2), p.stem.replace("f_", ""), fill=(255, 220, 120))
    canvas.save(out / f"ov_{start:03d}.png")
print("saved", len(range(0, len(samp), cols)))
