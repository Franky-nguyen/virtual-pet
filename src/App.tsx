import { useState, useEffect, useRef, useCallback } from 'react'
import PetDisplay from './components/PetDisplay'
import DebugPanel, { type DebugMetrics } from './components/DebugPanel'
import WardrobeModal from './components/WardrobeModal'
import { Card } from './components/ui/card'
import { Button } from './components/ui/button'
import { ChevronUpIcon, ChevronDownIcon, XIcon, VolumeOnIcon, VolumeOffIcon, PaletteIcon } from './components/icons'
import type { PostureData } from './types/electron'
import type { AccessoryType } from './types/accessories'
import { ANIMATION_FRAMES, EVOLVED_ANIMATION_FRAMES, EVOLUTION_FRAME_MS } from './types/accessories'
import { playStart, playReset, playCalibrate, playPop, playToggle } from './utils/soundEffects'
import { playBGM, pauseBGM, skipTrack, setVolume, getVolume } from './utils/bgm'

// ── XP / Leveling Configuration ────────────────────────────────────────────────
// XP rates per tick (every 500 ms)
const XP_GAIN  = 2  // +2 xp / tick when good
const XP_DRAIN = 1  // -1 xp / tick when slouching

/**
 * Calculate the total cumulative XP required to reach a given level.
 * Uses exponential scaling: RequiredXP(level) = BaseXP * level^1.5
 * - Level 1: 100 XP total (levels 1→2)
 * - Level 2: 100 + 100*2^1.5 ≈ 383 XP total (levels 2→3)
 * - Level 3: 100 + 283 + 100*3^1.5 ≈ 903 XP total (levels 3→4)
 * This makes leveling significantly harder as the pet matures, making
 * unlocking accessories a meaningful long-term achievement.
 */
const XP_BASE = 100  // Base XP required for level 1→2
const XP_EXPONENT = 1.5

export function getXpRequiredForLevel(level: number): number {
  // XP needed to go FROM (level-1) TO (level), i.e. to complete level-1 and reach level
  return Math.floor(XP_BASE * Math.pow(level, XP_EXPONENT))
}

/** Calculate the cumulative total XP required to reach the start of a given level. */
export function getCumulativeXpForLevel(level: number): number {
  let total = 0
  for (let i = 1; i < level; i++) {
    total += getXpRequiredForLevel(i)
  }
  return total
}

/** Given total accumulated XP, compute the current level and progress within it. */
export function getLevelProgress(totalXp: number): {
  level: number
  currentLevelXp: number  // XP progress within the current level (0 to xpRequiredForLevel)
  xpRequired: number      // XP needed to complete this level
  progressPercent: number  // 0-100 for the progress bar
} {
  let level = 1
  while (totalXp >= getCumulativeXpForLevel(level + 1)) {
    level++
    // Safety cap at level 999 to prevent infinite loops
    if (level >= 999) break
  }
  const cumulative = getCumulativeXpForLevel(level)
  const currentLevelXp = totalXp - cumulative
  const xpRequired = getXpRequiredForLevel(level)
  const progressPercent = Math.min(100, Math.max(0, (currentLevelXp / xpRequired) * 100))
  return { level, currentLevelXp, xpRequired, progressPercent }
}

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

// Payload shape emitted by detector.py when debug streaming is enabled.
interface DebugFrame {
  type?: string
  status?: string
  data?: string
  metrics?: DebugMetrics
}

/** True when a posture message is a debug_frame from the Python debug path. */
function isDebugFrame(raw: unknown): raw is DebugFrame {
  return !!raw && typeof raw === 'object' && (raw as DebugFrame).type === 'debug_frame'
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
  // Level is derived from xp via getLevelProgress - no separate state needed
  const [mode, setMode] = useState<'dashboard' | 'taskbar'>('dashboard')
  // Pet color: CSS hue-rotate angle applied to the sprite layers (0 = default yellow/orange)
  const [petHue, setPetHue] = useState<number>(0)

  // Log every mode change so the React state ↔ OS window-size sync is easy to trace.
  // Render handshake: once React has committed the new layout, tell the main
  // process it may safely resize the window (ui-ready) — the resize must never
  // race ahead of the DOM. The timer is cleared on every change so a stale
  // confirmation can never resize the window for an outdated mode.
  useEffect(() => {
    console.log('[renderer] mode state changed ->', mode)
    if (!window.electronAPI?.confirmUIReady) return
    const timer = setTimeout(() => {
      console.log(`[renderer] confirming UI ready for mode: ${mode}`)
      window.electronAPI.confirmUIReady(mode)
    }, 50)
    return () => clearTimeout(timer)
  }, [mode])

  // ── Wardrobe / accessory state ─────────────────────────────────────────────
  const [selectedAccessory, setSelectedAccessory] = useState<AccessoryType>(() => {
    const saved = localStorage.getItem('posturepet_accessory')
    if (saved === 'none' || saved === 'sunglasses' || saved === 'partyhat' || saved === 'crown' || saved === 'wizardhat' || saved === 'bowtie') {
      return saved as AccessoryType
    }
    return 'none'
  })
  const [wardrobeOpen, setWardrobeOpen] = useState(false)

  // Persist accessory selection to localStorage
  useEffect(() => {
    localStorage.setItem('posturepet_accessory', selectedAccessory)
  }, [selectedAccessory])

  // ── Developer debug overlay state (toggled with Ctrl+Shift+D) ──────────────
  const [debugOpen, setDebugOpen] = useState(false)
  const [debugFrame, setDebugFrame] = useState<string | null>(null)
  const [debugMetrics, setDebugMetrics] = useState<DebugMetrics | null>(null)
  const [debugStatus, setDebugStatus] = useState<PostureStatus>('unknown')

  // ── Pomodoro settings & timer state ─────────────────────────────────────────
  const [workDuration, setWorkDuration] = useState(45)   // minutes
  const [breakDuration, setBreakDuration] = useState(5)  // minutes
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [bgmVolume, setBgmVolume] = useState(() => getVolume())
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

  // ── Evolution (Level 10) tracking ─────────────────────────────────────────
  // isEvolved is persisted so the one-time evolution permanently survives
  // restarts. isEvolving is transient — it only lives for the 1.05s animation.
  const [isEvolved, setIsEvolved] = useState<boolean>(() => localStorage.getItem('pet-evolved') === '1')
  const [isEvolving, setIsEvolving] = useState(false)

  // Persist the evolved flag immediately (same pattern as health/xp saves).
  useEffect(() => {
    localStorage.setItem('pet-evolved', isEvolved ? '1' : '0')
  }, [isEvolved])

  // Holds the evolution timer so it can be cancelled on adopt.
  const evolutionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Posture listener: Electron IPC (preferred) or direct WebSocket fallback ──
  useEffect(() => {
    if (window.electronAPI) {
      // Electron path — data arrives already parsed as PostureData. Debug
      // frames (annotated JPEG + metrics) are routed to the overlay instead
      // of the posture status pipeline.
      window.electronAPI.onPostureUpdate((data: PostureData) => {
        if (isDebugFrame(data)) {
          const frame = data as DebugFrame
          setDebugFrame(frame.data ?? null)
          setDebugMetrics(frame.metrics ?? null)
          const s = parseStatus(frame)
          if (s) setDebugStatus(s)
          return
        }
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
        // Structured JSON may be a debug_frame payload — route it to the
        // debug overlay instead of the posture status pipeline.
        try {
          const obj = JSON.parse(event.data)
          if (obj?.type === 'debug_frame') {
            setDebugFrame(obj.data ?? null)
            setDebugMetrics(obj.metrics ?? null)
            const s = parseStatus(obj)
            if (s) setDebugStatus(s)
            return
          }
        } catch {}
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

  // ── Mode change notifications from the main process ────────────────────────────
  // The main process (tray menu, keyboard shortcut, etc.) pushes the new window
  // mode to the renderer via the 'mode-changed' IPC channel.  This ensures the
  // renderer always stays in sync with the actual OS window state, regardless
  // of which code path triggered the change.
  useEffect(() => {
    if (!window.electronAPI?.onModeChanged) return
    console.log('[renderer] registering onModeChanged listener (channel: mode-changed)')
    window.electronAPI.onModeChanged((newMode) => {
      console.log('[renderer] received mode-changed IPC:', newMode)
      setMode(newMode)
    })
  }, [])


  // ── Force-taskbar-ui: tray "Minimize to Tray" handler ─────────────────────────
  // The main process sends this via the dedicated 'force-taskbar-ui' IPC channel
  // when the tray's "Minimize to Tray" shrinks the window.  It mirrors the
  // force-restore-ui pattern for the opposite direction.
  useEffect(() => {
    if (!window.electronAPI?.onForceTaskbarUI) return
    console.log('[renderer] registering onForceTaskbarUI listener (channel: force-taskbar-ui)')
    window.electronAPI.onForceTaskbarUI(() => {
      console.log('[renderer] received force-taskbar-ui IPC — forcing taskbar mode')
      setMode('taskbar')
    })
  }, [])

  /** Send the calibration command through the active transport. */
  const sendCalibrate = useCallback(() => {
    playCalibrate()
    if (window.electronAPI) {
      window.electronAPI.calibratePosture()
      return
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'calibrate' }))
    }
  }, [])

  /** Send the debug-stream toggle through the active transport. */
  const sendDebug = useCallback((enabled: boolean) => {
    if (window.electronAPI?.setDebug) {
      window.electronAPI.setDebug(enabled)
      return
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'debug', enabled }))
    }
  }, [])

  /** Toggle the debug overlay; mirror the state to the Python detector so it
   *  only annotates/encodes frames while someone is actually looking. */
  const toggleDebug = useCallback(() => {
    setDebugOpen(prev => {
      sendDebug(!prev)
      if (prev) {
        setDebugFrame(null)
        setDebugMetrics(null)
      }
      return !prev
    })
  }, [sendDebug])

  // ── Developer debug overlay: Ctrl+Shift+D ─────────────────────────────────
  // Strictly internal inspection tool — while the overlay is closed the main
  // dashboard is pixel-identical to a build without it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault()
        toggleDebug()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleDebug])

  /** Toggle between dashboard and taskbar modes.
   *  Only the React state is updated here — the window resize is deferred to the
   *  'ui-ready' render handshake (see the [mode] effect), so the OS window can
   *  never shrink/expand before the DOM has painted the new layout. */
  const toggleMode = useCallback((newMode: 'dashboard' | 'taskbar') => {
    console.log(`[renderer] toggleMode -> ${newMode}`)
    setMode(newMode)
  }, [])

  // ── XP / level-up interval ──────────────────────────────────────────────────
  // XP now uses exponential scaling. Each level requires BaseXP * level^1.5 more XP.
  // At level 1: 100 XP per level. At level 5: ~559 XP. At level 10: ~3162 XP.
  useEffect(() => {
    const id = setInterval(() => {
      const status = postureRef.current
      if (status === 'good') {
        setXp(prev => prev + XP_GAIN)
      } else if (status === 'slouching') {
        setXp(prev => Math.max(0, prev - XP_DRAIN))
      }
      // 'away' / 'unknown' / 'calibrating' -> XP frozen
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

  /** Finish the current phase: stop the timer, award XP, and
   *  switch to the other phase pre-loaded with its full configured duration. */
  const completePhase = useCallback(() => {
    setIsRunning(false)
    pauseBGM()
    const nextIsWork = !isWorkPhase
    setXp(prev => prev + 25) // XP reward for completing a phase
    setIsWorkPhase(nextIsWork)
    setTimeLeft((nextIsWork ? workDuration : breakDuration) * 60)
    // Trigger the pet's notification attack animation (works for both puppy and evolved dog)
    window.dispatchEvent(new CustomEvent('pet:notify'))
  }, [isWorkPhase, workDuration, breakDuration])

  // When the countdown hits 0 while running, complete the phase.
  useEffect(() => {
    if (isRunning && timeLeft <= 0) {
      completePhase()
    }
  }, [isRunning, timeLeft, completePhase])

  // ── Timer controls ──────────────────────────────────────────────────────────
  const handleStartPause = () => {
    if (isRunning) {
      if (soundEnabled) playPop()
      pauseBGM()
      setIsRunning(false)
      return
    }
    if (soundEnabled) playStart()
    playBGM()
    setIsRunning(true)
  }

  const handleReset = () => {
    playReset()
    pauseBGM()
    setIsRunning(false)
    setTimeLeft((isWorkPhase ? workDuration : breakDuration) * 60)
  }

  /** Apply a work preset; refresh the countdown immediately when idle. */
  const handleSelectWorkDuration = (minutes: number) => {
    playPop()
    setWorkDuration(minutes)
    if (!isRunning && isWorkPhase) setTimeLeft(minutes * 60)
  }

  /** Apply a break preset; refresh the countdown immediately when idle. */
  const handleSelectBreakDuration = (minutes: number) => {
    playPop()
    setBreakDuration(minutes)
    if (!isRunning && !isWorkPhase) setTimeLeft(minutes * 60)
  }

  const currentDurationSeconds = (isWorkPhase ? workDuration : breakDuration) * 60
  const progress = Math.min(100, Math.max(0, ((currentDurationSeconds - timeLeft) / currentDurationSeconds) * 100))

  // ── Permadeath ────────────────────────────────────────────────────────────
  // health is loaded from (and auto-saved to) localStorage, so the dead state
  // survives application restarts.
  const isDead = health <= 0

  /** Adopt a new dog: restore full HP and XP; the save effect writes it to storage.
   *  A newly adopted dog starts in its base form and can evolve again. */
  const handleAdoptNewPet = () => {
    setHealth(100)
    setXp(0)
    setIsEvolved(false)
    setIsEvolving(false)
    if (evolutionTimerRef.current) {
      clearTimeout(evolutionTimerRef.current)
      evolutionTimerRef.current = null
    }
  }

  // ── Death animation freeze ────────────────────────────────────────────────
  // The Death layer loops its sprite (`.death-sprite` is `infinite`), so we
  // can't rely on an `animationend` event (infinite loops never fire it).  We
  // time the freeze to exactly one full cycle (frames × 150ms) after the pet
  // dies, then pin the Death sprite on its final frame forever.
  const [deathFrozen, setDeathFrozen] = useState(false)

  useEffect(() => {
    if (!isDead) {
      setDeathFrozen(false)
      return
    }
    const frames = isEvolved ? EVOLVED_ANIMATION_FRAMES.Death : ANIMATION_FRAMES.Death
    const timer = setTimeout(() => setDeathFrozen(true), frames * EVOLUTION_FRAME_MS)
    return () => clearTimeout(timer)
  }, [isDead, isEvolved])

  // Compute level and XP progress from the total accumulated XP.
  // xp is now the CUMULATIVE total (not per-level), computed via getLevelProgress.
  const levelData = getLevelProgress(xp)

  // ── Level 10 evolution — manual trigger ───────────────────────────────────
  // The pet reaches Level 10 passively through XP, but the evolution is
  // USER-initiated via the "Evolve" button. The sequence is:
  //   t=0ms     setIsEvolving(true)  — blink starts, evolution layer mounts
  //   t=2500ms  blink ends           — blink animation stops
  //   t=3700ms  animationend fires   — handleEvolutionAnimEnd → isEvolving=false,
  //                                      isEvolved=true (both in same React batch)
  const triggerEvolution = () => {
    if (isEvolved || isEvolving) return
    // The trigger arpeggio is played by PetDisplay's handleEvolveClick (the
    // chiptune cue), so no keystroke sound is needed here.
    // Cancel any stale timer from a previous interrupted evolution
    if (evolutionTimerRef.current) {
      clearTimeout(evolutionTimerRef.current)
      evolutionTimerRef.current = null
    }
    setIsEvolving(true)
    // animationend (PetDisplay) fires at BLINK_MS + DURATION_MS = 3700ms and
    // sets BOTH isEvolving=false AND isEvolved=true in the same batch.
  }

  // Called by PetDisplay's animationend handler the instant the 1.2s evolution
  // sprite animation finishes. This is the authoritative end-of-animation signal —
  // no setTimeout drift, no race conditions, pixel-accurate to the CSS clock.
  // We set BOTH isEvolving=false AND isEvolved=true here, in the same batch, so
  // the puppy sprite never re-appears: as soon as the blink wrapper unmounts
  // (opacity-0) the adult sprite layers are already active (isEvolved=true).
  const handleEvolutionAnimEnd = () => {
    setIsEvolving(false)
    setIsEvolved(true)
  }

  // ── Render based on mode ────────────────────────────────────────────────────

  if (mode === 'taskbar') {
    // Taskbar mode: the wrapper must fill the small Electron window exactly
    // (w-screen h-screen) so nothing gets clipped by the window edges. Content
    // is centered in a column — the pet circle on top, the timer below.
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-1 overflow-hidden m-0 p-0 bg-transparent select-none">
        {/* Pet sprite — sized to its own circle so it is never cut off */}
        <div className="flex-shrink-0 w-[110px] h-[110px] rounded-full bg-background/70 flex items-center justify-center overflow-hidden">
          <PetDisplay
            mode="taskbar"
            isWorkPhase={isWorkPhase}
            postureStatus={postureStatus}
            onCalibrate={sendCalibrate}
            petHue={petHue}
            isDead={isDead}
            onAdoptNewPet={handleAdoptNewPet}
            selectedAccessory={selectedAccessory}
            isEvolving={isEvolving}
            isEvolved={isEvolved}
            deathFrozen={deathFrozen}
            petLevel={levelData.level}
            onEvolve={triggerEvolution}
            onEvolutionAnimEnd={handleEvolutionAnimEnd}
          />
        </div>

        {/* Timer + controls — centered below the pet */}
        <div className="flex flex-col items-center gap-0.5 min-w-0">
          {/* Phase label — white for legibility over the dark widget */}
          <span className="text-[9px] font-bold text-white leading-none truncate">
            {isWorkPhase ? 'Work' : 'Break'}
          </span>

          {/* Countdown — white for legibility over the dark widget */}
          <span className="text-lg font-bold tabular-nums leading-none text-white">
            {formatTime(timeLeft)}
          </span>

          {/* Controls row */}
          <div className="flex items-center gap-1">
            {/* Play/Pause */}
            <button
              onClick={handleStartPause}
              className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-80 transition-opacity"
              title={isRunning ? 'Pause' : 'Start'}
              aria-label={isRunning ? 'Pause' : 'Start'}
            >
              {isRunning ? (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <rect x="1" y="0" width="2" height="8" />
                  <rect x="5" y="0" width="2" height="8" />
                </svg>
              ) : (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <path d="M0 0 L8 4 L0 8 Z" />
                </svg>
              )}
            </button>

            {/* Expand to dashboard — calls toggleMode which fires setMode IPC
                to the main process, which resizes the window */}
            <button
              onClick={() => toggleMode('dashboard')}
              className="w-6 h-6 rounded-full bg-muted text-muted-foreground flex items-center justify-center hover:bg-muted/80 transition-colors cursor-pointer"
              title="Open Dashboard"
              aria-label="Open Dashboard"
            >
              <ChevronUpIcon className="size-3" />
            </button>
          </div>
        </div>
      </div>
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
            onClick={() => { playToggle(); toggleMode('taskbar') }}
            title="Minimize to taskbar"
            aria-label="Minimize to taskbar"
          >
            <ChevronDownIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { playToggle(); window.close() }}
            title="Close"
            aria-label="Close"
          >
            <XIcon />
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
              {isWorkPhase ? 'Work Time' : 'Rest Time'}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">
                {isWorkPhase ? `${workDuration}m` : `${breakDuration}m`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => { playToggle(); setSoundEnabled(s => !s) }}
                title={soundEnabled ? 'Mute chimes' : 'Unmute chimes'}
                aria-label={soundEnabled ? 'Mute chimes' : 'Unmute chimes'}
              >
                {soundEnabled ? <VolumeOnIcon /> : <VolumeOffIcon />}
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
                    onClick={() => { playPop(); setPetHue(hue) }}
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

          {/* BGM cluster: volume slider + skip */}
          <div className="flex items-center gap-2 mt-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={bgmVolume}
              onChange={e => {
                const v = parseFloat(e.target.value)
                setBgmVolume(v)
                setVolume(v)
              }}
              className="flex-1 h-1 accent-primary cursor-pointer"
              aria-label="BGM volume"
              title={`Volume: ${Math.round(bgmVolume * 100)}%`}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => { playPop(); skipTrack() }}
              title="Skip track"
              aria-label="Skip track"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 4 15 12 5 20 5 4" />
                <line x1="19" y1="5" x2="19" y2="19" />
              </svg>
            </Button>
          </div>
        </div>

        {/* Stats HUD: flat, handcrafted HP & XP bars */}
        <div className="w-full flex flex-col gap-3 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200">
          {/* HP Bar */}
          <div className="flex items-center justify-between gap-3">
            <span className="w-12 shrink-0 font-medium text-xs text-gray-700 dark:text-gray-300">HP</span>
            <div className="h-2.5 w-full bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full transition-all duration-300 ease-in-out"
                style={{ width: `${health}%` }}
              />
            </div>
            <span className="shrink-0 font-medium text-xs text-gray-700 dark:text-gray-300 tabular-nums">
              {health}/100
            </span>
          </div>
          {/* XP Bar */}
          <div className="flex items-center justify-between gap-3">
            <span className="w-12 shrink-0 font-medium text-xs text-gray-700 dark:text-gray-300">
              Lv.{levelData.level} XP
            </span>
            <div className="h-2.5 w-full bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-in-out"
                style={{ width: `${levelData.progressPercent}%` }}
              />
            </div>
            <span className="shrink-0 font-medium text-xs text-gray-700 dark:text-gray-300 tabular-nums">
              {levelData.currentLevelXp}/{levelData.xpRequired}
            </span>
          </div>
          {/* Wardrobe toggle */}
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => { playToggle(); setWardrobeOpen(true) }}
            >
              <PaletteIcon className="size-3.5" />
              Wardrobe
            </Button>
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
          selectedAccessory={selectedAccessory}
          isEvolving={isEvolving}
          isEvolved={isEvolved}
          deathFrozen={deathFrozen}
          petLevel={levelData.level}
          onEvolve={triggerEvolution}
          onEvolutionAnimEnd={handleEvolutionAnimEnd}
        />

        {/* Wardrobe modal */}
        <WardrobeModal
          open={wardrobeOpen}
          petLevel={levelData.level}
          selectedAccessory={selectedAccessory}
          onSelect={(id) => {
            setSelectedAccessory(id)
            setWardrobeOpen(false)
          }}
          onClose={() => setWardrobeOpen(false)}
        />

        {/* Developer debug overlay — internal inspection tool opened with
            Ctrl+Shift+D. Renders nothing when closed, so the consumer UI
            stays pixel-identical. Also houses the throwaway +500 XP / -25 HP
            test buttons, wired to the exact same state updates they always
            used — they just only exist while the drawer is open. */}
        <DebugPanel
          open={debugOpen}
          frame={debugFrame}
          metrics={debugMetrics}
          status={debugStatus}
          onClose={toggleDebug}
          onAddXp={() => setXp(prev => prev + 500)}
          onDamage={() => setHealth(prev => Math.max(0, prev - 25))}
        />
      </div>
    </Card>
  )
}

export default App
