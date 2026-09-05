#!/usr/bin/env python3
"""How much of each bubbly sheet differs from the base dog, per frame."""
import sys
import numpy as np
sys.path.insert(0, ".")
from extract_overlays import aligned_frames, load_base, CANON, ANIM_FILES

for anim, tok in [("attack", "wizardhat"), ("hurt", "wizardhat"),
                  ("idle", "wizardhat"), ("walk", "wizardhat"),
                  ("attack", "bowtie"), ("hurt", "bowtie")]:
    base = load_base(anim)
    n = base.shape[1] // 64
    frames = aligned_frames(anim, tok)
    outs = []
    for i in range(min(n, len(frames))):
        bf = base[:, i*64:(i+1)*64]
        t = frames[i]
        sm = t[:, :, 3] > 0
        bm = bf[:, :, 3] > 0
        diff = np.abs(t[:, :, :3].astype(int) - bf[:, :, :3].astype(int)).sum(axis=2)
        on_body = sm & bm
        over45 = ((diff > 45) & on_body).sum()
        # body pixels that are essentially identical
        same = ((diff <= 25) & on_body).sum()
        tot_body = on_body.sum()
        outs.append(f"f{i}: bodypx={tot_body} same<25={100*same/max(1,tot_body):.0f}% diff>45={100*over45/max(1,tot_body):.0f}%")
    print(f"{anim}_{tok}: " + "  ".join(outs))
