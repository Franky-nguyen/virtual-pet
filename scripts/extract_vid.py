import os
import subprocess

root = r"C:\Users\AD\Desktop\virtual-pet-main"
mp4 = os.path.join(root, ".monkeycode", "uploads", "Desktop_2026.09.04_-_18.07.45.01.mp4")
outdir = os.path.join(root, "_vid")
os.makedirs(outdir, exist_ok=True)
pat = os.path.join(outdir, "f_%03d.png")
r = subprocess.run(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", mp4,
     "-vf", "fps=4,scale=720:-1", pat],
    capture_output=True, text=True)
print("rc", r.returncode)
print(r.stderr[-3000:])
frames = sorted(f for f in os.listdir(outdir) if f.endswith(".png"))
print("frames:", len(frames))
