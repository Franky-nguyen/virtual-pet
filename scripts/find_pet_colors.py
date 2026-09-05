from PIL import Image
import numpy as np
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
# evolved dog signature colors
targets = [(242,172,55), (252,242,166), (165,109,59), (4,4,5)]
for name in ["f_001","f_020","f_045","f_070","f_086"]:
    a = np.array(Image.open(src / f"{name}.png").convert("RGB")).astype(int)
    m = np.zeros(a.shape[:2], dtype=bool)
    for (r,g,b) in targets:
        m |= (abs(a[:,:,0]-r)<12) & (abs(a[:,:,1]-g)<12) & (abs(a[:,:,2]-b)<12)
    ys, xs = np.nonzero(m)
    if len(xs):
        # cluster into components roughly by scanning blocks of 30px
        print(f"{name}: px {len(xs)} bbox x[{xs.min()}..{xs.max()}] y[{ys.min()}..{ys.max()}]")
        # histogram over 60px grid
        from collections import Counter
        c = Counter()
        for y,x in zip(ys, xs):
            c[(x//60, y//60)] += 1
        for k,v in c.most_common(8):
            print("    cell", k, v)
