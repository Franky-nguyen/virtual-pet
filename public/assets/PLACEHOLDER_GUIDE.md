# Sprite Placeholder Generator

## Quick Setup for Testing

If you don't have sprite sheets yet, you can create simple colored placeholders for testing:

### Option 1: Use Emoji as Placeholders (Temporary)

While the sprite system expects PNG files, you can temporarily modify the component to use emoji for testing:

```tsx
// In PetDisplay.tsx, temporarily replace the sprite div:
<div style={{ fontSize: '64px', lineHeight: 1 }}>
  {currentAnimation === 'Idle' && '🦊'}
  {currentAnimation === 'Walk' && '🚶'}
  {currentAnimation === 'Attack' && '⚔️'}
  {currentAnimation === 'Hurt' && '😰'}
  {currentAnimation === 'Death' && '💀'}
</div>
```

### Option 2: Download Free Pixel Art Sprites

**Recommended free sources:**

1. **itch.io**
   - https://itch.io/game-assets/free/tag-sprites
   - Many free CC0 / CC-BY pixel art sprites

2. **OpenGameArt.org**
   - https://opengameart.org/
   - Search "sprite sheet" filter by CC0

3. **Kenney.nl**
   - https://kenney.nl/assets
   - High-quality free game assets

### Option 3: Create Simple Colored Rectangles

Use any image editor to create test sprites:

1. Create a new image **256×64** pixels
2. Fill with 4 colored squares (64×64 each)
3. Save as PNG with transparency
4. Repeat for each animation type

### Option 4: Use This Python Script

Save as `generate_placeholders.py` and run:

```python
from PIL import Image, ImageDraw

def create_sprite_sheet(name, frames, color):
    """Create a simple colored sprite sheet for testing"""
    frame_width = 64
    frame_height = 64
    total_width = frame_width * frames
    
    img = Image.new('RGBA', (total_width, frame_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    for i in range(frames):
        x = i * frame_width
        # Draw a colored rectangle with slight variation per frame
        brightness = 255 - (i * 20)
        frame_color = (color[0], color[1], color[2], brightness)
        draw.rectangle([x, 0, x + frame_width, frame_height], fill=frame_color)
        # Draw frame number
        draw.text((x + 10, 10), f"F{i+1}", fill=(255, 255, 255, 255))
    
    img.save(f'src/assets/{name}.png')
    print(f"Created {name}.png ({frames} frames)")

# Generate all required sprites
create_sprite_sheet('Idle', 4, (100, 200, 100))    # Green
create_sprite_sheet('Attack', 4, (255, 100, 100))  # Red
create_sprite_sheet('Walk', 6, (100, 100, 255))    # Blue
create_sprite_sheet('Hurt', 2, (200, 50, 50))      # Dark red
create_sprite_sheet('Death', 4, (100, 100, 100))   # Gray

print("All placeholder sprites created!")
```

Run with: `python generate_placeholders.py`

Requires: `pip install Pillow`

## Expected Behavior Once Sprites Are Added

1. **Good Posture**:
   - Pet cycles between Idle, Walk, and Attack animations
   - Changes every 4-8 seconds randomly
   - Smooth looping animation

2. **Slouching**:
   - Switches to Hurt animation (2 frames)
   - Red flash overlay appears
   - Shaking effect active

3. **Away/Calibrating**:
   - Plays Death animation (4 frames)
   - No special effects

4. **Taskbar Mode**:
   - Sprite scales to 80×80 pixels
   - Maintains all animation behaviors
   - No background elements

## Verifying Animation Works

Open browser console (F12) and run:

```javascript
// Check if sprite is loading
const pet = document.querySelector('.pixel-pet')
console.log('Background image:', getComputedStyle(pet).backgroundImage)
console.log('Frame count:', getComputedStyle(pet).getPropertyValue('--frames'))

// Check animation
console.log('Animation:', getComputedStyle(pet).animation)
```

## Next Steps

1. ✅ Place sprite sheets in `src/assets/`
2. ✅ Verify all 5 files exist (Idle, Attack, Walk, Hurt, Death)
3. ✅ Start app: `npm run electron:dev`
4. ✅ Test posture changes to see different animations
5. ✅ Toggle between dashboard and taskbar modes
6. ✅ Verify animations continue in both modes

## Need Help?

See the main `README.md` in this directory for:
- Sprite format requirements
- Frame count configuration
- Animation timing adjustments
- Troubleshooting guide
