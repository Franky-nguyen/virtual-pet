# PosturePet Architecture - Phase 1

## Window Configuration (electron/main.ts)
- **Frameless**: `frame: false` - No title bar or borders
- **Transparent**: `transparent: true` - See-through background
- **Always on top**: `alwaysOnTop: true` - Stays above other windows
- **Fixed size**: 350x500px, not resizable
- **Draggable**: Enabled via `-webkit-app-region: drag` in CSS

## Component Structure

### App.tsx
Main container managing global state:
- `isWorkPhase` - Tracks whether user is in work (45m) or rest (5m) phase
- Orchestrates communication between PomodoroTimer and PetDisplay

### PomodoroTimer.tsx
Timer component with:
- 45-minute work sessions
- 5-minute rest breaks
- Auto-switch between phases
- Visual progress bar
- Start/Pause/Reset controls

### PetDisplay.tsx
Pet visualization with:
- Placeholder animation (fox emoji during work, sleeping during rest)
- Posture status display (ready for WebSocket data)
- Responsive to timer phase

## Future Integration Points (Phase 2)

### electron/preload.ts
Already includes API scaffold:
```typescript
onPostureUpdate: (callback) => void
removePostureListener: () => void
```

### src/types/electron.d.ts
Type definitions ready for posture data:
```typescript
PostureData {
  status: 'good' | 'bad' | 'unknown'
  confidence: number
  timestamp: number
}
```

### Next Steps for WebSocket Integration:
1. Add WebSocket client in electron/main.ts
2. Connect to Python MediaPipe server
3. Pipe posture data through IPC to renderer
4. Update PetDisplay to react to real posture data
5. Add pet animations based on posture quality
