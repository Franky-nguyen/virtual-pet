# Dual-Mode UI Implementation

PosturePet now supports two display modes: **Dashboard** and **Taskbar Widget**.

## Features

### Dashboard Mode (Default)
- **Size**: 380x650px
- **Position**: Centered on screen
- **Shows**:
  - Full Pomodoro timer
  - XP bar and level badge
  - Pet with animations
  - Calibrate posture button
  - Status text and badge
  - Minimize to taskbar button (🔽)
  - Close button (✕)

### Taskbar Mode (Minimized)
- **Size**: 150x150px
- **Position**: Bottom-right corner (16px padding)
- **Shows**:
  - Large animated pet emoji only
  - Expand button (🔼)
- **Hidden**:
  - Timer
  - XP bar
  - Calibrate button
  - Status text

## User Interaction

### Switch to Taskbar Mode
Click the **🔽** button in the header

### Expand to Dashboard
Click the **🔼** button in the top-right corner of the taskbar widget

## Implementation Details

### Files Modified

1. **electron/preload.ts**
   - Added `setMode()` IPC method to `electronAPI`

2. **electron/main.ts**
   - Imported `ipcMain` and `screen`
   - Added `set-mode` IPC listener
   - Window starts at 380x650 (dashboard), centered
   - Configured: `transparent: true`, `frame: false`, `hasShadow: false`, `skipTaskbar: true`

3. **src/index.css**
   - Added `html, body, #root { background: transparent !important; }`
   - Ensures transparent background for both modes

4. **src/types/electron.d.ts**
   - Added `setMode: (mode: 'dashboard' | 'taskbar') => void` to `ElectronAPI`

5. **src/App.tsx**
   - Added `mode` state: `'dashboard' | 'taskbar'`
   - Added `toggleMode()` function that updates state AND calls `window.electronAPI.setMode()`
   - Conditional rendering based on mode
   - Dashboard: full UI with gradient background, rounded corners
   - Taskbar: minimal transparent container with pet + expand button

6. **src/components/PetDisplay.tsx**
   - Added `mode` prop
   - Taskbar mode: renders only large pet emoji (7xl, 32x32 glow ring)
   - Dashboard mode: full UI with XP bar, calibrate button, status text

## Window Positioning Logic

### Dashboard Mode
```typescript
mainWindow.setSize(380, 650)
mainWindow.center()
```

### Taskbar Mode
```typescript
const { width, height } = screen.getPrimaryDisplay().workArea
mainWindow.setSize(150, 150)
mainWindow.setPosition(width - 150 - 16, height - 150 - 16)
```

## Dragging Behavior

Both modes support window dragging:
- **Dashboard**: Entire window is draggable (header + content area)
- **Taskbar**: Entire widget is draggable
- Buttons have `WebkitAppRegion: 'no-drag'` to remain clickable

## State Persistence

Mode preference is **session-only** - restarting the app returns to dashboard mode. To persist preference:

1. Add to `localStorage`:
```typescript
localStorage.setItem('posturePetMode', mode)
```

2. Load on mount:
```typescript
const savedMode = localStorage.getItem('posturePetMode') as 'dashboard' | 'taskbar' | null
const [mode, setMode] = useState(savedMode || 'dashboard')
```

## Visual Design

### Dashboard
- Purple-to-pink gradient background (90% opacity)
- Rounded 3xl corners
- White/10 header bar
- Shadow-2xl

### Taskbar
- Fully transparent background
- Pet with larger glow ring (ring-4 instead of ring-2)
- Larger emoji (text-7xl instead of text-5xl)
- Small expand button in corner

## Testing

```bash
npm run electron:dev
```

1. App launches in dashboard mode (centered)
2. Click 🔽 → switches to taskbar mode (bottom-right corner)
3. Click 🔼 → expands back to dashboard (centered)
4. All posture detection continues working in both modes
5. XP/level system active in both modes (hidden in taskbar)

## Known Behaviors

- Window is `skipTaskbar: true` in both modes (doesn't appear in taskbar/dock)
- Always-on-top in both modes
- Transparent window requires compositing (Windows 10+, macOS 10.10+, Linux with compositor)
- Multi-monitor: taskbar positioning uses primary display work area
