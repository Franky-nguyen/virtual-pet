from PIL import Image, ImageDraw
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
DIR = Path(root) / "src/assets/pets/evolved"
out = Path(root) / "_frame_review"
out.mkdir(exist_ok=True)

def build(name, scale=6):
    img = Image.open(DIR / name).convert("RGBA")
    t = img.height
    frames = img.width // t
    cell = t * scale
    imgs = []
    for i in range(frames):
        f = img.crop((i*t, 0, (i+1)*t, t)).resize((cell, cell), Image.NEAREST)
        bg = Image.new("RGB", (cell, cell))
        d = ImageDraw.Draw(bg)
        sq = cell // 8
        for yy in range(8):
            for xx in range(8):
                c = (205,205,205) if (xx+yy)%2==0 else (170,170,170)
                d.rectangle([xx*sq, yy*sq, (xx+1)*sq-1, (yy+1)*sq-1], fill=c)
        bg.paste(f, (0,0), f)
        canvas = Image.new("RGB", (cell + 2, cell + 22), (40,40,40))
        cd = ImageDraw.Draw(canvas)
        cd.text((4, 4), str(i), fill=(255,220,120))
        canvas.paste(bg, (0, 20))
        imgs.append(canvas)
    return imgs

def sheet_grid(name):
    imgs = build(name)
    w = sum(im.width for im in imgs)
    h = max(im.height for im in imgs)
    big = Image.new("RGB", (w, h), (20,20,20))
    x = 0
    for im in imgs:
        big.paste(im, (x, 0)); x += im.width + 4
    op = out / f"row_{name.replace('evolved_','')}.png"
    big.save(op)
    print(op, big.size)

for n in ["evolved_walk.png", "evolved_walk_crown.png", "evolved_walk_partyhat.png",
          "evolved_walk_sunglasses.png", "evolved_walk_wizardhat.png", "evolved_walk_bowtie.png",
          "evolved_idle.png", "evolved_idle_crown.png"]:
    sheet_grid(n)
