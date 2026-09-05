from PIL import Image, ImageDraw
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
out = Path(root) / "_vid_zoom"
out.mkdir(exist_ok=True)
for name in ["f_005", "f_025", "f_045", "f_070"]:
    im = Image.open(src / f"{name}.png").convert("RGB")
    w, h = im.size
    # full frame tiled 1x + center zoom
    z = im.crop((200, 100, 620, 400)).resize((840, 600), Image.NEAREST)
    canvas = Image.new("RGB", (w, h + 610), (25,25,30))
    canvas.paste(im, (0, 0))
    canvas.paste(z, (0, h + 10))
    canvas.save(out / f"{name}.png")
print("ok")
