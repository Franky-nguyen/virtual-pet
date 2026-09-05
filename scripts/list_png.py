import os
root = r"C:\Users\AD\Desktop\virtual-pet-main"
for dirpath, dirnames, filenames in os.walk(root):
    # skip node_modules, .git, venv
    parts = dirpath.split(os.sep)
    if any(p in ("node_modules", ".git", "venv", "dist", "dist-electron", "build", "PosturePet_Installer", "__pycache__", "detector_venv") for p in parts):
        continue
    for fn in filenames:
        if fn.lower().endswith(".png"):
            full = os.path.join(dirpath, fn)
            print(os.path.relpath(full, root))
