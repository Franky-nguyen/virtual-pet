import os
import subprocess

root = r"C:\Users\AD\Desktop\virtual-pet-main"
print("listing .monkeycode:", os.listdir(os.path.join(root, ".monkeycode")))
try:
    print("uploads:", os.listdir(os.path.join(root, ".monkeycode", "uploads")))
except Exception as e:
    print("uploads error:", e)

mp4 = os.path.join(root, ".monkeycode", "uploads", "Desktop_2026.09.04_-_18.07.45.01.mp4")
print("exists:", os.path.exists(mp4), repr(mp4))
