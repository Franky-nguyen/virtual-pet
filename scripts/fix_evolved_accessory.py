#!/usr/bin/env python3
"""
Fix broken evolved accessory sheets.

Diagnosis (verified against pixel data):
  - evolved_idle_{acc}.png sheets are internally stable (dog + accessory stay
    locked, chest drift <= ~3px worst case) - they are clean source art.
  - evolved_walk_{acc}.png sheets are catastrophically misregistered: middle
    frames lurch 8-12px sideways and are inflated beyond the 64px tile, which
    makes walking with an accessory look "jittery / wobbly / strange".
  - Base evolved idle/walk art drifts <= ~1.1px, which is the bar we match.

Fix:
  1. Back up every evolved accessory sheet (and the untouched base sheets) to
     _backup_evo/.
  2. Re-align every accessory idle frame horizontally so the dog's chest is
     centred at x=32 (same as the base sheets), removing the residual sway.
  3. Re-bake each evolved_walk_{acc}.png from that stabilised accessory idle
     cycle (8-frame strip), giving a rock-solid walk identical in character to
     the base evolved walk (which itself is a near-static weight shift).
"""
from pathlib import Path
import shutil
import numpy as np
from PIL import Image

EVO = Path("src/assets/pets/evolved")
BAK = Path("_backup_evo")
ACC = ["bowtie", "crown", "partyhat", "sunglasses", "wizardhat"]
T = 64
WALK_ORDER = [0, 1, 2, 3, 4, 5, 0, 1]  # 8-frame loop from a 6-frame idle cycle

# ── 1. Backup everything in the evolved folder ────────────────────────────────
BAK.mkdir(exist_ok=True)
for p in sorted(EVO.glob("evolved_*.png")):
    dst = BAK / p.name
    if not dst.exists():  # don't clobber an earlier backup
        shutil.copy2(p, dst)
print(f"backed up {len(list(BAK.glob('evolved_*.png')))} sheets to {BAK}")


def load_frames(path):
    a = np.array(Image.open(path).convert("RGBA"))
    n = a.shape[1] // T
    return a, [a[:, i * T:(i + 1) * T].copy() for i in range(n)]


def chest_center(tile):
    band = tile[30:50, :, 3] > 0
    _, xs = np.nonzero(band)
    return xs.mean() if len(xs) else 32.0


def shift_tile(tile, dx):
    """Horizontal integer shift; content moved right by dx (may be negative)."""
    if dx == 0:
        return tile.copy()
    out = np.zeros_like(tile)
    if dx > 0:
        out[:, dx:] = tile[:, :-dx]
    else:
        out[:, :dx] = tile[:, -dx:]
    return out


def save_strip(frames, path):
    strip = np.zeros((T, T * len(frames), 4), dtype=np.uint8)
    for i, f in enumerate(frames):
        strip[:, i * T:(i + 1) * T] = f
    Image.fromarray(strip).save(path)
    print(f"  wrote {path.name} ({len(frames)} x {T}px frames)")


# ── 2. Base idle chest centres (for reference / sanity) ──────────────────────
_, base_idle = load_frames(EVO / "evolved_idle.png")
print("base idle chest centres:", [f"{chest_center(f):.1f}" for f in base_idle])

for acc in ACC:
    idle_path = EVO / f"evolved_idle_{acc}.png"
    walk_path = EVO / f"evolved_walk_{acc}.png"
    print(f"\n=== {acc} ===")

    # 2a. Re-align accessory idle frames to chest centre x=32
    _, idle_frames = load_frames(idle_path)
    before = [f"{chest_center(f):.1f}" for f in idle_frames]
    aligned = []
    for f in idle_frames:
        s = round(32.0 - chest_center(f))
        aligned.append(shift_tile(f, s))
    after = [f"{chest_center(f):.1f}" for f in aligned]
    # never clip content out of the tile
    for f in aligned:
        _, xs = np.nonzero(f[:, :, 3] > 0)
        assert xs.min() >= 0 and xs.max() <= 63, "unexpected clip in idle frame"
    print(f"  idle centres: {before} -> {after}")
    save_strip(aligned, idle_path)

    # 2b. Re-bake walk sheet from the stabilised idle cycle
    walk_frames = [aligned[i] for i in WALK_ORDER]
    save_strip(walk_frames, walk_path)

print("\nDone. All accessory idle/walk sheets re-baked from stable accessory idle art.")
