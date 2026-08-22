# PosturePet - Complete System Architecture

## Data Flow Diagram

```
┌─────────────────┐
│   Webcam Feed   │
└────────┬────────┘
         │ 5-10 FPS
         ▼
┌─────────────────────────────────┐
│   detector.py (Python)          │
│                                 │
│  ┌──────────────────────────┐  │
│  │  MediaPipe Pose          │  │
│  │  - Detect landmarks      │  │
│  │  - Nose position         │  │
│  │  - Shoulder positions    │  │
│  └────────┬─────────────────┘  │
│           │                     │
│  ┌────────▼─────────────────┐  │
│  │  Posture Algorithm       │  │
│  │  - Calculate alignment   │  │
│  │  - Classify status       │  │
│  └────────┬─────────────────┘  │
│           │                     │
│  ┌────────▼─────────────────┐  │
│  │  WebSocket Server        │  │
│  │  ws://localhost:8765     │  │
│  └────────┬─────────────────┘  │
└───────────┼─────────────────────┘
            │ JSON messages
            │ {"status": "good|slouching|away", "timestamp": ...}
            │
            ▼
┌─────────────────────────────────┐
│   electron/main.ts              │
│                                 │
│  ┌──────────────────────────┐  │
│  │  WebSocket Client        │  │
│  │  - Connect to Python     │  │
│  │  - Auto-reconnect        │  │
│  └────────┬─────────────────┘  │
│           │                     │
│  ┌────────▼─────────────────┐  │
│  │  IPC (Inter-Process)     │  │
│  │  - Send to renderer      │  │
│  └────────┬─────────────────┘  │
└───────────┼─────────────────────┘
            │ 'posture-update' event
            │
            ▼
┌─────────────────────────────────┐
│   electron/preload.ts           │
│   - Bridge IPC to window API    │
└────────┬────────────────────────┘
         │ window.electronAPI
         ▼
┌─────────────────────────────────┐
│   React App (Renderer)          │
│                                 │
│  ┌──────────────────────────┐  │
│  │  App.tsx                 │  │
│  │  - Listen for updates    │  │
│  │  - Update state          │  │
│  └────────┬─────────────────┘  │
│           │                     │
│  ┌────────▼─────────────────┐  │
│  │  PetDisplay.tsx          │  │
│  │  - Show pet emoji        │  │
│  │  - Display status badge  │  │
│  └──────────────────────────┘  │
│                                 │
│  ┌──────────────────────────┐  │
│  │  PomodoroTimer.tsx       │  │
│  │  - 45m work / 5m rest    │  │
│  └──────────────────────────┘  │
└─────────────────────────────────┘
```

## Component Responsibilities

### Python Layer (`detector.py`)
- **Input**: Webcam video stream
- **Processing**: 
  - MediaPipe Pose landmark detection
  - Nose-to-shoulder alignment calculation
  - Status classification (good/slouching/away)
- **Output**: WebSocket broadcast to localhost:8765

### Electron Main Process (`electron/main.ts`)
- **Responsibilities**:
  - Create frameless, transparent window
  - Connect WebSocket client to Python server
  - Forward posture data to renderer via IPC
  - Handle auto-reconnection

### Electron Preload (`electron/preload.ts`)
- **Responsibilities**:
  - Expose secure API to renderer
  - Bridge IPC ↔ Window API
  - Type-safe interface

### React App (`src/`)
- **App.tsx**: State management, WebSocket listener
- **PetDisplay.tsx**: Visual feedback (emoji, status badge)
- **PomodoroTimer.tsx**: Work/rest cycle management

## Security Architecture

```
┌──────────────────────────────────┐
│  Renderer Process (Untrusted)   │
│  - React app runs here           │
│  - No direct Node.js access      │
└────────┬─────────────────────────┘
         │
         │ window.electronAPI only
         │
┌────────▼─────────────────────────┐
│  Preload Script (Bridge)         │
│  - contextIsolation: true        │
│  - Expose minimal API            │
└────────┬─────────────────────────┘
         │
         │ IPC messages only
         │
┌────────▼─────────────────────────┐
│  Main Process (Trusted)          │
│  - Full Node.js access           │
│  - WebSocket client              │
│  - Window management             │
└──────────────────────────────────┘
```

**Key Security Features:**
- `nodeIntegration: false` - Renderer can't access Node.js
- `contextIsolation: true` - Separate JS contexts
- `preload` script - Only bridge for allowed APIs
- Local-only WebSocket - No external connections

## Posture Detection Algorithm

```python
def calculate_posture(landmarks):
    nose = landmarks[NOSE]
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]
    
    # Calculate reference point
    shoulder_mid_x = (left_shoulder.x + right_shoulder.x) / 2
    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2
    
    # Measure distances
    forward_distance = nose.x - shoulder_mid_x
    vertical_distance = nose.y - shoulder_mid_y
    
    # Classify
    if vertical_distance > -0.15:      # Nose too low
        return "slouching"
    if abs(forward_distance) > 0.08:   # Nose too far forward/back
        return "slouching"
    
    return "good"
```

**Coordinate System:**
- X-axis: 0 (left) → 1 (right)
- Y-axis: 0 (top) → 1 (bottom)
- Z-axis: Depth (not used in current algorithm)

**Thresholds Explained:**
- `vertical_distance > -0.15`: Nose should be at least 15% of frame height above shoulders
- `abs(forward_distance) > 0.08`: Nose should be within 8% horizontal tolerance from shoulder midpoint

## State Management

```typescript
// App.tsx - Central state
const [isWorkPhase, setIsWorkPhase] = useState(true)
const [postureStatus, setPostureStatus] = useState<'good'|'slouching'|'away'>('away')

// PomodoroTimer controls work/rest phase
onPhaseChange(isWork: boolean) → setIsWorkPhase(isWork)

// Electron IPC updates posture
onPostureUpdate(data) → setPostureStatus(data.status)

// Both states flow down to PetDisplay
<PetDisplay isWorkPhase={isWorkPhase} postureStatus={postureStatus} />
```

## Network Protocol

**WebSocket Messages (Python → Electron):**
```json
{
  "status": "good" | "slouching" | "away",
  "timestamp": 1692634567.89
}
```

**Frequency**: 
- Updates sent only on status change (not every frame)
- Typical: 1-5 messages per minute
- Network overhead: ~50 bytes per message

**Connection Handling:**
- Python server accepts multiple clients
- Electron auto-reconnects every 5 seconds on disconnect
- Graceful degradation: Shows "away" status if disconnected

## File Structure Summary

```
posture-pet/
├── detector.py           # Python: Webcam → MediaPipe → WebSocket
├── requirements.txt      # opencv-python, mediapipe, websockets
├── test_client.py        # Test tool for WebSocket server
├── start.sh / .bat       # Launch scripts
│
├── electron/
│   ├── main.ts          # Electron: Window + WebSocket client
│   └── preload.ts       # Electron: IPC bridge
│
├── src/
│   ├── App.tsx          # React: Root component + state
│   ├── main.tsx         # React: Entry point
│   ├── index.css        # Tailwind + custom styles
│   │
│   ├── components/
│   │   ├── PomodoroTimer.tsx  # Timer logic
│   │   └── PetDisplay.tsx     # Pet visualization
│   │
│   └── types/
│       └── electron.d.ts      # TypeScript definitions
│
└── [config files]
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── tsconfig.json
    └── package.json
```

## Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| Python CPU | 5-10% | On modern hardware |
| Python Memory | 150-200 MB | Including OpenCV + MediaPipe |
| Electron CPU | 1-2% | Idle, <5% active |
| Electron Memory | 100-150 MB | Typical for small Electron app |
| Camera FPS | 5-10 | Configurable via `frame_delay` |
| Network latency | <1ms | Localhost WebSocket |
| Status update delay | 100-200ms | Frame processing + network |

## Extension Points

### Want to add more features?

1. **Multiple posture checks**: Add more landmark comparisons in `calculate_posture()`
2. **Statistics tracking**: Add SQLite database in Python layer
3. **Sound alerts**: Use Electron's audio APIs when slouching detected
4. **Calibration mode**: Capture user's ideal posture at startup
5. **Pet animations**: Replace emoji with Lottie/GIF animations
6. **Settings panel**: Add preferences UI (thresholds, timer durations)
7. **Tray icon**: Add Electron tray for background running
