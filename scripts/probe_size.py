from PIL import Image
from pathlib import Path
root = r"C:\Users\AD\Desktop\virtual-pet-main"
src = Path(root) / "_vid"
files = sorted(src.glob("f_*.png"))
im = Image.open(files[0])
print("frame size:", im.size, "total frames:", len(files))
