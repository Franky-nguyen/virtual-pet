#!/usr/bin/env python3
"""Measure base-dog head geometry + accessory seed colours (for code-drawn overlays)."""
import sys
import numpy as np
sys.path.insert(0, ".")
from extract_overlays import load_base, aligned_frames, ANIM_FILES, CANON

def frame_geom(bf):
    bm = bf[:, :, 3] > 0
    ys, xs = np.nonzero(bm)
    if not len(ys):
        return None
    t = int(ys.min())
    rows = []
    for y in range(t, min(64, t + 32)):
        r = np.nonzero(bm[y])[0]
        if len(r):
            rows.append((y, int(r.min()), int(r.max())))
    # locate the widest head band row, then find where width collapses above/below
    wmax_y, wmax = max(rows, key=lambda q: q[2] - q[1])[:2]
    maxw = wmax
    # climb up from wmax_y while row is contiguous within 55% width
    top_b = wmax_y
    for y, x0, x1 in rows:
        if y >= wmax_y:
            break
        if (x1 - x0) < 0.55 * maxw and wmax_y - y <= 6:
            pass
    tb = wmax_y
    bb = wmax_y
    for y, x0, x1 in sorted(rows):
        if y < wmax_y and (x1 - x0) < 0.5 * maxw and (wmax_y - y) <= 6:
            tb = min(tb, y + 1)
    for y, x0, x1 in rows:
        if y > wmax_y and (x1 - x0) < 0.55 * maxw:
            break
        bb = y
    # widen search to a simpler band: head = rows [tb..bb] where tb may still be wmax_y
    hband = bm[tb:bb + 1]
    if not hband.any():
        tb, bb = t, t
        hband = bm[t:t+1]
    bxs = np.nonzero(hband)[1]
    cx = float(bxs.mean())
    hlen = bb - tb + 1
    hw = maxw
    # eye row: dark-pixel peak in upper 60% of head
    hl = max(1, int(hlen * 0.6))
    best, brow = -1, tb + 2
    for y in range(tb, min(bb + 1, tb + hl)):
        row = bf[y]
        mrow = row[:, 3] > 0
        if mrow.any():
            v = np.maximum(np.maximum(row[:, 0], row[:, 1]), row[:, 2]).astype(int)
            cnt = int((v < 90)[mrow].sum())
            if cnt > best:
                best, brow = cnt, y
    return dict(top=t, headTop=tb, cx=cx, head_bot=bb, hlen=hlen, headW=hw,
                wmax_y=wmax_y, drow=brow, rel=brow - tb)

print("== base dog geometry per frame ==")
for anim in ["idle", "walk"]:
    base = load_base(anim)
    n = base.shape[1] // 64
    for i in range(n):
        g = frame_geom(base[:, i*64:(i+1)*64])
        print(f"{anim} f{i}: bodyTop={g['top']} headRows={g['headTop']}-{g['head_bot']} "
              f"headH={g['hlen']} headW={g['headW']} headCx={g['cx']:.1f} darkRowRel={g['rel']}")

print("\n== accessory seed colours (saturated clusters in bubbly art) ==")
for acc in ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]:
    tok = next(k for k in ANIM_FILES["idle"] if CANON[k] == acc)
    tile = aligned_frames("idle", tok)[0]
    R = tile[:, :, 0].astype(int); G = tile[:, :, 1].astype(int); B = tile[:, :, 2].astype(int)
    m = tile[:, :, 3] > 0
    Rm, Gm, Bm = R[m], G[m], B[m]
    pix = np.stack([Rm, Gm, Bm], 1)
    if acc == "wizardhat":
        score = Bm - Rm + np.abs(Gm - 130)
    elif acc == "bowtie":
        score = Rm - np.maximum(Gm, Bm)
    elif acc == "crown":
        score = Rm + Gm - 2 * Bm
    elif acc == "partyhat":
        score = np.max(pix, 1) - np.min(pix, 1)
    else:
        score = 255 - np.max(pix, 1)
    hi = int(np.quantile(score, 0.97))
    seed = pix[score >= hi]
    med = np.median(seed, 0).round()
    print(f"{acc:11s} n={len(seed):4d} main={tuple(int(v) for v in med)}")
