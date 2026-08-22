import { useState, useEffect, useRef, useCallback } from 'react'
import PomodoroTimer from './components/PomodoroTimer'
import PetDisplay from './components/PetDisplay'
import type { PostureData } from './types/electron'

// XP rates per tick (every 500 ms)
const XP_GAIN  = 2  // +2 xp / tick when good
const XP_DRAIN = 1  // -1 xp / tick when slouching

// Posture updates are coalesced with a trailing-edge debounce so that rapid,
// conflicting payloads (e.g. two zombie backend processes fighting over the
// same WebSocket) collapse into one stable status instead of thrashing React
// and remounting the sprite every frame. The latest status always wins.
const POSTURE_DEBOUNCE_MS = 150

type PostureStatus = PostureData['status'] | 'unknown' | 'calibrating' | 'calibrated'

/** Parse posture status from any WebSocket message shape Python sends. */
function parseStatus(raw: unknown): PostureStatus | null {
  let status = ''

  if (typeof raw === 'string') {
    status = raw.trim()
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.status) status = parsed.status
    } catch {}
  } else if (raw && typeof raw === 'object' && 'status' in (raw as object)) {
    status = (raw as PostureData).status
  }

  const valid: PostureStatus[] = ['good', 'slouching', 'away', 'calibrating', 'calibrated']
  if (valid.includes(status as PostureStatus)) return status as PostureStatus
  return null
}

function App() {
  const [isWorkPhase, setIsWorkPhase] = useState(true)
  const [postureStatus, setPostureStatus] = useState<PostureStatus>('unknown')
  const [xp, setXp]       = useState(0)
  const [level, setLevel] = useState(1)
  const [mode, setMode] = useState<'dashboard' | 'taskbar'>('dashboard')

  // Live WebSocket ref — used by sendCalibrate without re-mounting the effect
  const wsRef = useRef<WebSocket | null>(null)

  // ── Posture status debounce ────────────────────────────────────────────────
  // Trailing-edge throttle: hold the newest status, apply it immediately when
  // the last apply is old enough, otherwise flush it on a short timer. A burst
  // of rapid messages therefore results in exactly one state change, and the
  // final status is never lost.
  const pendingStatusRef = useRef<PostureStatus | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAppliedAtRef = useRef(0)

  const flushStatus = useCallback(() => {
    debounceTimerRef.current = null
    const pending = pendingStatusRef.current
    pendingStatusRef.current = null
    if (pending !== null) {
      lastAppliedAtRef.current = Date.now()
      setPostureStatus(pending)
    }
  }, [])

  const queueStatus = useCallback((status: PostureStatus) => {
    pendingStatusRef.current = status
    const now = Date.now()
    if (now - lastAppliedAtRef.current >= POSTURE_DEBOUNCE_MS) {
      flushStatus()
    } else if (debounceTimerRef.current === null) {
      debounceTimerRef.current = setTimeout(flushStatus, POSTURE_DEBOUNCE_MS)
    }
  }, [flushStatus])

  // Ref so the XP interval always reads the latest status without stale closure
  const postureRef = useRef(postureStatus)
  useEffect(() => { postureRef.current = postureStatus }, [postureStatus])

  // ── Posture listener: Electron IPC (preferred) or direct WebSocket fallback ──
  useEffect(() => {
    if (window.electronAPI) {
      // Electron path — data arrives already parsed as PostureData
      window.electronAPI.onPostureUpdate((data: PostureData) => {
        const s = parseStatus(data)
        if (s) queueStatus(s)
      })
      return () => {
        window.electronAPI.removePostureListener()
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      }
    }

    // Browser / dev-server fallback — connect directly to Python WebSocket
    let retryTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      const ws = new WebSocket('ws://localhost:8765')
      wsRef.current = ws

      ws.onmessage = (event) => {
        const s = parseStatus(event.data)
        if (s) queueStatus(s)
      }

      ws.onclose = () => {
        wsRef.current = null
        retryTimer = setTimeout(connect, 5000)
      }
    }

    connect()
    return () => {
      wsRef.current?.close()
      clearTimeout(retryTimer)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [queueStatus])

  /** Send the calibration command through the active transport. */
  const sendCalibrate = useCallback(() => {
    if (window.electronAPI) {
      window.electronAPI.calibratePosture()
      return
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'calibrate' }))
    }
  }, [])

  /** Toggle between dashboard and taskbar modes */
  const toggleMode = useCallback((newMode: 'dashboard' | 'taskbar') => {
    setMode(newMode)
    if (window.electronAPI?.setMode) {
      window.electronAPI.setMode(newMode)
    }
  }, [])

  // ── XP / level-up interval ──────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const status = postureRef.current
      if (status === 'good') {
        setXp(prev => {
          const next = prev + XP_GAIN
          if (next >= 100) {
            setLevel(l => l + 1)
            return next - 100   // carry over remainder
          }
          return next
        })
      } else if (status === 'slouching') {
        setXp(prev => Math.max(0, prev - XP_DRAIN))
      }
      // 'away' / 'unknown' / 'calibrating' → XP frozen
    }, 500)

    return () => clearInterval(id)
  }, [])

  // ── Render based on mode ────────────────────────────────────────────────────

  if (mode === 'taskbar') {
    // Taskbar mode: only the transparent pet container and expand control.
    return (
      <>
        <PetDisplay
          mode="taskbar"
          isWorkPhase={isWorkPhase}
          postureStatus={postureStatus}
          xp={xp}
          level={level}
          onCalibrate={sendCalibrate}
        />
        <button
          onClick={() => toggleMode('dashboard')}
          className="taskbar-expand-button"
          title="Expand to dashboard"
          aria-label="Expand to dashboard"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          🔼
        </button>
      </>
    )
  }

  // Dashboard mode: full UI with timer, XP, pet, and controls
  return (
    <div
      className="w-[380px] h-[620px] bg-gradient-to-br from-purple-500/90 to-pink-500/90 backdrop-blur-md rounded-3xl shadow-2xl overflow-hidden"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Draggable header */}
      <div
        className="h-8 bg-white/10 flex items-center justify-between px-4"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <span className="text-white text-sm font-medium">PosturePet</span>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Minimize to taskbar button */}
          <button
            onClick={() => toggleMode('taskbar')}
            className="text-white hover:text-blue-300 transition-colors text-xs"
            title="Minimize to taskbar"
          >
            🔽
          </button>
          {/* Close button */}
          <button
            onClick={() => window.close()}
            className="text-white hover:text-red-300 transition-colors text-xs"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="p-6 flex flex-col items-center gap-6" style={{ WebkitAppRegion: 'no-drag' } as any}>
        <PomodoroTimer
          isWorkPhase={isWorkPhase}
          onPhaseChange={setIsWorkPhase}
        />
        <PetDisplay
          mode="dashboard"
          isWorkPhase={isWorkPhase}
          postureStatus={postureStatus}
          xp={xp}
          level={level}
          onCalibrate={sendCalibrate}
        />
      </div>
    </div>
  )
}

export default App
