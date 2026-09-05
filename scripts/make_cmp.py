from PIL import Image, ImageDraw
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
DIR = Path(root) / "src/assets/pets/evolved"
out = Path(root) / "_frame_review"
out.mkdir(exist_ok=True)

def sheet_with_grid(name, scale=2):
    img = Image.open(DIR / name).convert("RGBA")
    w, h = img.size
    t = h
    frames = w // t
    cell = t * scale
    pad = 2
    canvas = Image.new("RGBA", (frames * (cell + pad) + pad, cell + pad), (30, 30, 36, 255))
    d = ImageDraw.Draw(canvas)
    for i in range(frames):
        f = img.crop((i * t, 0, (i + 1) * t, t)).resize((cell, cell), Image.NEAREST)
        x = pad + i * (cell + pad)
        canvas.paste(f, (x, pad), f)
        # grid lines: center x = 32, baseline y = 63
        cx = x + 32 * scale
        by = pad + 63 * scale
        d.line([(cx, pad), (cx, pad + cell)], fill=(255, 60, 60, 255), width=1)
        d.line([(x, by), (x + cell, by)], fill=(60, 255, 60, 255), width=1)
    return canvas

for pair in [("evolved_walk.png", "evolved_walk_crown.png"),
             ("evolved_idle.png", "evolved_idle_crown.png"),
             ("evolved_walk.png", "evolved_walk_bowtie.png")]:
    a = sheet_with_grid(pair[0])
    b = sheet_with_grid(pair[1])
    combined = Image.new("RGBA", (max(a.width, b.width), a.height + b.height + 30), (25, 25, 30, 255))
    d = ImageDraw.Draw(combined)
    d.text((6, 4), pair[0] + "   (red = x32 center, green = y63 baseline)", fill=(230, 230, 230, 255))
    combined.paste(a, (0, 24), a)
    d.text((6, 24 + a.height + 2), pair[1], fill=(230, 230, 230, 255))
    combined.paste(b, (0, 24 + a.height + 20), b)
    op = out / ("cmp_" + pair[0].replace("evolved_", "").replace(".png", "") + "_" + pair[1].replace("evolved_walk_", "").replace("evolved_idle_", "").replace(".png", "") + ".png")
    combined.save(op)
    print(op)
