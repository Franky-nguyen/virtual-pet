#!/usr/bin/env python3
"""
Extract floating accessory overlays for the EVOLVED pet.

Why overlays at all?
--------------------
The accessory sheets draw the adult dog with the item baked in, but that dog
is ~10-20% bigger than the base evolved dog AND its frames jitter (wobbly).
If we render the bubbly sheets, the body is the wrong size and visibly shakes.

Fix (overlay method):
  * The app always renders the steady, correctly-sized base evolved dog.
  * A transparent RGBA overlay strip (same 64x64 tile grid, same frame count)
    is stacked on top and carries ONLY the accessory pixels.
  * Body motion is therefore exactly the base dog's motion (steady).

Where do accessory pixels come from?
------------------------------------
In the attack and hurt sheets the dog body is pixel-identical to the base dog,
so the accessory is exactly the pixels that differ from the base frame.  This
extraction is verifiable (composite base+overlay reproduces the source sheet).
Those sheets also draw the accessory at base scale (no bubbly upsize).

The bubbly idle/walk/death bodies are re-drawn and share their colour palette
with the accessories, so per-frame pixel isolation there is unreliable.  We
instead take ONE clean accessory mask from a neutral attack/hurt frame and
rigidly translate it per frame so its anchor (base-dog head top / head centre)
tracks the same anchor on each idle/walk/death base frame.  Result: the item
rides the head exactly like the base animation does — no wobble, no resize.

Outputs: src/assets/pets/evolved/overlay_{accessory}_{anim}.png
"""
import os
import sys
from collections import Counter
import numpy as np
from PIL import Image

T = 64
EVO = "src/assets/pets/evolved"
IMP = r"src\assets\evo acessories"
OUT = "src/assets/pets/evolved"
ANIM_FILES = {  # accessory file token present per animation
    "idle":   ["bowtie", "cown", "partyhat", "sunglass", "wizardhat"],
    "walk":   ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "hurt":   ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "attack": ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
    "death":  ["bowtie", "crown", "partyhat", "sunglass", "wizardhat"],
}
CANON = {"bowtie": "bowtie", "crown": "crown", "cown": "crown",
         "partyhat": "partyhat", "sunglass": "sunglasses", "wizardhat": "wizardhat"}
EXACT_ANIMS = ("attack", "hurt")
HEAD_ANCHOR_ANIMS = ("idle", "walk", "death")

DRY = "--dry" in sys.argv
ONLY = []
for _a in sys.argv:
    if _a.startswith("--anim="):
        ONLY = _a.split("=", 1)[1].split(",")


def load_base(anim):
    return np.array(Image.open(os.path.join(EVO, f"evolved_{anim}.png")).convert("RGBA"))


def aligned_frames(anim, tok):
    """Pure-pixel aligned frames of the imported sheet on the base grid."""
    path = os.path.join(IMP, f"evo_{anim}_{tok}.png")
    a = np.array(Image.open(path).convert("RGBA")).astype(int)
    H, W = a.shape[0], a.shape[1]
    rgb = a[:, :, :3]
    border = np.concatenate([rgb[0], rgb[H - 1], rgb[:, 0], rgb[:, -1]], axis=0)
    bg = np.array(Counter(map(tuple, border)).most_common(1)[0][0])
    ink = np.abs(rgb - bg).sum(axis=2) > 50
    occ = ink.sum(axis=0)
    runs, in_run = [], False
    for x in range(W):
        if occ[x] > 0 and not in_run:
            s = x; in_run = True
        elif occ[x] == 0 and in_run:
            runs.append((s, x - 1)); in_run = False
    if in_run:
        runs.append((s, W - 1))
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 3:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    base = load_base(anim)
    n = base.shape[1] // T
    frames = []
    for i, (x0, x1) in enumerate(merged[:n]):
        cell_rgb = rgb[:, x0:x1 + 1].copy()
        cell_ink = ink[:, x0:x1 + 1].copy()
        ch, cw = cell_ink.shape
        rows = np.nonzero(cell_ink.any(axis=1))[0]
        lr = int(rows.max()) if len(rows) else 0
        bf = base[:, i*T:(i+1)*T]
        bm = bf[:, :, 3] > 0
        bys = np.nonzero(bm.any(axis=1))[0]
        ground = int(bys.max()) if len(bys) else 63
        oy = ground - lr
        tile = np.zeros((T, T, 4), dtype=np.uint8)
        for cy in range(ch):
            ty = cy + oy
            if not (0 <= ty < T):
                continue
            for cx in range(min(cw, T)):
                if cell_ink[cy, cx]:
                    tile[ty, cx, :3] = cell_rgb[cy, cx]
                    tile[ty, cx, 3] = 255
        tm = tile[:, :, 3] > 0
        ys, xs = np.nonzero(tm)
        if len(xs):
            dx = int(round(np.mean(xs) - np.mean(np.nonzero(bm)[1])))
            dx = max(-12, min(12, dx))
            if dx:
                out = np.zeros_like(tile)
                if dx > 0:
                    out[:, dx:] = tile[:, :T - dx]
                else:
                    out[:, :dx] = tile[:, -dx:]
                tile = out
        frames.append(tile)
    return frames


def comps(mask):
    H, W = mask.shape
    lab = np.zeros((H, W), dtype=int)
    cur = 0
    stack = []
    for y in range(H):
        for x in range(W):
            if mask[y, x] and lab[y, x] == 0:
                cur += 1
                lab[y, x] = cur
                stack.append((y, x))
                while stack:
                    yy, xx = stack.pop()
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = yy + dy, xx + dx
                            if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and lab[ny, nx] == 0:
                                lab[ny, nx] = cur
                                stack.append((ny, nx))
    return lab, cur


def keep_comps(lab, stats, keep_ids):
    m = np.zeros_like(lab, dtype=bool)
    for i, *_ in stats:
        if i in keep_ids:
            m |= (lab == i)
    return m


def exact_mask(tile, base_frame):
    """attack/hurt: body == base -> accessory = strong diff / outside silhouette."""
    s_m = tile[:, :, 3] > 0
    b_m = base_frame[:, :, 3] > 0
    diff = np.abs(tile[:, :, :3].astype(int) - base_frame[:, :, :3].astype(int)).sum(axis=2)
    cand = (s_m & ~b_m) | (s_m & b_m & (diff > 45))
    lab, n = comps(cand)
    stats = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        stats.append((i, len(ys)))
    keep = {i for i, c in stats if c >= 3}
    return keep_comps(lab, stats, keep)


def overlay_from(tile, mask):
    ov = np.zeros((T, T, 4), dtype=np.uint8)
    idx = np.nonzero(mask)
    if len(idx[0]):
        ov[idx] = tile[idx]
    return ov


def head_desc(base_frame):
    """(top row of the head, x-centroid of the head band) for a base frame."""
    bm = base_frame[:, :, 3] > 0
    ys, xs = np.nonzero(bm)
    if not len(ys):
        return 40, 32.0
    top = int(ys.min())
    band = bm[top:top + 11]
    band_xs = np.nonzero(band)[1]
    cx = float(band_xs.mean()) if len(band_xs) else float(xs.mean())
    return top, cx


def translate(ov, dx, dy):
    """Rigid integer translation, pixels lost off the 64x64 edge."""
    if dx == 0 and dy == 0:
        return ov
    out = np.zeros_like(ov)
    y_src0, y_src1 = max(0, -dy), min(T, T - dy)
    x_src0, x_src1 = max(0, -dx), min(T, T - dx)
    y_dst0, y_dst1 = y_src0 + dy, y_src1 + dy
    x_dst0, x_dst1 = x_src0 + dx, x_src1 + dx
    out[y_dst0:y_dst1, x_dst0:x_dst1] = ov[y_src0:y_src1, x_src0:x_src1]
    return out


def choose_master(acc, tok):
    """Pick the cleanest neutral attack/hurt frame for this accessory."""
    bases = {}
    desc_avgs = []
    idle_base = load_base("idle")
    for i in range(idle_base.shape[1] // T):
        t, cx = head_desc(idle_base[:, i*T:(i+1)*T])
        desc_avgs.append((t, cx))
    iav = tuple(np.mean([d[k] for d in desc_avgs]) for k in (0, 1))
    best = None
    for anim in EXACT_ANIMS:
        base = load_base(anim)
        n = base.shape[1] // T
        for i, tile in enumerate(aligned_frames(anim, tok)[:n]):
            bf = base[:, i*T:(i+1)*T]
            t, cx = head_desc(bf)
            score = abs(t - iav[0]) + 0.4 * abs(cx - iav[1])
            if best is None or score < best[0]:
                best = (score, anim, i, t, cx)
    return best


def build_master(acc, tok):
    """Exact accessory overlay + its head anchor from a neutral frame."""
    score, anim, i, t, cx = choose_master(acc, tok)
    base = load_base(anim)
    bf = base[:, i*T:(i+1)*T]
    tile = aligned_frames(anim, tok)[i]
    ov = overlay_from(tile, exact_mask(tile, bf))
    return ov, (t, cx), anim, i


def main():
    for acc in ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]:
        tok = {"sunglasses": "sunglass"}.get(acc, acc) if acc != "crown" else "crown"
        # per-anim token for master pick (attack uses canonical token names)
        master_tok = next(k for k in ANIM_FILES["attack"] if CANON[k] == acc)
        master, mdesc, mAnim, mIdx = build_master(acc, master_tok)
        print(f"master {acc:11s} <- {mAnim} f{mIdx}  anchor(y={mdesc[0]}, x={mdesc[1]:.1f})  px={(master[:, :, 3] > 0).sum()}")
        for anim, tokens in ANIM_FILES.items():
            if ONLY and anim not in ONLY:
                continue
            if acc != CANON[tokens[0]] and any(CANON[k] == acc for k in tokens):
                pass
            if not any(CANON[k] == acc for k in tokens):
                continue
            if anim in ("hurt", "attack"):
                continue  # written in the exact pass below
            base = load_base(anim)
            n = base.shape[1] // T
            strip = np.zeros((T, T * n, 4), dtype=np.uint8)
            areas = []
            for i in range(n):
                t, cx = head_desc(base[:, i*T:(i+1)*T])
                dx = int(round(cx - mdesc[1]))
                dy = t - mdesc[0]
                f = translate(master, dx, dy)
                strip[:, i*T:(i+1)*T] = f
                areas.append(int((f[:, :, 3] > 0).sum()))
            if DRY:
                print(f"  {anim}_{acc:11s} frames={n} areaPix min={min(areas)} max={max(areas)}")
            else:
                Image.fromarray(strip).save(os.path.join(OUT, f"overlay_{acc}_{anim}.png"))
    # exact per-frame overlays for attack/hurt
    for anim in EXACT_ANIMS:
        base = load_base(anim)
        n = base.shape[1] // T
        for tok in ANIM_FILES[anim]:
            acc = CANON[tok]
            frames = aligned_frames(anim, tok)
            strip = np.zeros((T, T * n, 4), dtype=np.uint8)
            bad = 0
            for i in range(min(n, len(frames))):
                bf = base[:, i*T:(i+1)*T]
                m = exact_mask(frames[i], bf)
                ov = overlay_from(frames[i], m)
                strip[:, i*T:(i+1)*T] = ov
                # fidelity vs source (accessory-relevant pixels only)
                src = frames[i][:, :, 3] > 0
                diff = np.abs(frames[i].astype(int) - bf.astype(int)).sum(axis=2) > 45
                ref = (src & ~(bf[:, :, 3] > 0)) | diff
                bad += int(((ov[:, :, 3] > 0) ^ ref).sum())
            if DRY:
                print(f"exact {anim}_{acc:11s} mismatch={bad}px overlayPx={(strip[:, :, 3] > 0).sum()}")
            else:
                Image.fromarray(strip).save(os.path.join(OUT, f"overlay_{acc}_{anim}.png"))
    print("done ->", OUT if not DRY else "(dry run)")


if __name__ == "__main__":
    main()
