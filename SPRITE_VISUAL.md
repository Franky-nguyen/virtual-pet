# 🎮 Sprite Animation System - Visual Reference

## Animation Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Posture Detection (Python/WebSocket)                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ postureStatus Update │
        └──────────┬───────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌────────────┐
│  'good' │  │'slouching'│  │'away' etc. │
└────┬────┘  └─────┬────┘  └──────┬─────┘
     │             │               │
     ▼             ▼               ▼
┌─────────────┐ ┌──────┐    ┌────────┐
│Random Timer │ │ Hurt │    │ Death  │
│  4-8 sec    │ │LOCKED│    │ LOCKED │
└──────┬──────┘ └──┬───┘    └───┬────┘
       │           │             │
   ┌───┴───┬───┐   │             │
   ▼       ▼   ▼   ▼             ▼
┌──────┐┌────┐┌──────┐    ┌──────────┐
│ Idle ││Walk││Attack│    │2 frames  │
│4frms ││6frm││4frms │    │+ effects │
└──────┘└────┘└──────┘    └──────────┘
```

---

## Sprite Sheet Layout Examples

### Idle.png (4 frames)
```
┌────────┬────────┬────────┬────────┐
│Frame 1 │Frame 2 │Frame 3 │Frame 4 │
│  64px  │  64px  │  64px  │  64px  │
└────────┴────────┴────────┴────────┘
        Total: 256px × 64px
```

### Walk.png (6 frames)
```
┌────────┬────────┬────────┬────────┬────────┬────────┐
│Frame 1 │Frame 2 │Frame 3 │Frame 4 │Frame 5 │Frame 6 │
└────────┴────────┴────────┴────────┴────────┴────────┘
               Total: 384px × 64px
```

### Hurt.png (2 frames)
```
┌────────┬────────┐
│Frame 1 │Frame 2 │ + Red Flash + Shake
└────────┴────────┘
   Total: 128px × 64px
```

---

## Mode Comparison

### Dashboard Mode (380×620)
```
┌────────────────────────────────────┐
│ PosturePet            🔽 ✕         │
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐ │
│  │ ⏱️  Pomodoro Timer           │ │
│  │     45:00                    │ │
│  └──────────────────────────────┘ │
│                                    │
│  ┌──────────────────────────────┐ │
│  │ [L3] XP ▓▓▓▓░░░░ 45/100     │ │
│  │                              │ │
│  │       ╭─────────╮            │ │
│  │       │ [SPRITE]│            │ │ ← 64×64 sprite
│  │       │ 4 frames│            │ │   with glow ring
│  │       ╰─────────╯            │ │
│  │                              │ │
│  │  [🎯 Calibrate Posture]     │ │
│  │                              │ │
│  │  Great posture! Keep it up! │ │
│  │  [GOOD]                      │ │
│  └──────────────────────────────┘ │
└────────────────────────────────────┘
```

### Taskbar Mode (100×100)
```
┌──────────────┐
│          🔼  │ ← 6×6 expand button
│              │
│              │
│              │
│   [SPRITE]   │ ← 80×80 sprite
│   6 frames   │   NO background
│              │   100% transparent
│              │
└──────────────┘
```

---

## Animation States

### Good Posture (Random Cycling)
```
Time: 0s        4-8s         8-16s       12-24s
      ↓          ↓            ↓            ↓
    Idle  →   Walk   →   Attack   →    Idle ...
   [🦊]      [🚶]        [⚔️]         [🦊]
  4 frames   6 frames    4 frames     4 frames

Random interval between changes: 4000-8000ms
```

### Slouching (Locked)
```
Detect slouching
      ↓
  Switch to Hurt
      ↓
┌──────────────┐
│  [HURT]      │ ← Locked animation
│  2 frames    │   + Red flash
│  + Shake     │   + Shake effect
└──────────────┘
      ↓
Stays until posture improves
```

### Away/Calibrating (Locked)
```
Detect away OR start calibrating
      ↓
  Switch to Death
      ↓
┌──────────────┐
│  [DEATH]     │ ← Locked animation
│  4 frames    │   No effects
│              │
└──────────────┘
      ↓
Stays until user returns
```

---

## CSS Animation Mechanics

### Step Animation
```
Frame 1        Frame 2        Frame 3        Frame 4
  │              │              │              │
  ├──────────────┼──────────────┼──────────────┤
  0%            25%            50%            75%           100%
  │              │              │              │              │
background-position-x: 0% ──────────────────────────► 100%

Duration: frames × 0.18s = 4 × 0.18s = 0.72s
Steps: 4 (discrete frame changes, no interpolation)
```

### Hurt Effect Layers
```
Layer 1: Sprite animation (2 frames)
         ┌──────┬──────┐
         │ F1   │ F2   │
         └──────┴──────┘

Layer 2: Shake (horizontal + rotation)
         ←──→  ↶↷

Layer 3: Red flash (brightness + hue shift)
         💥 Brightness: 1.0 → 1.5 → 1.0
         🎨 Hue: 0deg → -30deg → 0deg
```

---

## Window Snapping Positions

### Screen Layout
```
┌──────────────────────────────────────────────────┐
│ Screen (1920×1080)                               │
│                                                  │
│  ╭──────────────╮                                │
│  │  Dashboard   │  ← Centered                    │
│  │  380 × 620   │     x: (1920 - 380) / 2        │
│  │              │     y: (1080 - 620) / 2        │
│  ╰──────────────╯                                │
│                                                  │
│                                                  │
│                                         ╭──────╮ │
│                                         │ Task │ │
│                                         │ bar  │ │
│                                         │100×  │ │
│                                         │100   │ │
│                                         ╰──────╯ │
│                                         ↑ 16px   │
│                                   16px ←         │
└──────────────────────────────────────────────────┘
  workArea.width - 100 - 16, workArea.height - 100 - 16
```

### Always-On-Top Priority
```
Highest ┌──────────────────┐
        │  Lock Screen     │
        ├──────────────────┤
        │  Screen Saver ⬅──│ Taskbar Mode (level: 'screen-saver')
        ├──────────────────┤
        │  Always On Top   │
        ├──────────────────┤
        │  Normal Windows ⬅│ Dashboard Mode (alwaysOnTop: false)
Lowest  └──────────────────┘
```

---

## Posture → Animation Mapping

```
┌──────────────┬───────────────┬────────┬──────────────┐
│ Status       │ Animation     │ Frames │ Effects      │
├──────────────┼───────────────┼────────┼──────────────┤
│ good         │ Idle/Walk/    │ 4/6/4  │ None         │
│              │ Attack (rand) │        │              │
├──────────────┼───────────────┼────────┼──────────────┤
│ slouching    │ Hurt          │ 2      │ Flash+Shake  │
├──────────────┼───────────────┼────────┼──────────────┤
│ away         │ Death         │ 4      │ None         │
├──────────────┼───────────────┼────────┼──────────────┤
│ calibrating  │ Death         │ 4      │ None         │
├──────────────┼───────────────┼────────┼──────────────┤
│ unknown      │ Idle          │ 4      │ None         │
├──────────────┼───────────────┼────────┼──────────────┤
│ calibrated   │ Idle (brief)  │ 4      │ None         │
└──────────────┴───────────────┴────────┴──────────────┘
```

---

## Data Flow

```
detector.py
    │
    │ WebSocket
    ↓
electron/main.ts
    │
    │ IPC: 'posture-update'
    ↓
electron/preload.ts
    │
    │ window.electronAPI.onPostureUpdate()
    ↓
App.tsx
    │
    │ setPostureStatus()
    ↓
PetDisplay.tsx
    │
    ├──→ resolveDisplayStatus() → UI config
    │
    └──→ getAnimationForStatus() + Random Timer
             │
             ↓
         currentAnimation
             │
             ↓
    ┌────────┴─────────┐
    ↓                  ↓
SPRITE_SHEETS      CSS Variables
    │                  │
    ↓                  ↓
spriteSheet.path   --frames
    │                  │
    └────────┬─────────┘
             ↓
    <div className="pixel-pet"
         style={{
           backgroundImage: url(...),
           --frames: 4
         }} />
             │
             ↓
    CSS Animation System
             │
             ↓
    Rendered Sprite 🦊
```

---

## File Organization

```
PosturePet/
├── public/
│   └── assets/
│       ├── Idle.png        (256×64, 4 frames)
│       ├── Attack.png      (256×64, 4 frames)
│       ├── Walk.png        (384×64, 6 frames)
│       ├── Hurt.png        (128×64, 2 frames)
│       ├── Death.png       (256×64, 4 frames)
│       ├── README.md       (Setup guide)
│       └── PLACEHOLDER_GUIDE.md (Testing without sprites)
│
├── src/
│   ├── components/
│   │   └── PetDisplay.tsx  ← Sprite engine
│   ├── App.tsx             ← Mode management
│   └── index.css           ← Animation CSS
│
├── electron/
│   └── main.ts             ← Window snapping
│
└── docs/
    ├── SPRITE_ENGINE_COMPLETE.md  (This summary)
    └── SPRITE_VISUAL.md           (This file)
```

---

## Quick Reference

### Change Animation Speed
📁 `src/index.css` line 28
```css
calc(var(--frames) * 0.18s) ← Change 0.18 to 0.12 (faster) or 0.25 (slower)
```

### Change Random Interval
📁 `src/components/PetDisplay.tsx` line ~85
```typescript
const delay = 4000 + Math.random() * 4000 ← Change 4000 to adjust range
```

### Change Sprite Size
📁 `src/index.css` lines 21-22
```css
width: 64px;  ← Dashboard sprite size
height: 64px;
```

### Change Window Sizes
📁 `electron/main.ts` lines ~91, 97
```typescript
mainWindow.setSize(380, 620) ← Dashboard
mainWindow.setSize(100, 100) ← Taskbar
```

---

**Ready to animate! 🎮✨**
