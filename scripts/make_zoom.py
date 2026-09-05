from PIL import Image, ImageDraw
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
DIR = Path(root) / "src/assets/pets/evolved"
out = Path(root) / "_frame_review"
out.mkdir(exist_ok=True)

def frame(name, i):
    img = Image.open(DIR / name).convert("RGBA")
    t = img.height
    return img.crop((i*t, 0, (i+1)*t, t))

# Compare the same index frames across sheets at 8x
pairs = [("evolved_walk.png", 2), ("evolved_walk_crown.png", 2),
         ("evolved_walk.png", 3), ("evolved_walk_crown.png", 3),
         ("evolved_idle.png", 0), ("evolved_idle_crown.png", 0),
         ("evolved_walk_bowtie.png", 3)]
S = 8
imgs = []
for name, i in pairs:
    f = frame(name, i).resize((64*S, 64*S), Image.NEAREST)
    # checker background for transparency
    bg = Image.new("RGB", (64*S, 64*S))
    d = ImageDraw.Draw(bg)
    for yy in range(8):
        for xx in range(8):
            c = (200,200,200) if (xx+yy)%2==0 else (160,160,160)
            d.rectangle([xx*8*S, yy*8*S, (xx+1)*8*S-1, (yy+1)*8*S-1], fill=c)
    bg.paste(f, (0,0), f)
    canvas = Image.new("RGB", (64*S + 2, 64*S + 22), (30,30,30))
    cd = ImageDraw.Draw(canvas)
    cd.text((2,2), f"{name} f{i}", fill=(255,220,120))
    canvas.paste(bg, (0, 20))
    imgs.append(canvas)

w = sum(im.width for im in imgs) + 10*(len(imgs)-1)
h = max(im.height for im in imgs)
big = Image.new("RGB", (w, h), (15,15,15))
x = 0
for im in imgs:
    big.paste(im, (x, 0))
    x += im.width + 10
op = out / "zoom_frames.png"
big.save(op)
print(op, big.size)
