# PosturePet - Quick Reference Card

## 🚀 Start Commands

### Windows
```bash
start.bat
```

### Mac/Linux
```bash
./start.sh
```

### Manual (2 terminals)
```bash
# Terminal 1
python detector.py

# Terminal 2
npm run electron:dev
```

## 📊 Status Guide

| Emoji | Status | Meaning |
|-------|--------|---------|
| 🦊 | good | Perfect posture! |
| 😰 | slouching | Sit up straight! |
| 👀 | away | No one detected |
| 😴 | resting | Break time |

## 🔧 Quick Fixes

### Camera not working
```python
# detector.py line ~63
cap = cv2.VideoCapture(0)  # Try 1, 2, etc.
```

### Too sensitive
```python
# detector.py lines ~40-43
if vertical_distance > -0.20:  # Less strict
if abs(forward_distance) > 0.12:
```

### Timer too long
```typescript
// src/components/PomodoroTimer.tsx line ~8-9
const WORK_DURATION = 25 * 60  // 25 min
const REST_DURATION = 5 * 60
```

## 📁 Key Files

- `detector.py` - Posture detection logic
- `electron/main.ts` - Window + WebSocket
- `src/App.tsx` - Main React component
- `src/components/PetDisplay.tsx` - Pet visuals

## 🐛 Debug

### Check Python server
```bash
python test_client.py
```

### Check Electron logs
Press `F12` in app → Console tab

### Check WebSocket
```bash
netstat -an | grep 8765
```

## 🎨 Customize

### Change pet emojis
`src/components/PetDisplay.tsx` line ~9-16

### Adjust sensitivity
`detector.py` lines ~40-43

### Modify window size
`electron/main.ts` line ~11-12

## 📦 Dependencies

### Python
- opencv-python
- mediapipe
- websockets

### Node
- electron
- react
- vite
- tailwindcss
- ws

## 🔗 WebSocket Protocol

**URL:** `ws://localhost:8765`

**Message format:**
```json
{
  "status": "good|slouching|away",
  "timestamp": 1692634567.89
}
```

## ⚡ Performance

- **Python**: ~5-10% CPU, 150-200 MB RAM
- **Electron**: ~1-2% CPU, 100-150 MB RAM
- **Camera**: 5-10 FPS processing
- **Latency**: <200ms status updates

## 📖 Full Documentation

- `README.md` - Overview
- `SETUP.md` - Detailed setup guide
- `ARCHITECTURE_COMPLETE.md` - Technical details
