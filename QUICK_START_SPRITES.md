# 🚀 Quick Start - Sprite System

## What You Need

1. **5 sprite sheets** in `src/assets/`:
   - `Idle.png` (4 frames, 256×64)
   - `Attack.png` (4 frames, 256×64)
   - `Walk.png` (6 frames, 384×64)
   - `Hurt.png` (2 frames, 128×64)
   - `Death.png` (4 frames, 256×64)

2. **Format**: PNG, horizontal strips, 64px height

## Testing Without Sprites

### Option A: Create Placeholders

Run this Python script in project root:

```python
from PIL import Image, ImageDraw, ImageFont

def create_placeholder(name, frames, color):
    img = Image.new('RGBA', (frames * 64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for i in range(frames):
        x = i * 64
        draw.rectangle([x, 0, x + 64, 64], fill=color)
        draw.text((x + 20, 24), f"{name[0]}{i+1}", fill=(255, 255, 255))
    img.save(f'src/assets/{name}.png')
    print(f"✅ {name}.png")

create_placeholder('Idle', 4, (100, 200, 100))
create_placeholder('Attack', 4, (255, 100, 100))
create_placeholder('Walk', 6, (100, 100, 255))
create_placeholder('Hurt', 2, (200, 50, 50))
create_placeholder('Death', 4, (100, 100, 100))
print("Done! Start the app.")
```

Requires: `pip install Pillow`

### Option B: Download Free Sprites

**Recommended sources:**
- itch.io: https://itch.io/game-assets/free/tag-sprites
- OpenGameArt: https://opengameart.org/
- Kenney: https://kenney.nl/assets

**What to look for:**
- Pixel art style
- Character sprites
- Horizontal strip layout
- Multiple animations

## Run the App

```bash
# Terminal 1: Python detector
python detector.py

# Terminal 2: Electron app
npm run electron:dev
```

## What to Expect

### Dashboard Mode (Default)
- Window: 380×620, centered
- Shows: Timer, XP bar, sprite with glow ring, calibrate button
- Sprite: 64×64 pixels

### Taskbar Mode (Click 🔽)
- Window: 100×100, bottom-right corner
- Shows: Only sprite (80×80) + tiny expand button
- 100% transparent background
- Always-on-top with screen-saver priority

### Animation Behavior

**Good Posture:**
- Cycles randomly between: Idle → Walk → Attack
- Changes every 4-8 seconds
- Smooth looping

**Slouching:**
- Switches to Hurt (2 frames)
- Red flash effect
- Shake animation
- Locked until posture improves

**Away/Calibrating:**
- Switches to Death (4 frames)
- No special effects
- Locked until user returns

## Verify It Works

### 1. Check Files Loaded
Open DevTools (F12), Console tab:
```javascript
document.querySelector('.pixel-pet').style.backgroundImage
// Should show: url("/assets/Idle.png") or similar
```

### 2. Test Posture Changes
- Sit up straight → See Idle/Walk/Attack cycling
- Slouch → See Hurt with red flash
- Cover webcam → See Death animation

### 3. Test Mode Switching
- Click 🔽 → Window shrinks to 100×100, moves bottom-right
- Sprite continues animating
- Click 🔼 → Returns to dashboard

### 4. Test Random Timer
With good posture:
- Wait 4-8 seconds
- Animation should change
- Note which animation appears
- Wait another 4-8 seconds
- Should change to different animation

## Troubleshooting

### "Sprites not showing"
```bash
# Check files exist
ls src/assets/*.png

# Should see:
# Idle.png, Attack.png, Walk.png, Hurt.png, Death.png
```

### "Animation not looping"
- Check sprite sheet is horizontal strip (not vertical)
- Verify each frame is exactly 64×64
- Check PNG has no extra padding

### "Window not snapping"
- Windows: Check you're not in fullscreen mode
- Mac: Check System Preferences → Mission Control → Displays
- Linux: Check window manager settings

### "Random cycling not working"
- Check posture status is 'good' (not 'unknown')
- Wait at least 4 seconds
- Open console (F12) for any errors

## Next Steps

1. ✅ Place sprite sheets in `src/assets/`
2. ✅ Run app: `npm run electron:dev`
3. ✅ Test all posture states
4. ✅ Verify animations cycle
5. ✅ Test taskbar mode
6. ✅ Enjoy your animated pet!

## Need More Help?

See full documentation:
- `public/assets/README.md` - Sprite format details
- `SPRITE_ENGINE_COMPLETE.md` - Implementation overview
- `SPRITE_VISUAL.md` - Visual diagrams
- `TESTING_DUAL_MODE.md` - Complete test checklist

---

**Ready to code! 🎮**
