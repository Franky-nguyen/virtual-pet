# PosturePet - Setup & Run Guide

## Prerequisites

- **Node.js** (v18+)
- **Python** (3.8+)
- **Webcam** (built-in or USB)

## First-Time Setup

### 1. Install Node Dependencies
```bash
npm install
```

### 2. Create Python Virtual Environment
```bash
python -m venv venv
```

### 3. Activate Virtual Environment

**Windows:**
```bash
venv\Scripts\activate
```

**Mac/Linux:**
```bash
source venv/bin/activate
```

### 4. Install Python Dependencies
```bash
pip install -r requirements.txt
```

## Running PosturePet

### Quick Start (Automated)

**Windows:**
```bash
start.bat
```

**Mac/Linux:**
```bash
./start.sh
```

### Manual Start (Two Terminals)

**Terminal 1 - Python Posture Server:**
```bash
# Activate venv first
source venv/bin/activate  # Windows: venv\Scripts\activate

# Run detector
python detector.py
```

You should see:
```
PosturePet Detector Starting...
WebSocket server: ws://localhost:8765
Starting posture detection...
Camera initialized. Processing at ~10 FPS
```

**Terminal 2 - Electron App:**
```bash
npm run electron:dev
```

## Testing the System

### Test Python Server Only
```bash
# Terminal 1: Run detector
python detector.py

# Terminal 2: Run test client
python test_client.py
```

The test client will show real-time posture updates:
```
✅ Status: GOOD (timestamp: 1234567.89)
⚠️ Status: SLOUCHING (timestamp: 1234568.12)
👀 Status: AWAY (timestamp: 1234569.34)
```

### Development Mode Features
- **Hot Reload** - Changes to React components update instantly
- **DevTools** - Electron opens with Chrome DevTools for debugging
- **Auto-reconnect** - If Python server restarts, Electron reconnects in 5s

## Posture Status Reference

| Status | Meaning | Pet Emoji | Action |
|--------|---------|-----------|--------|
| `good` | Healthy posture | 🦊 | Keep it up! |
| `slouching` | Forward head detected | 😰 | Sit up straight! |
| `away` | No person detected | 👀 | Where are you? |

## Camera Troubleshooting

**Camera not detected:**
1. Check system camera permissions
2. Close other apps using the camera
3. Try different camera indices in `detector.py`:
   ```python
   cap = cv2.VideoCapture(0)  # Try 1, 2, etc.
   ```

**Low FPS / Lag:**
- Reduce frame rate in `detector.py`:
  ```python
  frame_delay = 0.2  # Was 0.1 (10 FPS → 5 FPS)
  ```
- Use lighter model (already using `model_complexity=0`)

## WebSocket Troubleshooting

**Connection refused:**
- Ensure Python server started successfully
- Check port 8765 is not in use: `netstat -an | grep 8765`

**Connection keeps dropping:**
- Check firewall settings
- Ensure Python script isn't crashing (check Terminal 1)

## Customization Guide

### Adjust Posture Detection Sensitivity

Edit `detector.py`:
```python
# More strict (detects slouching earlier)
if vertical_distance > -0.10:  # Was -0.15
if abs(forward_distance) > 0.05:  # Was 0.08

# More lenient (fewer false positives)
if vertical_distance > -0.20:
if abs(forward_distance) > 0.12:
```

### Change Timer Durations

Edit `src/components/PomodoroTimer.tsx`:
```typescript
const WORK_DURATION = 25 * 60  // 25 minutes (Pomodoro standard)
const REST_DURATION = 5 * 60   // 5 minutes
```

### Customize Pet Appearance

Edit `src/components/PetDisplay.tsx`:
```typescript
const getPetEmoji = (isWorkPhase: boolean, postureStatus: PostureData['status']) => {
  if (!isWorkPhase) return '💤'  // Change sleep emoji
  
  switch (postureStatus) {
    case 'good': return '🐱'      // Change happy emoji
    case 'slouching': return '😿' // Change warning emoji
    case 'away': return '🔍'      // Change searching emoji
  }
}
```

## Building for Production

### Build Electron App
```bash
npm run electron:build
```

This creates distributable packages in `release/` folder.

### Package with Python
For true standalone distribution, you'll need to:
1. Use PyInstaller to bundle `detector.py`
2. Include in Electron build
3. Launch Python subprocess from Electron

(Advanced - not covered in Phase 2)

## Performance Tips

- **CPU Usage**: ~5-10% with 10 FPS processing
- **Memory**: ~200-300 MB total
- **Camera**: 640x480 default resolution (adjustable)

## Next Steps

- Add sound alerts for slouching
- Implement pet animation states
- Add statistics tracking
- Create calibration mode for personalized thresholds
- Add multiple pet skins
