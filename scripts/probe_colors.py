from PIL import Image
import numpy as np
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
p = Path(root) / "src/assets/pets/evolved/evolved_idle.png"
a = np.array(Image.open(p).convert("RGBA"))
t = 64
# tile 0
tile = a[:, 0:t, :]
opaque = tile[tile[:,:,3] > 128]
print("evolved dog opaque px color stats (RGB):")
print("mean", opaque[:, :3].mean(axis=0).round(1))
# sample of the top 12 colors
from collections import Counter
colors = Counter(map(tuple, opaque[:, :3]))
for c, n in colors.most_common(12):
    print("   ", c, n)
