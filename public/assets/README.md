# Sprite Assets Setup

> **IMPORTANT (2026-08):** Sprite sheets now live in **`src/assets/`** and are
> imported as Vite modules by `src/components/PetDisplay.tsx` (see
> `SPRITE_SHEETS`). Because every sheet here is under Vite's 4 KB inline limit,
> Vite embeds them directly into the bundle as data URLs — the sprites can no
> longer disappear due to dev-server caching, zombie processes, or app
> restarts. When you add or replace a sheet, **put the file in `src/assets/`**
> and add the matching `import` + entry in `SPRITE_SHEETS`. Files placed in
> `public/` are **not** used by the app anymore.

## Required Files

Place the following sprite sheets in `src/assets/`:

1. **Idle.png** - 4 frames (idle breathing animation)
2. **Attack.png** - 4 frames (attack/happy animation)
3. **Walk.png** - 6 frames (walking animation)
4. **Hurt.png** - 2 frames (hurt/slouching animation)
5. **Death.png** - 4 frames (death/away animation)

## Sprite Sheet Format

All sprite sheets must be horizontal strips with frames arranged left-to-right:

```
[Frame 1][Frame 2][Frame 3][Frame 4]...
```

### Example Structure

For a sprite sheet with 4 frames at 64x64px per frame:
- **Total width**: 256px (64px × 4 frames)
- **Total height**: 64px
- Each frame is exactly 64px × 64px

### Recommended Specifications

- **Frame size**: 64×64 pixels
- **Format**: PNG with transparency
- **Style**: Pixel art (will be scaled with `image-rendering: pixelated`)
- **Background**: Transparent

## Animation Behavior

### Good Posture
When `postureStatus === 'good'`, the pet randomly cycles between:
- **Idle.png** (4 frames)
- **Walk.png** (6 frames)
- **Attack.png** (4 frames)

Changes animation every 4-8 seconds randomly.

### Slouching
When `postureStatus === 'slouching'`:
- Plays **Hurt.png** (2 frames)
- Adds red flash and shake effect
- Locked to this animation until posture improves

### Away / Calibrating
When `postureStatus === 'away'` or `'calibrating'`:
- Plays **Death.png** (4 frames)
- No special effects

## CSS Animation

The sprite system uses CSS custom properties for frame-accurate animation:

```css
.pixel-pet {
  width: 64px;
  height: 64px;
  background-size: calc(var(--frames) * 100%) 100%;
  animation: play-sprite calc(var(--frames) * 0.18s) steps(var(--frames)) infinite;
}
```

### Frame Count Configuration

Frame counts are configured in `src/components/PetDisplay.tsx`:

```typescript
const SPRITE_SHEETS = {
  Idle:   { path: '/assets/Idle.png',   frames: 4 },
  Attack: { path: '/assets/Attack.png', frames: 4 },
  Walk:   { path: '/assets/Walk.png',   frames: 6 },
  Hurt:   { path: '/assets/Hurt.png',   frames: 2 },
  Death:  { path: '/assets/Death.png',  frames: 4 },
}
```

To change frame counts, update the `frames` value in this config.

## Display Modes

### Dashboard Mode
- Sprite size: **64×64 pixels**
- Displayed with glow ring and background

### Taskbar Mode
- Sprite size: **80×80 pixels** (scaled up)
- No background, pure sprite on transparent window

## Creating Your Own Sprites

### Using Existing Assets

If you have sprite sheets with different frame counts:

1. Update the `frames` value in `SPRITE_SHEETS` config
2. Ensure frames are evenly spaced in the horizontal strip
3. Each frame must be exactly the same width

### Tools for Creating Sprites

- **Aseprite** - Professional pixel art tool
- **Piskel** - Free online pixel art editor
- **GraphicsGale** - Free pixel art animation tool

### Export Settings

When exporting from sprite animation tools:
- Format: **PNG**
- Layout: **Horizontal strip**
- Spacing: **None** (frames flush against each other)
- Background: **Transparent**

## Example Directory Structure

```
src/
└── assets/
    ├── Idle.png    (256×64, 4 frames)
    ├── Attack.png  (256×64, 4 frames)
    ├── Walk.png    (384×64, 6 frames)
    ├── Hurt.png    (128×64, 2 frames)
    └── Death.png   (256×64, 4 frames)
```

## Troubleshooting

### Sprite not animating
- Check that the file exists in `src/assets/`
- Verify frame count matches config
- Check browser console for loading errors

### Animation too fast/slow
Adjust the multiplier in `index.css`:

```css
/* Current: 0.18s per frame */
animation: play-sprite calc(var(--frames) * 0.18s) steps(var(--frames)) infinite;

/* Slower: 0.25s per frame */
animation: play-sprite calc(var(--frames) * 0.25s) steps(var(--frames)) infinite;

/* Faster: 0.12s per frame */
animation: play-sprite calc(var(--frames) * 0.12s) steps(var(--frames)) infinite;
```

### Sprite looks blurry
The CSS already includes `image-rendering: pixelated` to keep pixel art crisp. If it's still blurry:
- Check that your sprite sheet is exactly 64px height
- Ensure PNG export didn't apply smoothing

### Wrong frame displayed
- Verify sprite sheet has no extra whitespace
- Check that all frames are exactly the same width
- Use a sprite sheet validator tool

## Testing

1. Place all 5 sprite sheets in `src/assets/`
2. Start the app: `npm run electron:dev`
3. Test good posture: should cycle through Idle/Walk/Attack
4. Test slouching: should show Hurt with red flash
5. Cover webcam: should show Death animation

## Credits

Add your sprite artist credits here!
