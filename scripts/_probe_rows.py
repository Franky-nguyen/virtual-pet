#!/usr/bin/env python3
"""Row-width profile of base idle/walk frames and hat-less bubbly frames."""
import sys
import numpy as np
sys.path.insert(0, ".")
from extract_overlays import load_base, aligned_frames

for name, arr in [("base_idle", load_base("idle")[:, 0:64]),
                  ("base_walk_f0", load_base("walk")[:, 0:64]),
                  ("bubbly_idle_bowtie", aligned_frames("idle", "bowtie")[0]),
                  ("bubbly_idle_sunglass", aligned_frames("idle", "sunglass")[0]),
                  ("bubbly_idle_wizardhat", aligned_frames("idle", "wizardhat")[0])]:
    print(f"\n== {name} ==")
    out = []
    for y in range(64):
        row = arr[y]
        m = row[:, 3] > 0
        if m.any():
            xs = np.nonzero(m)[0]
            # mean brightness
            rgb = row[m][:, :3].astype(int)
            v = np.max(rgb, 1)
            dark = int((v < 90).sum())
            out.append(f"r{y}: w={xs.max()-xs.min()+1:2d} x[{xs.min():2d}-{xs.max():2d}] dark={dark}")
    print("  " + "  ".join(out))
