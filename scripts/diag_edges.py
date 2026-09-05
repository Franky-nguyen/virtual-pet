from PIL import Image
from pathlib import Path
import numpy as np
root = r"C:\Users\AD\Desktop\virtual-pet-main"
DIR = Path(root) / "src/assets/pets/evolved"

for name in ["evolved_walk_partyhat.png", "evolved_walk_crown.png",
             "evolved_walk_sunglasses.png", "evolved_walk_wizardhat.png",
             "evolved_walk_bowtie.png", "evolved_walk.png"]:
    a = np.array(Image.open(DIR / name).convert("RGBA"))[:, :, 3] > 0
    t = 64
    n = a.shape[1] // t
    print(f"\n{name}")
    for i in range(n):
        tile = a[:, i*t:(i+1)*t]
        col0 = tile[:, 0].sum()
        col63 = tile[:, 63].sum()
        # rows used
        ys, xs = np.nonzero(tile)
        xmin = xs.min(); xmax = xs.max()
        print(f"  f{i}: xmin={xmin} xmax={xmax} col0px={col0} col63px={col63}")
