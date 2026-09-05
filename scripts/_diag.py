#!/usr/bin/env python3
"""Diagnostic: where are bubbly accessory pixels vs learned palette?."""
import sys
import numpy as np
sys.path.insert(0, ".")
from extract_overlays import aligned_frames, build_palettes, min_dist, base_head_top, load_base

P, D = build_palettes()
for acc, tok, anim in [("wizardhat", "wizardhat", "idle"),
                       ("crown", "cown", "idle"),
                       ("bowtie", "bowtie", "idle"),
                       ("sunglasses", "sunglass", "idle")]:
    tile = aligned_frames(anim, tok)[0]
    bf = load_base(anim)[:, 0:64]
    bt = base_head_top(bf)
    print(f"\n== {acc} idle f0 | base head top={bt} paletteN={len(P[acc])}")
    m = tile[:, :, 3] > 0
    # top rows that are above the bubbly body -> hat zone for hats
    ys, xs = np.nonzero(m)
    for zone, sel in [("top0-14", (ys < 15)),
                      ("15-30", (ys >= 15) & (ys < 31)),
                      ("31-bt+18", (ys >= 31) & (ys <= bt + 18)),
                      ("below bt+18", ys > bt + 18)]:
        if not sel.any():
            continue
        pix = tile[ys[sel], xs[sel], :3].astype(int)
        da = min_dist(pix, P[acc]) if len(P[acc]) else np.full(len(pix), 999)
        dd = min_dist(pix, D)
        print(f"  zone {zone:12s} n={len(pix):4d} da med={np.median(da):5.0f} pct<=60={100*(da<=60).mean():3.0f}% "
              f"pct<=100={100*(da<=100).mean():3.0f}%  dd med={np.median(dd):4.0f} "
              f"pct(dd-da>=15)={100*((dd-da>=15)&(da<=75)).mean():3.0f}%")
