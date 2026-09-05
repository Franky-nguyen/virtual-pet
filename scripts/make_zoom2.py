from PIL import Image, ImageDraw
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
DIR = Path(root) / "src/assets/pets/evolved"
out = Path(root) / "_frame_review"
out.mkdir(exist_ok=True)

def single(name, i, scale=10):
    img = Image.open(DIR / name).convert("RGBA")
    t = img.height
    f = img.crop((i*t, 0, (i+1)*t, t)).resize((t*scale, t*scale), Image.NEAREST)
    cell = t*scale
    bg = Image.new("RGB", (cell, cell))
    d = ImageDraw.Draw(bg)
    sq = cell//8
    for yy in range(8):
        for xx in range(8):
            c = (205,205,205) if (xx+yy)%2==0 else (170,170,170)
            d.rectangle([xx*sq, yy*sq, (xx+1)*sq-1, (yy+1)*sq-1], fill=c)
    bg.paste(f, (0,0), f)
    canvas = Image.new("RGB", (cell, cell+24), (40,40,40))
    cd = ImageDraw.Draw(canvas)
    cd.text((4,4), f"{name} frame {i}", fill=(255,220,120))
    canvas.paste(bg, (0,24))
    return canvas

imgs = []
for name, idx in [("evolved_walk_crown.png", 2), ("evolved_walk_crown.png", 3),
                  ("evolved_walk_crown.png", 0), ("evolved_walk_partyhat.png", 3),
                  ("evolved_walk_partyhat.png", 4), ("evolved_walk_wizardhat.png", 4),
                  ("evolved_idle_crown.png", 0), ("evolved_walk.png", 0)]:
    imgs.append(single(name, idx))
w = sum(im.width for im in imgs) + 8*(len(imgs)-1)
h = max(im.height for im in imgs)
big = Image.new("RGB", (w, h), (15,15,15))
x = 0
for im in imgs:
    big.paste(im, (x,0)); x += im.width + 8
op = out/"zoom_frames2.png"
big.save(op)
print(op, big.size)
