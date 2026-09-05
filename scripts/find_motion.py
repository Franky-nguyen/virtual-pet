import os
from PIL import Image, ImageChops, ImageStat
from pathlib import Path

root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
files = sorted(src.glob("f_*.png"))
prev = None
for p in files:
    im = Image.open(p).convert("RGB")
    if prev is not None:
        diff = ImageChops.difference(im, prev)
        bbox = diff.getbbox()  # overall
        # threshold diff to find strong motion
        gray = diff.convert("L")
        # bounding box of pixels brighter than 40
        px = gray.load()
        w, h = gray.size
        minx, miny, maxx, maxy = w, h, -1, -1
        cnt = 0
        for y in range(0, h, 2):
            for x in range(0, w, 2):
                if px[x, y] > 40:
                    cnt += 1
                    if x < minx: minx = x
                    if x > maxx: maxx = x
                    if y < miny: miny = y
                    if y > maxy: maxy = y
        if cnt > 5:
            print(p.stem, "motion bbox:", (minx, miny, maxx, maxy), "threshpx", cnt)
    prev = im
