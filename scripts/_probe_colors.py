#!/usr/bin/env python3
"""
Probe: how separable are accessory colours from the (bubbly) dog body colours?
Uses already-aligned native sheets in _cleaned_evo.
  * Ground-truth accessory pixels come from attack+hurt sheets (dog == base dog
    there, so any pixel differing from base is accessory).
  * Dog colours come from bubbly idle sheets' lower-body rows.
Reports, per accessory, what fraction of accessory pixels are within N of some
dog colour (colour-targeting risk).
"""
import os
import numpy as np
from PIL import Image

CLEAN = "_cleaned_evo"
EVO = "src/assets/pets/evolved"
ACCS = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]
T = 64


def arr(p):
    return np.array(Image.open(p).convert("RGBA")).astype(int)


def frame_colors(sheet, idx):
    a = arr(sheet)
    tile = a[:, idx*T:(idx+1)*T]
    m = tile[:, :, 3] > 0
    return tile[m][:, :3], m


def diff_mask(s_tile_rgb, s_mask, b_tile_rgb, b_mask, thr=45):
    """pixels that are accessory on exact-composite sheets (strong diff only)."""
    d = np.abs(s_tile_rgb.astype(int) - b_tile_rgb.astype(int)).sum(axis=2)
    acc = (s_mask & ~b_mask) | (s_mask & b_mask & (d > thr))
    return acc


for acc in ACCS:
    # ground-truth accessory colours from attack & hurt
    acc_cols = []
    dog_cols = []
    for anim in ["attack", "hurt"]:
        base = arr(f"{EVO}/evolved_{anim}.png")
        n = base.shape[1] // T
        sh = arr(f"{CLEAN}/evolved_{anim}_{acc}.png")
        for i in range(n):
            s_rgb, s_m = frame_colors(f"{CLEAN}/evolved_{anim}_{acc}.png", i)
            b = base[:, i*T:(i+1)*T]
            b_rgb = b[:, :, :3]; b_m = b[:, :, 3] > 0
            # rebuild s tile rgb array
            s_tile = sh[:, i*T:(i+1)*T]
            s_rgb2 = s_tile[:, :, :3]; s_m2 = s_tile[:, :, 3] > 0
            am = diff_mask(s_rgb2, s_m2, b_rgb, b_m)
            acc_cols.append(s_rgb2[am])
    acc_cols = np.concatenate(acc_cols) if acc_cols else np.zeros((0, 3))
    # bubbly dog colours: idle native sheet lower body rows 46..62
    dog_cols = []
    sh = arr(f"{CLEAN}/evolved_idle_{acc}.png")
    for i in range(6):
        t = sh[:, i*T:(i+1)*T]
        m = t[:, :, 3] > 0
        m[0:46, :] = False
        dog_cols.append(t[m][:, :3])
    dog_cols = np.concatenate(dog_cols)
    # nearest-dog distance for each accessory colour (subsample)
    idxs = np.random.default_rng(0).choice(len(acc_cols), min(4000, len(acc_cols)), replace=False)
    A = acc_cols[idxs].astype(int)
    D = dog_cols.astype(int)
    # chunked nearest search
    near = np.zeros(len(A))
    for c0 in range(0, len(A), 512):
        chunk = A[c0:c0+512]
        d = np.abs(chunk[:, None, :] - D[None, :, :]).sum(axis=2)  # (chunk, D)
        near[c0:c0+512] = d.min(axis=1)
    print(f"{acc:12s} accPix={len(acc_cols):5d} dogPix={len(dog_cols):5d} "
          f"acc2dog<=30: {100*(near<=30).mean():.0f}%  <=50: {100*(near<=50).mean():.0f}%  "
          f"<=80: {100*(near<=80).mean():.0f}%  med={np.median(near):.0f}")
