# 🔄 Dual-Mode Quick Reference

## Toggle Buttons

| Mode | Button | Action |
|------|--------|--------|
| Dashboard | 🔽 | Minimize to taskbar |
| Taskbar | 🔼 | Expand to dashboard |

## Mode Comparison

| Feature | Dashboard | Taskbar |
|---------|-----------|---------|
| Size | 380×650 | 150×150 |
| Position | Center | Bottom-right |
| Background | Gradient | Transparent |
| Timer | ✅ Visible | ❌ Hidden |
| XP Bar | ✅ Visible | ❌ Hidden |
| Pet | Normal (5xl) | Large (7xl) |
| Calibrate | ✅ Button | ❌ Hidden |
| Status Text | ✅ Visible | ❌ Hidden |
| Draggable | ✅ Yes | ✅ Yes |

## Keyboard Shortcuts

*(Not implemented yet, but planned)*

- `Ctrl+M` - Toggle mode
- `Ctrl+D` - Switch to dashboard
- `Ctrl+T` - Switch to taskbar

## Code Snippets

### Call from React
```typescript
window.electronAPI.setMode('taskbar')
window.electronAPI.setMode('dashboard')
```

### Add Persistence
```typescript
// Save preference
localStorage.setItem('posturePetMode', mode)

// Load on startup
const savedMode = localStorage.getItem('posturePetMode') || 'dashboard'
```

### Change Taskbar Position
```typescript
// Bottom-right (default)
x: width - 150 - 16
y: height - 150 - 16

// Bottom-left
x: 16
y: height - 150 - 16

// Top-right
x: width - 150 - 16
y: 16

// Top-left
x: 16
y: 16
```

## Common Questions

**Q: Does XP still accumulate in taskbar mode?**  
A: Yes! All systems run in background.

**Q: Can I change taskbar position?**  
A: Not yet, but planned feature.

**Q: Is mode saved between restarts?**  
A: No, resets to dashboard. Persistence planned.

**Q: Does calibration work in taskbar?**  
A: No button visible. Switch to dashboard to calibrate.

**Q: What happens during mode switch?**  
A: Window resizes/repositions instantly. No data loss.

## File Locations

| Component | File |
|-----------|------|
| IPC Listener | `electron/main.ts` line ~87 |
| IPC Sender | `electron/preload.ts` line ~15 |
| Mode State | `src/App.tsx` line ~37 |
| Toggle Function | `src/App.tsx` line ~95 |
| Conditional Render | `src/App.tsx` line ~130 |
| Pet Mode Logic | `src/components/PetDisplay.tsx` line ~192 |

## Window Sizes

```
Dashboard: 380px × 650px (centered)
Taskbar:   150px × 150px (bottom-right + 16px padding)
```

## Default Behavior

- ✅ Starts in dashboard mode
- ✅ Centered on startup
- ✅ Posture detection active
- ✅ Always on top
- ✅ No taskbar entry

## Testing

```bash
# Start app
npm run electron:dev

# Test sequence
1. Verify dashboard (380×650, centered)
2. Click 🔽
3. Verify taskbar (150×150, bottom-right)
4. Click 🔼
5. Verify dashboard (centered again)
```

## Documentation

- `DUAL_MODE_UI.md` - Implementation details
- `DUAL_MODE_VISUAL.md` - Visual diagrams
- `DUAL_MODE_COMPLETE.md` - Full summary
- `TESTING_DUAL_MODE.md` - Test checklist

---

**Status**: ✅ Production Ready
