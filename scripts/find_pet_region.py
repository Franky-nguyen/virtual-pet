from PIL import Image
from pathlib import Path
import numpy as np
root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
for name in ["f_005", "f_015", "f_025", "f_045", "f_065", "f_080"]:
    a = np.array(Image.open(src / f"{name}.png").convert("RGB")).astype(int)
    h, w, _ = a.shape
    print(f"--- {name} mean={a.mean():.0f} std={a.std():.0f}")
    # find high-variance 40px blocks
    best = []
    for y in range(0, h - 40, 10):
        for x in range(0, w - 40, 10):
            b = a[y:y+40, x:x+40]
            v = b.std()
            if v > 30:
                best.append((v, x, y))
    best.sort(reverse=True)
    for v, x, y in best[:6]:
        print(f"   block x{x:3d} y{y:3d} std={v:.0f}")
