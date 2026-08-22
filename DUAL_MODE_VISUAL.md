# PosturePet - Dual Mode Visual Reference

## Dashboard Mode (380x650px)

```
┌────────────────────────────────────┐
│ PosturePet            🔽 ✕         │ ← Header (draggable)
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐ │
│  │ 🎯 Work Time          45m    │ │
│  │                              │ │
│  │        45:00                 │ │ ← Pomodoro Timer
│  │   ▓▓▓▓▓░░░░░░░░░░░          │ │
│  │                              │ │
│  │   [Start]    [Reset]         │ │
│  └──────────────────────────────┘ │
│                                    │
│  ┌──────────────────────────────┐ │
│  │ [L3] XP ▓▓▓▓░░░░ 45/100     │ │ ← XP Bar & Level
│  │                              │ │
│  │         ╭───────╮            │ │
│  │         │  🦊  │            │ │ ← Pet Display
│  │         ╰───────╯            │ │
│  │                              │ │
│  │   [🎯 Calibrate Posture]    │ │ ← Calibrate Button
│  │                              │ │
│  │   Great posture! Keep it up! │ │
│  │   [GOOD]                     │ │
│  └──────────────────────────────┘ │
│                                    │
└────────────────────────────────────┘
```

**Features:**
- Full UI with all controls
- Gradient background (purple → pink)
- Rounded corners
- Centered on screen
- 🔽 button minimizes to taskbar

---

## Taskbar Mode (150x150px)

```
  ┌──────────────┐
  │          🔼  │ ← Expand button
  │              │
  │              │
  │              │
  │      🦊      │ ← Large Pet Only
  │              │
  │              │
  │              │
  └──────────────┘
```

**Features:**
- Minimal widget
- Transparent background
- Large animated pet (7xl)
- Glowing ring around pet
- Bottom-right corner (16px padding)
- 🔼 button expands to dashboard
- Entire widget draggable

---

## Mode Switching Flow

```
┌──────────────┐                      ┌──────────────┐
│              │                      │              │
│  Dashboard   │  ──── 🔽 ────▶     │   Taskbar    │
│              │                      │              │
│  (Centered)  │  ◀──── 🔼 ────     │ (Bottom-Right)│
│              │                      │              │
└──────────────┘                      └──────────────┘
```

---

## Pet States in Both Modes

| Status      | Emoji | Animation         | Visible In       |
|-------------|-------|-------------------|------------------|
| good        | 🦊    | Bouncing         | Dashboard + Taskbar |
| slouching   | 😰    | Shaking          | Dashboard + Taskbar |
| away        | 😴    | Sleeping + Zzz   | Dashboard + Taskbar |
| calibrating | 🧘    | Rotating         | Dashboard + Taskbar |
| calibrated  | ✅    | Bounce (3x)      | Dashboard + Taskbar |
| unknown     | 🦊    | Idle breathing   | Dashboard + Taskbar |

---

## Hidden Elements in Taskbar Mode

❌ **Not shown:**
- Pomodoro timer
- XP bar
- Level badge
- Calibrate button
- Status text
- Status badge
- Close button
- Background gradient

✅ **Still working:**
- Posture detection
- XP gain/loss (in background)
- Level-up system
- WebSocket connection
- Animation system

---

## Window Properties

### Common (Both Modes)
- `frame: false` - No title bar
- `transparent: true` - See-through
- `alwaysOnTop: true` - Stays on top
- `skipTaskbar: true` - No taskbar entry
- `hasShadow: false` - No drop shadow
- `resizable: false` - Fixed size

### Mode-Specific

**Dashboard:**
```typescript
width: 380
height: 650
x: (screen.width - 380) / 2
y: (screen.height - 650) / 2
```

**Taskbar:**
```typescript
width: 150
height: 150
x: screen.workArea.width - 150 - 16
y: screen.workArea.height - 150 - 16
```

---

## CSS Implementation

### Dashboard Container
```tsx
<div className="w-[380px] h-[650px] 
                bg-gradient-to-br from-purple-500/90 to-pink-500/90 
                backdrop-blur-md rounded-3xl shadow-2xl"
     style={{ WebkitAppRegion: 'drag' }}>
```

### Taskbar Container
```tsx
<div className="w-[150px] h-[150px] flex items-center justify-center"
     style={{ WebkitAppRegion: 'drag' }}>
  {/* Transparent background, just the pet */}
```

### Pet in Dashboard (Normal)
```tsx
<span className="text-5xl" style={{ animation: cfg.animation }}>
  {cfg.emoji}
</span>
```

### Pet in Taskbar (Larger)
```tsx
<span className="text-7xl" style={{ animation: cfg.animation }}>
  {cfg.emoji}
</span>
```

---

## User Experience Flow

1. **App Startup** → Dashboard mode (centered)
2. **User clicks 🔽** → Smooth transition to taskbar (bottom-right)
3. **Pet continues animating** → Posture detection active
4. **XP bar hidden** → But still gaining/losing XP
5. **User clicks 🔼** → Returns to dashboard (centered)
6. **All UI visible again** → Can see accumulated XP changes

---

## Future Enhancements

Possible additions:
- [ ] Fade animation between mode switches
- [ ] Settings to change taskbar position (corners)
- [ ] Persist mode preference in localStorage
- [ ] Tray icon with mode toggle
- [ ] Keyboard shortcut to toggle mode
- [ ] Option for auto-minimize after X minutes idle
- [ ] Different pet sizes in taskbar (S/M/L)
