#!/usr/bin/env python3
"""Difference overlays: base walk f_i vs f_{i+1}, and walk f0 vs idle f0."""
from pathlib import Path
import numpy as np
from PIL import Image

DIR = Path("src/assets/pets/evolved")
T = 64
Z = 8

def frames(name):
    a = np.array(Image.open(DIR / f"{name}.png").convert("RGBA"))
    n = a.shape[1] // T
    return [a[:, i*T:(i+1)*T] for i in range(n)]

def diff_overlay(fa, fb):
    """red = only in a, blue = only in b, gray-ish = same alpha; returns RGBA"""
    am = fa[:, :, 3] > 0
    bm = fb[:, :, 3] > 0
    out = np.zeros((T, T, 4), dtype=np.uint8)
    only_a = am & ~bm
    only_b = bm & ~am
    both = am & bm
    out[only_a] = (255, 60, 60, 255)
    out[only_b] = (60, 90, 255, 255)
    out[both] = (180, 180, 180, 255)
    return out

def grid(fs, cols, path):
    rows = (len(fs)+cols-1)//cols
    canvas = np.zeros((rows*T*Z, cols*T*Z, 4), dtype=np.uint8)
    for k, f in enumerate(fs):
        zf = np.kron(f, np.ones((Z, Z, 1), dtype=np.uint8))
        r, c = divmod(k, cols)
        canvas[r*T*Z:(r+1)*T*Z, c*T*Z:(c+1)*T*Z] = zf
    Image.fromarray(canvas).save(path)

walk = frames("evolved_walk")
idle = frames("evolved_idle")

diffs = [diff_overlay(walk[i], walk[(i+1) % 8]) for i in range(8)]
grid(diffs, 8, "_frame_review/evo_walk_step_diffs.png")
d0 = diff_overlay(walk[0], walk[1])
Image.fromarray(np.kron(d0, np.ones((Z, Z, 1), dtype=np.uint8))).save("_frame_review/evo_walk_d01.png")
Image.fromarray(np.kron(diff_overlay(walk[0], idle[0]), np.ones((Z, Z, 1), dtype=np.uint8))).save("_frame_review/evo_walk0_vs_idle0.png")
Image.fromarray(np.kron(diff_overlay(walk[3], walk[4]), np.ones((Z, Z, 1), dtype=np.uint8))).save("_frame_review/evo_walk_d34.png")
print("ok")
