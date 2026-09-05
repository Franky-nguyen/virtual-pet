from PIL import Image
import numpy as np
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
for name in ["f_002","f_005","f_010","f_020","f_030","f_040","f_050","f_060","f_070","f_080","f_086"]:
    a = np.array(Image.open(src / f"{name}.png").convert("RGB")).astype(int)
    h, w, _ = a.shape
    # gold mask: r>140, g between 90-220, b<180, r>g>b-ish warm tones
    m = (a[:,:,0] > 130) & (a[:,:,1] > 90) & (a[:,:,1] < 230) & (a[:,:,2] > 40) & (a[:,:,2] < 200) & (a[:,:,0] > a[:,:,2])
    ys, xs = np.nonzero(m)
    if len(xs):
        print(f"{name}: gold px {len(xs)} bbox x[{xs.min()}..{xs.max()}] y[{ys.min()}..{ys.max()}]")
    else:
        print(f"{name}: none")
