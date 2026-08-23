import { useState, useEffect, useRef, useCallback } from 'react'
import PetDisplay from './components/PetDisplay'
import { Card } from './components/ui/card'
import { Button } from './components/ui/button'
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

// ── Pomodoro duration presets (in minutes) ──────────────────────────────────
const WORK_PRESETS  = [25, 45, 60]
const BREAK_PRESETS = [5, 15]

// ── Pet color presets (CSS hue-rotate degrees; 0 = original yellow/orange) ──
const PET_COLOR_PRESETS: { label: string; hue: number }[] = [
  { label: 'Original', hue: 0 },
  { label: 'Mint',     hue: 100 },
  { label: 'Blue',     hue: 200 },
  { label: 'Pink',     hue: 280 },
]

// ── Web Audio chimes (native Web Audio API — zero external audio files) ─────
/**
 * Synthesize a short chime with the Web Audio API.
 * - 'start':  a quick, uplifting ascending tone (C5 → C6) signalling that
 *             focus time has begun.
 * - 'finish': a pleasant dual-tone sequence (C6, then E6) signalling that the
 *             session is complete.
 * Each call builds its own AudioContext so the chime is fully self-contained
 * and garbage-collected right after it finishes.
 */
function playAudioChime(type: 'start' | 'finish') {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const now = ctx.currentTime

    if (type === 'start') {
      // Uplifting rising note sequence
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(523.25, now) // C5
      osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.25) // C6
      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now)
      osc.stop(now + 0.35)
    } else {
      // Completion chime sequence
      const osc1 = ctx.createOscillator()
      const gain1 = ctx.createGain()
      osc1.type = 'sine'
      osc1.frequency.setValueAtTime(1046.5, now)
      gain1.gain.setValueAtTime(0.15, now)
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
      osc1.connect(gain1)
      gain1.connect(ctx.destination)
      osc1.start(now)
      osc1.stop(now + 0.6)

      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.type = 'sine'
      osc2.frequency.setValueAtTime(1318.5, now + 0.15)
      gain2.gain.setValueAtTime(0.15, now + 0.15)
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8)
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.start(now + 0.15)
      osc2.stop(now + 0.8)
    }
  } catch (e) {
    console.error('Audio playback failed', e)
  }
}

/** Format a seconds count as MM:SS. */
const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function App() {
  const [isWorkPhase, setIsWorkPhase] = useState(true)
  const [postureStatus, setPostureStatus] = useState<PostureStatus>('unknown')
  const [health, setHealth] = useState(() => {
    const saved = localStorage.getItem('pet-health');
    const parsed = saved !== null ? parseInt(saved, 10) : 100;
    return isNaN(parsed) ? 100 : parsed;
  })
  const [xp, setXp]       = useState(() => {
    const saved = localStorage.getItem('pet-xp');
    const parsed = saved !== null ? parseInt(saved, 10) : 0;
    return isNaN(parsed) ? 0 : parsed;
  })
  const [level, setLevel] = useState(1)
  const [mode, setMode] = useState<'dashboard' | 'taskbar'>('dashboard')
  // Pet color: CSS hue-rotate angle applied to the sprite layers (0 = default yellow/orange)
  const [petHue, setPetHue] = useState<number>(0)

  // ── Pomodoro settings & timer state ─────────────────────────────────────────
  const [workDuration, setWorkDuration] = useState(45)   // minutes
  const [breakDuration, setBreakDuration] = useState(5)  // minutes
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [timeLeft, setTimeLeft] = useState(45 * 60)      // seconds
  const [isRunning, setIsRunning] = useState(false)

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

  // Ref so the health interval always reads the latest HP without stale closure
  const healthRef = useRef(health)
  useEffect(() => { healthRef.current = health }, [health])

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

  // ── Tray "Open Dashboard" listener ──────────────────────────────────────────
  // The system tray sends 'set-mode' from main → renderer to restore the
  // dashboard UI after the user chose it from the tray context menu.
  useEffect(() => {
    if (!window.electronAPI?.onSetMode) return
    window.electronAPI.onSetMode((newMode) => {
      if (newMode === 'dashboard') setMode('dashboard')
    })
  }, [])

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

  // ── Persistent save: synchronous localStorage (no IPC, no disk paths) ─────
  // health & xp initialize straight from localStorage, and every change is
  // written back immediately. The old session.clearStorageData() wipe that
  // destroyed localStorage on exit has been removed, so saves now persist.
  useEffect(() => {
    localStorage.setItem('pet-health', health.toString());
    localStorage.setItem('pet-xp', xp.toString());
  }, [health, xp]);

  // ── Health drain / regen loop (every 3s, driven by posture) ──────────────
  // Permadeath: at 0 HP the loop freezes — no drain, no regen — until the
  // user adopts a new dog.
  useEffect(() => {
    const id = setInterval(() => {
      if (healthRef.current <= 0) return // dead: do nothing
      const status = postureRef.current
      if (status === 'slouching') {
        setHealth(prev => Math.max(0, prev - 1))
      } else if (status === 'good') {
        setHealth(prev => Math.min(100, Math.max(0, prev + 1)))
      }
    }, 3000)

    return () => clearInterval(id)
  }, [])

  // ── Pomodoro countdown tick ─────────────────────────────────────────────────
  // One tick per second while running. Clamped at 0 so the countdown can never
  // go negative; completion is handled by the watcher effect below.
  useEffect(() => {
    if (!isRunning) return
    const id = window.setInterval(() => {
      setTimeLeft(prev => (prev > 0 ? prev - 1 : prev))
    }, 1000)
    return () => clearInterval(id)
  }, [isRunning])

  /** Finish the current phase: play the completion chime, stop the timer, and
   *  switch to the other phase pre-loaded with its full configured duration. */
  const completePhase = useCallback(() => {
    setIsRunning(false)
    const nextIsWork = !isWorkPhase
    if (soundEnabled) playAudioChime('finish')
    setXp(prev => prev + 25) // XP reward for completing a phase
    setIsWorkPhase(nextIsWork)
    setTimeLeft((nextIsWork ? workDuration : breakDuration) * 60)
  }, [isWorkPhase, workDuration, breakDuration, soundEnabled])

  // When the countdown hits 0 while running, complete the phase.
  useEffect(() => {
    if (isRunning && timeLeft <= 0) {
      completePhase()
    }
  }, [isRunning, timeLeft, completePhase])

  // ── Timer controls ──────────────────────────────────────────────────────────
  const handleStartPause = () => {
    if (isRunning) {
      setIsRunning(false)
      return
    }
    // Starting (or resuming) focus/rest → play the start chime.
    if (soundEnabled) playAudioChime('start')
    setIsRunning(true)
  }

  const handleReset = () => {
    setIsRunning(false)
    setTimeLeft((isWorkPhase ? workDuration : breakDuration) * 60)
  }

  /** Apply a work preset; refresh the countdown immediately when idle. */
  const handleSelectWorkDuration = (minutes: number) => {
    setWorkDuration(minutes)
    if (!isRunning && isWorkPhase) setTimeLeft(minutes * 60)
  }

  /** Apply a break preset; refresh the countdown immediately when idle. */
  const handleSelectBreakDuration = (minutes: number) => {
    setBreakDuration(minutes)
    if (!isRunning && !isWorkPhase) setTimeLeft(minutes * 60)
  }

  const currentDurationSeconds = (isWorkPhase ? workDuration : breakDuration) * 60
  const progress = Math.min(100, Math.max(0, ((currentDurationSeconds - timeLeft) / currentDurationSeconds) * 100))

  // ── Permadeath ────────────────────────────────────────────────────────────
  // health is loaded from (and auto-saved to) localStorage, so the dead state
  // survives application restarts.
  const isDead = health <= 0

  /** Adopt a new dog: restore full HP and XP; the save effect writes it to storage. */
  const handleAdoptNewPet = () => {
    setHealth(100)
    setXp(0)
  }

  // Unified RPG HUD values (xp runs 0–100 within each level)
  const levelData = {
    level,
    progressPercent: Math.min(100, Math.max(0, xp)),
    currentLevelXp: xp,
    xpRequired: 100,
  }

  // ── Render based on mode ────────────────────────────────────────────────────

  if (mode === 'taskbar') {
    // Taskbar mode: only the transparent pet container and expand control.
    return (
      <>
        <PetDisplay
          mode="taskbar"
          isWorkPhase={isWorkPhase}
          postureStatus={postureStatus}
          onCalibrate={sendCalibrate}
          petHue={petHue}
          isDead={isDead}
          onAdoptNewPet={handleAdoptNewPet}
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

  // Dashboard mode: Shadcn Card shell with timer, XP, pet, and controls
  return (
    <Card
      className="h-screen w-screen overflow-hidden flex flex-col border-none rounded-none bg-background text-foreground shadow-none p-4"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Draggable header */}
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-sm font-semibold">PosturePet</h1>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleMode('taskbar')}
            title="Minimize to taskbar"
            aria-label="Minimize to taskbar"
          >
            🔽
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => window.close()}
            title="Close"
            aria-label="Close"
          >
            ✕
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div
        className="w-full h-full flex-grow overflow-y-auto no-scrollbar pb-10"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {/* Pomodoro timer card: countdown, duration presets, chime toggle */}
        <div className="w-full bg-muted rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-foreground font-semibold text-lg">
              {isWorkPhase ? '🎯 Work Time' : '☕ Rest Time'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {isWorkPhase ? `${workDuration}m` : `${breakDuration}m`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setSoundEnabled(s => !s)}
                title={soundEnabled ? 'Mute chimes' : 'Unmute chimes'}
                aria-label={soundEnabled ? 'Mute chimes' : 'Unmute chimes'}
              >
                {soundEnabled ? '🔔' : '🔕'}
              </Button>
            </div>
          </div>

          <div className="text-5xl font-bold text-foreground text-center mb-4">
            {formatTime(timeLeft)}
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-border rounded-full mb-4">
            <div
              className="h-full bg-primary rounded-full transition-all duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Duration presets */}
          <div className="flex flex-col gap-2 mb-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground font-medium shrink-0">Work</span>
              <div className="flex gap-1.5">
                {WORK_PRESETS.map(minutes => (
                  <Button
                    key={minutes}
                    size="sm"
                    className="px-2.5"
                    variant={workDuration === minutes ? 'default' : 'outline'}
                    onClick={() => handleSelectWorkDuration(minutes)}
                  >
                    {minutes}m
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground font-medium shrink-0">Break</span>
              <div className="flex gap-1.5">
                {BREAK_PRESETS.map(minutes => (
                  <Button
                    key={minutes}
                    size="sm"
                    className="px-2.5"
                    variant={breakDuration === minutes ? 'default' : 'outline'}
                    onClick={() => handleSelectBreakDuration(minutes)}
                  >
                    {minutes}m
                  </Button>
                ))}
              </div>
            </div>
            {/* Pet color swatches: CSS hue-rotate applied to the sprite layers */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground font-medium shrink-0">Color</span>
              <div className="flex gap-1.5">
                {PET_COLOR_PRESETS.map(({ label, hue }) => (
                  <button
                    key={hue}
                    type="button"
                    onClick={() => setPetHue(hue)}
                    title={label}
                    aria-label={`Pet color: ${label}`}
                    className={`size-6 rounded-full border transition-transform hover:scale-110 ${
                      petHue === hue ? 'ring-2 ring-primary' : 'ring-1 ring-border'
                    }`}
                    style={{ backgroundColor: '#fbbf24', filter: `hue-rotate(${hue}deg)` }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex gap-3">
            <Button onClick={handleStartPause} className="flex-1">
              {isRunning ? 'Pause' : 'Start'}
            </Button>
            <Button variant="secondary" className="px-6" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </div>

        {/* Unified game-styled HUD */}
        <div className="w-full flex flex-col gap-3 px-4 py-3 bg-white/40 rounded-xl shadow-sm border border-gray-100">
          {/* HP Bar */}
          <div className="flex items-center gap-3 text-sm font-bold text-red-500">
            <span className="w-10 drop-shadow-sm">HP</span>
            <div className="h-4 w-full bg-red-100/50 rounded-full overflow-hidden shadow-inner border border-red-200/50">
              <div
                className="h-full bg-gradient-to-r from-red-500 to-rose-400 transition-all duration-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"
                style={{ width: `${health}%` }}
              />
            </div>
            <span className="w-14 text-right">{health}/100</span>
          </div>
          {/* XP Bar */}
          <div className="flex items-center gap-3 text-sm font-bold text-blue-600">
            <span className="w-10 drop-shadow-sm">Lv.{levelData.level}</span>
            <div className="h-4 w-full bg-blue-100/50 rounded-full overflow-hidden shadow-inner border border-blue-200/50">
              <div
                className="h-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 transition-all duration-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                style={{ width: `${levelData.progressPercent}%` }}
              />
            </div>
            <span className="w-14 text-right text-xs">
              {levelData.currentLevelXp}/{levelData.xpRequired}
            </span>
          </div>
        </div>

        <PetDisplay
          mode="dashboard"
          isWorkPhase={isWorkPhase}
          postureStatus={postureStatus}
          onCalibrate={sendCalibrate}
          petHue={petHue}
          isDead={isDead}
          onAdoptNewPet={handleAdoptNewPet}
        />

        {/* TEMPORARY DEBUG BUTTONS — remove before shipping */}
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => setXp(prev => prev + 50)}
            className="px-4 py-2 bg-purple-500 text-white rounded-md text-xs font-bold shadow-md hover:bg-purple-600 transition-colors"
          >
            Debug: +50 XP
          </button>
          <button
            onClick={() => setHealth(prev => Math.max(0, prev - 25))}
            className="px-4 py-2 bg-red-500 text-white rounded-md text-xs font-bold shadow-md hover:bg-red-600 transition-colors"
          >
            Debug: -25 HP
          </button>
        </div>
      </div>
    </Card>
  )
}

export default App
