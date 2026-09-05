#!/usr/bin/env python3
"""Quantify per-frame horizontal/vertical drift in evolved sprite sheets.

For each sheet, for each tile, measure:
  - bbox of alpha (whole frame)
  - bbox of the bottom strip (ground contact / feet) rows [tile-9, tile-1]
  - centroid x of bottom strip
Report max-min spread (jitter) and the per-frame center values so we can see
whether accessory sheets drift more than the base sheet.
"""
import os
from pathlib import Path
from PIL import Image

DIR = Path("src/assets/pets/evolved")

def analyze(p: Path):
    img = Image.open(p).convert("RGBA")
    w, h = img.size
    tile = h
    frames = w // tile
    rows = []
    for i in range(frames):
        crop = img.crop((i * tile, 0, (i + 1) * tile, tile))
        px = crop.load()
        # full bbox
        min_x, min_y, max_x, max_y = tile, tile, -1, -1
        # feet strip centroid
        fy0 = tile - 9
        sx = sy = cnt = 0
        for y in range(tile):
            for x in range(tile):
                a = px[x, y][3]
                if a > 0:
                    if x < min_x: min_x = x
                    if x > max_x: max_x = x
                    if y < min_y: min_y = y
                    if y > max_y: max_y = y
                    if y >= fy0:
                        sx += x
                        sy += y
                        cnt += 1
        if cnt:
            fc = sx / cnt
        else:
            fc = -1
        rows.append((min_x, max_x, min_y, max_y, fc))
    # spreads
    xs = [r[0] for r in rows]
    xe = [r[1] for r in rows]
    ys = [r[2] for r in rows]
    ye = [r[3] for r in rows]
    fcs = [r[4] for r in rows if r[4] >= 0]
    return {
        "file": p.name, "w": w, "frames": frames,
        "x_min_range": (min(xs), max(xs)),
        "y_min_range": (min(ys), max(ys)),
        "feet_c_spread": (round(min(fcs),1), round(max(fcs),1)) if fcs else None,
        "per_frame": [f"t{i}:x[{a}..{b}] y[{c}..{d}] fc={round(e,1)}" for i,(a,b,c,d,e) in enumerate(rows)],
    }

anim_order = ["idle", "walk", "hurt", "attack", "death"]
for anim in anim_order:
    print("=" * 70)
    base = DIR / f"evolved_{anim}.png"
    if not base.exists():
        continue
    print(f"\n### {anim}  (base={base.name})")
    print("  file               xMinRange yMinRange  feetCenterSpread")
    sheets = [base] + sorted(DIR.glob(f"evolved_{anim}_*.png"))
    for s in sheets:
        r = analyze(s)
        xr = r["x_min_range"]
        yr = r["y_min_range"]
        fc = r["feet_c_spread"]
        fc_s = f"{fc[0]}..{fc[1]} (d={round(fc[1]-fc[0],1)})" if fc else "n/a"
        print(f"  {r['file']:22s} {xr[0]:2d}..{xr[1]:2d}    {yr[0]:2d}..{yr[1]:2d}    {fc_s}")
    # detailed per frame only for the interesting ones
    for s in sheets:
        r = analyze(s)
        if s != base:
            print(f"\n  -- {r['file']}")
            for line in r["per_frame"]:
                print(f"     {line}")
