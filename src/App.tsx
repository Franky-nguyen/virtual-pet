import { useState, useEffect, useRef, useCallback } from 'react'
import PetDisplay from './components/PetDisplay'
import DebugPanel, { type DebugMetrics } from './components/DebugPanel'
import WardrobeModal from './components/WardrobeModal'
import CreatePetModal from './components/CreatePetModal'
import PetSelectorModal from './components/PetSelectorModal'
import StretchBreakModal, {
  selectStretch,
  analyzeSlouchHistory,
  averageSlouchHistory,
  parseSlouchScores,
  STRETCH_CATALOG,
  type StretchName,
  type SlouchScores,
} from './components/StretchBreakModal'
import { Card } from './components/ui/card'
import { Button } from './components/ui/button'
import { ChevronUpIcon, ChevronDownIcon, XIcon, VolumeOnIcon, VolumeOffIcon, PaletteIcon, FlowerIcon, SparkleIcon } from './components/icons'
import type { PostureData } from './types/electron'
import type { AccessoryType } from './types/accessories'
import { ANIMATION_FRAMES, EVOLVED_ANIMATION_FRAMES, EVOLUTION_FRAME_MS } from './types/accessories'
import { BUILTIN_PET_ID, getBuiltinPetModel, isBuiltinPetId, type RuntimeCustomPet } from './types/customPet'
import { listInstalledCustomPets, deleteInstalledCustomPet } from './utils/customPetBridge'
import { playStart, playReset, playCalibrate, playPop, playToggle } from './utils/soundEffects'
import { playBGM, pauseBGM, skipTrack, setVolume, getVolume } from './utils/bgm'

export {
  selectStretch,
  analyzeSlouchHistory,
  averageSlouchHistory,
  parseSlouchScores,
  STRETCH_CATALOG,
  type StretchName,
  type SlouchScores,
}

// ── UC-5 (P2): Auto-break threshold for continuous slouching (5 minutes) ────
export const SLOUCH_AUTO_BREAK_MS = 5 * 60 * 1000
const SLOUCH_HISTORY_MAX = 60
const SLOUCH_ACCUM_TICK_MS = 1000

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

  // ── Wellness mode state ─────────────────────────────────────────────────────
  const [wellnessMode, setWellnessMode] = useState(() => {
    const saved = localStorage.getItem('wellness-mode')
    return saved === 'true'
  })
  // Note: the old 'wellness-streak' and 'posturepet-focus-points' localStorage
  // keys are intentionally left untouched — they are no longer read or shown.
  const [lastWellnessCheck, setLastWellnessCheck] = useState(() => {
    return localStorage.getItem('wellness-last-check') || ''
  })
  const [currentMood, setCurrentMood] = useState<'happy' | 'neutral' | 'sad' | null>(() => {
    const saved = localStorage.getItem('wellness-mood')
    if (saved === 'happy' || saved === 'neutral' || saved === 'sad') return saved
    return null
  })
  const [showMoodSelector, setShowMoodSelector] = useState(false)
  const [wellnessMessage, setWellnessMessage] = useState<string | null>(null)

  // ── UC-4 Wellness Mode: XP self-reports & manual habit checks ──────────────
  // Flat pet-XP reward per "I'm Aligned" self-report (no camera involved).
  const ALIGNED_XP = 15
  // Shared anti-spam cooldown for "I'm Aligned" AND "Wellness Check".
  const WELLNESS_COOLDOWN_S = 120
  // Default interval between "Quick Check" prompts during a focus session.
  const QUICK_CHECK_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes
  // A user with no mouse/keyboard input for this long is not "working", so the
  // check-in prompt holds off (UC-4 step 2: Input Monitor confirms activity).
  const ACTIVITY_IDLE_MS = 5 * 60 * 1000 // 5 minutes

  // The "Quick Check: Are you sitting up straight?" prompt.
  const [showQuickCheck, setShowQuickCheck] = useState(false)

  // Shared cooldown: epoch-ms when the next self-report / check is allowed.
  // The ref is the synchronous source of truth (blocks double-clicks and
  // hotkey repeats within the same frame); the state drives the UI.
  const wellnessCooldownUntilRef = useRef(0)
  const [wellnessCooldownUntil, setWellnessCooldownUntil] = useState(0)
  const [cooldownNow, setCooldownNow] = useState(() => Date.now())
  const wellnessCooldownLeft = Math.max(0, Math.ceil((wellnessCooldownUntil - cooldownNow) / 1000))

  // Tick once per second only while a cooldown is active.
  useEffect(() => {
    if (wellnessCooldownUntil <= Date.now()) return
    setCooldownNow(Date.now())
    const id = window.setInterval(() => {
      const now = Date.now()
      setCooldownNow(now)
      if (now >= wellnessCooldownUntil) window.clearInterval(id)
    }, 1000)
    return () => window.clearInterval(id)
  }, [wellnessCooldownUntil])

  /** Start the shared cooldown if it has expired. Returns false while cooling down. */
  const tryStartWellnessCooldown = useCallback(() => {
    const now = Date.now()
    if (now < wellnessCooldownUntilRef.current) return false
    const until = now + WELLNESS_COOLDOWN_S * 1000
    wellnessCooldownUntilRef.current = until
    setCooldownNow(now)
    setWellnessCooldownUntil(until)
    return true
  }, [])

  // Help legend (dashboard "?" button)
  const [helpOpen, setHelpOpen] = useState(false)

  // Wellness reminders: prompt user every 2 hours when wellness mode is enabled
  const WELLNESS_INTERVAL_MS = 2 * 60 * 60 * 1000 // 2 hours

  // ── First-time onboarding & calibration state ──────────────────────────────
  // UC-1: Onboarding, Calibration, and Camera Configuration
  const [isFirstLaunch, setIsFirstLaunch] = useState(() => {
    const saved = localStorage.getItem('posturepet-calibrated')
    return saved !== 'true'
  })
  const [showOnboarding, setShowOnboarding] = useState(isFirstLaunch)
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
  const [cameraDenied, setCameraDenied] = useState(false)
  // Exit animation: the onboarding card scales/fades out before the app takes over.
  const [onboardingLeaving, setOnboardingLeaving] = useState(false)

  // Mark calibration as complete and save to localStorage.
  // Plays a short exit animation, then unmounts the onboarding overlay so the
  // dashboard is revealed in place (no reload, no dead air).
  const completeCalibration = useCallback(() => {
    localStorage.setItem('posturepet-calibrated', 'true')
    setIsFirstLaunch(false)
    setIsCalibrating(false)
    setPostureStatus('calibrated')
    setCalibrationError(null)
    if (calibrationTimerRef.current) {
      clearTimeout(calibrationTimerRef.current)
      calibrationTimerRef.current = null
    }
    setOnboardingLeaving(true)
    window.setTimeout(() => {
      setShowOnboarding(false)
      setOnboardingLeaving(false)
    }, 320)
  }, [])

  // Start calibration process. The backend normally answers within ~1s (it
  // averages 3 frames, one per second); we only fall back to the error state
  // after a short 3s grace period so the user is never left waiting.
  const calibrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The posture listener effect is mounted once, so it reads these through
  // refs — otherwise it would capture the first-render (stale) closures.
  const isCalibratingRef = useRef(false)
  const completeCalibrationRef = useRef(completeCalibration)
  useEffect(() => { isCalibratingRef.current = isCalibrating }, [isCalibrating])
  useEffect(() => { completeCalibrationRef.current = completeCalibration }, [completeCalibration])

  useEffect(() => {
    return () => {
      if (calibrationTimerRef.current) clearTimeout(calibrationTimerRef.current)
    }
  }, [])

  const startCalibration = useCallback(() => {
    setIsCalibrating(true)
    setCalibrationError(null)
    setPostureStatus('calibrating')
    playCalibrate()

    if (window.electronAPI) {
      window.electronAPI.calibratePosture()
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'calibrate' }))
    }

    if (calibrationTimerRef.current) clearTimeout(calibrationTimerRef.current)
    calibrationTimerRef.current = setTimeout(() => {
      calibrationTimerRef.current = null
      // Only fail if we are still waiting — completeCalibration clears this.
      setIsCalibrating(prev => {
        if (prev) {
          setCalibrationError('Calibration failed: alignment obscured. Please adjust lighting or angle and retry.')
          setPostureStatus('unknown')
          return false
        }
        return prev
      })
    }, 3000)
  }, [])

  // Handle camera denial — UC-1a: switch the onboarding card to the
  // "Wellness Mode (no camera)" branch. The actual telemetry swap happens when
  // the user confirms with "Get Started with Wellness Mode".
  const handleCameraDenied = useCallback(() => {
    setCameraDenied(true)
    setIsCalibrating(false)
  }, [])

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
    }, 15)
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

  // Persist accessory selection to localStorage. The selection survives death,
  // evolution and "Adopt a New Dog" — only the Wardrobe changes it.
  useEffect(() => {
    localStorage.setItem('posturepet_accessory', selectedAccessory)
  }, [selectedAccessory])

  // ── Custom Pet packs & selected pet persistence ─────────────────────────────
  const [customPets, setCustomPets] = useState<RuntimeCustomPet[]>([])
  const [customPetsLoaded, setCustomPetsLoaded] = useState(false)
  const [selectedPetId, setSelectedPetId] = useState<string>(() => {
    return localStorage.getItem('posturepet-selected-pet') || BUILTIN_PET_ID
  })
  const [createPetOpen, setCreatePetOpen] = useState(false)
  const [petSelectorOpen, setPetSelectorOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('posturepet-selected-pet', selectedPetId)
  }, [selectedPetId])

  const refreshCustomPets = useCallback(async () => {
    const installed = await listInstalledCustomPets()
    setCustomPets(installed)
    setCustomPetsLoaded(true)
  }, [])

  useEffect(() => {
    refreshCustomPets()
  }, [refreshCustomPets])

  // If the persisted selectedPetId refers to a custom pack that is no longer installed,
  // fall back safely to the built-in pet once the installed list has loaded.
  // Built-in pet IDs ('builtin' for Original Dog and 'builtin-cat' for Pixel Cat)
  // are always valid and preserved across restarts.
  useEffect(() => {
    if (!customPetsLoaded || isBuiltinPetId(selectedPetId)) return
    if (!customPets.some((p) => p.manifest.id === selectedPetId)) {
      setSelectedPetId(BUILTIN_PET_ID)
    }
  }, [customPetsLoaded, customPets, selectedPetId])

  const activeBuiltinModel = getBuiltinPetModel(selectedPetId)
  const activeCustomPet = isBuiltinPetId(selectedPetId)
    ? null
    : customPets.find((p) => p.manifest.id === selectedPetId) ?? null

  // Only the built-in Original Dog can evolve; Pixel Cat and Custom Pets cannot evolve.
  const canCurrentPetEvolve = !activeCustomPet && activeBuiltinModel === 'dog'

  const handlePetInstalled = useCallback((pet: RuntimeCustomPet, selectImmediately: boolean) => {
    setCustomPets((prev) => {
      const rest = prev.filter((p) => p.manifest.id !== pet.manifest.id)
      return [pet, ...rest]
    })
    if (selectImmediately) {
      setSelectedPetId(pet.manifest.id)
    }
  }, [])

  const handleDeleteCustomPet = useCallback(async (petId: string) => {
    const res = await deleteInstalledCustomPet(petId)
    if (res.ok) {
      setCustomPets((prev) => prev.filter((p) => p.manifest.id !== petId))
      setSelectedPetId((prev) => (prev === petId ? BUILTIN_PET_ID : prev))
    }
  }, [])

  // ── Wellness mode persistence ───────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('wellness-mode', wellnessMode.toString())
  }, [wellnessMode])

  useEffect(() => {
    if (lastWellnessCheck) {
      localStorage.setItem('wellness-last-check', lastWellnessCheck)
    }
  }, [lastWellnessCheck])

  useEffect(() => {
    if (currentMood) {
      localStorage.setItem('wellness-mood', currentMood)
    }
  }, [currentMood])

  // ── Wellness check-in scheduler ─────────────────────────────────────────────
  // Refs keep the scheduler off the render dependency list: re-running the
  // effect when the modal opens/closes used to re-arm the prompt timer, so
  // "Skip for now" reopened the dialog seconds later in a loop.
  const lastWellnessCheckRef = useRef(lastWellnessCheck)
  const moodSelectorOpenRef = useRef(showMoodSelector)
  useEffect(() => { lastWellnessCheckRef.current = lastWellnessCheck }, [lastWellnessCheck])
  useEffect(() => { moodSelectorOpenRef.current = showMoodSelector }, [showMoodSelector])

  // After a dismiss, don't ask again for this long.
  const WELLNESS_SNOOZE_MS = 30 * 60 * 1000 // 30 minutes
  const wellnessSnoozeUntilRef = useRef(0)

  useEffect(() => {
    if (!wellnessMode || showOnboarding) return

    const isDue = () => {
      if (Date.now() < wellnessSnoozeUntilRef.current) return false
      // Same anti-spam gate as the manual Wellness Check button.
      if (Date.now() < wellnessCooldownUntilRef.current) return false
      if (moodSelectorOpenRef.current) return false
      const last = lastWellnessCheckRef.current
      if (!last) return true
      return Date.now() - new Date(last).getTime() >= WELLNESS_INTERVAL_MS
    }

    // No immediate prompt on mount — the first check happens after a minute so
    // it can't interrupt the user the moment the dashboard appears.
    const interval = setInterval(() => {
      if (isDue()) setShowMoodSelector(true)
    }, 60000)

    return () => clearInterval(interval)
  }, [wellnessMode, showOnboarding])

  // ── UC-4: camera must be genuinely off while Wellness Mode is active ───────
  // Wellness Mode is defined as camera-free, so the detector releases its
  // VideoCapture handle instead of silently ignoring frames. Re-enabled as soon
  // as the user leaves Wellness Mode.
  useEffect(() => {
    if (window.electronAPI?.setCapture) {
      window.electronAPI.setCapture(!wellnessMode)
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'capture', enabled: !wellnessMode }))
    }
    // The camera is released, so the last camera-derived status is stale.
    // Park the pet on a neutral state instead of a frozen "slouching"/"away".
    if (wellnessMode) setPostureStatus('unknown')
  }, [wellnessMode])

  // ── UC-4 step 2: Operating System Input Monitor (activity only, no content) ─
  // We record timestamps of mouse/keyboard activity to tell whether the user is
  // actually working at the desk. No keystrokes, no text, no window titles.
  const lastActivityRef = useRef(Date.now())
  useEffect(() => {
    const mark = () => { lastActivityRef.current = Date.now() }
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'wheel']
    events.forEach(e => window.addEventListener(e, mark, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, mark))
  }, [])

  // The 15-minute Quick Check scheduler and its hotkey live further down: they
  // depend on the Pomodoro timer state, which is declared after this point.

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

  // ── UC-4 steps 3-4: 15-minute "Quick Check" during an active focus session ──
  // Only prompts when: Wellness Mode is on, the work timer is running, the user
  // has shown recent input activity, and no check is already on screen.
  const quickCheckOpenRef = useRef(showQuickCheck)
  useEffect(() => { quickCheckOpenRef.current = showQuickCheck }, [showQuickCheck])

  useEffect(() => {
    if (!wellnessMode || !isRunning || !isWorkPhase || showOnboarding) return

    const interval = setInterval(() => {
      if (quickCheckOpenRef.current) return
      if (Date.now() - lastActivityRef.current > ACTIVITY_IDLE_MS) return
      setShowQuickCheck(true)
    }, QUICK_CHECK_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [wellnessMode, isRunning, isWorkPhase, showOnboarding])

  // ── UC-4 steps 5-6: self-report hotkey ("Yes, aligned!") ───────────────────
  // Space/Enter confirm while a Quick Check is on screen. Registering only
  // while the prompt is visible keeps it from stealing keys elsewhere.
  useEffect(() => {
    if (!showQuickCheck) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'Enter') {
        e.preventDefault()
        handleQuickCheckConfirm()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showQuickCheck]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── UC-5 (P7): Slouch region score history (camera mode only) ───────────────
  const slouchHistoryRef = useRef<SlouchScores[]>([])
  const latestSlouchScoresRef = useRef<SlouchScores>({ neck: 0, lowerBack: 0, shoulder: 0 })

  const recordSlouchScores = useCallback((scores: SlouchScores) => {
    latestSlouchScoresRef.current = scores
    const history = slouchHistoryRef.current
    history.push(scores)
    if (history.length > SLOUCH_HISTORY_MAX) {
      history.shift()
    }
  }, [])

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
          const debugScores = parseSlouchScores(frame)
          if (debugScores && !wellnessModeRef.current && (s === 'slouching' || postureRef.current === 'slouching')) {
            recordSlouchScores(debugScores)
          }
          return
        }
        const s = parseStatus(data)
        const scores = parseSlouchScores(data)
        if (scores && !wellnessModeRef.current) {
          latestSlouchScoresRef.current = scores
          if (s === 'slouching' || postureRef.current === 'slouching') {
            recordSlouchScores(scores)
          }
        }
        if (s) {
          // UC-1: Detect successful calibration completion
          if (isCalibratingRef.current && s === 'good') {
            completeCalibrationRef.current()
          }
          queueStatus(s)
        }
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
            const debugScores = parseSlouchScores(obj)
            if (debugScores && !wellnessModeRef.current && (s === 'slouching' || postureRef.current === 'slouching')) {
              recordSlouchScores(debugScores)
            }
            return
          }
        } catch {}
        const s = parseStatus(event.data)
        const scores = parseSlouchScores(event.data)
        if (scores && !wellnessModeRef.current) {
          latestSlouchScoresRef.current = scores
          if (s === 'slouching' || postureRef.current === 'slouching') {
            recordSlouchScores(scores)
          }
        }
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
  // Wellness Mode is camera-free: posture is unknown, so the posture tick must
  // never award (or drain) XP there — XP comes only from "I'm Aligned".
  const wellnessModeRef = useRef(wellnessMode)
  useEffect(() => { wellnessModeRef.current = wellnessMode }, [wellnessMode])

  // ── P1: Ctrl+Alt+H hide-to-tray / restore ───────────────────────────────────
  // The main process hides the window to the system tray (win.hide) and sends
  // 'app-hidden'; on the second press (or a tray click) it shows the window
  // again and sends 'app-restored'. This is separate from the dashboard ⇄
  // taskbar widget snap — the layout is left exactly as it was.
  const isRunningRef = useRef(isRunning)
  useEffect(() => { isRunningRef.current = isRunning }, [isRunning])
  // Remembered across a hide so the timer resumes only if it was ticking.
  const timerWasRunningRef = useRef(false)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onAppHidden || !api?.onAppRestored) return

    api.onAppHidden(() => {
      console.log('[renderer] received app-hidden — pausing camera, timer and BGM')
      timerWasRunningRef.current = isRunningRef.current
      setIsRunning(false)
      pauseBGM()
      // Pause the webcam even in camera mode; Wellness Mode already had it off.
      if (api.setCapture) api.setCapture(false)
      else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'capture', enabled: false }))
      }
      // No frames arrive while the window is hidden, so park the pet on a
      // neutral status instead of freezing (and draining) the last one. Drop
      // any pending debounced status first, otherwise it would flush after the
      // hide and overwrite this neutral state while nothing is being captured.
      pendingStatusRef.current = null
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      setPostureStatus('unknown')
    })

    api.onAppRestored(() => {
      console.log('[renderer] received app-restored — restoring camera/timer')
      // Wellness Mode is camera-free, so only re-enable capture outside it.
      if (!wellnessModeRef.current) {
        if (api.setCapture) api.setCapture(true)
        else if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ command: 'capture', enabled: true }))
        }
      }
      // Resume only if the timer was running when the window was hidden.
      if (timerWasRunningRef.current) {
        timerWasRunningRef.current = false
        playBGM()
        setIsRunning(true)
      }
    })
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      if (wellnessModeRef.current) return
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

  // ── UC-5 (P1 & P2): Continuous slouch accumulator + startBreak(reason) ──────
  // Camera-mode only (skipped entirely when wellnessMode is true).
  const [breakOverlay, setBreakOverlay] = useState<{
    reason: string
    stretchName: StretchName
  } | null>(null)
  const slouchElapsedMsRef = useRef(0)

  /**
   * UC-5 (P1): Pause Pomodoro + BGM, pause webcam via setCapture(false), and
   * open the stretch break overlay with the recommended stretch from
   * analyzeSlouchHistory / selectStretch. Does NOT call completePhase (no +25 XP).
   */
  const startBreak = useCallback((reason: string) => {
    if (wellnessModeRef.current) return

    const historySamples =
      slouchHistoryRef.current.length > 0
        ? slouchHistoryRef.current
        : [latestSlouchScoresRef.current]
    const stretchName = analyzeSlouchHistory(historySamples)

    // Reset slouch accumulator and history so it cannot immediately re-trigger
    slouchElapsedMsRef.current = 0
    slouchHistoryRef.current = []

    // Pause Pomodoro + BGM
    setIsRunning(false)
    pauseBGM()

    // Pause webcam via setCapture(false)
    if (window.electronAPI?.setCapture) {
      window.electronAPI.setCapture(false)
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'capture', enabled: false }))
    }

    // Clear any pending debounced posture update while camera is paused
    pendingStatusRef.current = null
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setPostureStatus('unknown')

    setBreakOverlay({ reason, stretchName })
  }, [])

  /**
   * UC-5 (P1): Dismiss the break overlay, restore camera capture via
   * setCapture(!wellnessMode), and leave the timer in a sensible idle state
   * without auto-spamming another break until the slouch accumulator resets.
   */
  const handleFinishStretching = useCallback(() => {
    setBreakOverlay(null)
    slouchElapsedMsRef.current = 0
    slouchHistoryRef.current = []

    const enableCapture = !wellnessModeRef.current
    if (window.electronAPI?.setCapture) {
      window.electronAPI.setCapture(enableCapture)
    } else if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'capture', enabled: enableCapture }))
    }

    // Leave timer in a sensible idle state (paused) so user can resume when ready
    setIsRunning(false)
  }, [])

  // Reset the slouch accumulator & history whenever Wellness Mode is enabled
  // or postureStatus returns to 'good', 'away', or 'unknown'.
  useEffect(() => {
    if (wellnessMode || postureStatus !== 'slouching') {
      slouchElapsedMsRef.current = 0
      slouchHistoryRef.current = []
    }
  }, [wellnessMode, postureStatus])

  // UC-5 (P2): While isRunning && isWorkPhase && postureStatus === 'slouching'
  // (in camera mode only), accumulate elapsed slouch time and sample region
  // scores. At 5 * 60 * 1000 ms continuous slouch, call startBreak('Persistent Slouch').
  useEffect(() => {
    if (wellnessMode || !isRunning || !isWorkPhase || postureStatus !== 'slouching' || breakOverlay !== null) {
      return
    }

    const id = window.setInterval(() => {
      if (wellnessModeRef.current || postureRef.current !== 'slouching') {
        slouchElapsedMsRef.current = 0
        slouchHistoryRef.current = []
        return
      }
      recordSlouchScores(latestSlouchScoresRef.current)
      slouchElapsedMsRef.current += SLOUCH_ACCUM_TICK_MS
      if (slouchElapsedMsRef.current >= SLOUCH_AUTO_BREAK_MS) {
        slouchElapsedMsRef.current = 0
        startBreak('Persistent Slouch')
      }
    }, SLOUCH_ACCUM_TICK_MS)

    return () => window.clearInterval(id)
  }, [wellnessMode, isRunning, isWorkPhase, postureStatus, breakOverlay, recordSlouchScores, startBreak])

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

  /** Stop the timer and always return to a fresh Work phase (no XP awarded). */
  const handleReset = () => {
    setIsRunning(false)
    pauseBGM()
    playReset()
    setIsWorkPhase(true)
    setTimeLeft(workDuration * 60)
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
   *  A newly adopted dog starts in its base form and can evolve again.
   *  Only health, XP and the evolved flags are reset here:
   *   - The equipped accessory (posturepet_accessory) is kept — never reset to
   *     'none' on death, evolution or adoption.
   *   - Wellness data (wellness-* keys, mood, last check, cooldown) is user
   *     habit data, independent of the pet's life, and is never cleared here. */
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

  // ── Wellness mode handlers ──────────────────────────────────────────────────
  /** Open the manual Wellness Check — blocked while the shared cooldown runs. */
  const handleOpenWellnessCheck = () => {
    if (Date.now() < wellnessCooldownUntilRef.current) return
    playToggle()
    setShowMoodSelector(true)
  }

  const handleMoodSelect = (mood: 'happy' | 'neutral' | 'sad') => {
    playPop()
    setCurrentMood(mood)
    setLastWellnessCheck(new Date().toISOString())
    // Completing a check starts the shared cooldown so it can't be spammed.
    tryStartWellnessCooldown()

    if (mood === 'happy' || mood === 'neutral') {
      // Trigger pet's happy animation
      window.dispatchEvent(new CustomEvent('pet:notify'))
    }

    // Set encouragement message
    setWellnessMessage(getWellnessMessage(mood))
    setShowMoodSelector(false)
  }

  // The encouragement toast is transient: it fades out on its own so it can
  // never pile up or sit on top of the dashboard indefinitely.
  useEffect(() => {
    if (!wellnessMessage) return
    const timer = window.setTimeout(() => setWellnessMessage(null), 4000)
    return () => window.clearTimeout(timer)
  }, [wellnessMessage])

  const handleSkipWellnessCheck = () => {
    playPop()
    setShowMoodSelector(false)
    setWellnessMessage(null)
    // Snooze so the scheduler doesn't immediately re-open the dialog.
    wellnessSnoozeUntilRef.current = Date.now() + WELLNESS_SNOOZE_MS
  }

  const handleCloseWellnessMessage = () => {
    setWellnessMessage(null)
  }

  // ── UC-4 steps 5-6: award flat pet XP and let the pet respond ──────────────
  // "I'm Aligned" / "Yes, aligned!" pays a flat ALIGNED_XP — this path never
  // touches the camera. It shares the anti-spam cooldown with Wellness Check;
  // presses during the cooldown are ignored.
  const handleQuickCheckConfirm = () => {
    if (!tryStartWellnessCooldown()) return
    playPop()
    setXp(prev => prev + ALIGNED_XP)
    setShowQuickCheck(false)
    // Drives the pet's one-shot "thumbs-up" (attack/reaction) animation.
    window.dispatchEvent(new CustomEvent('pet:notify'))
    setWellnessMessage(`Aligned — +${ALIGNED_XP} XP`)
  }

  const handleQuickCheckDismiss = () => {
    playPop()
    setShowQuickCheck(false)
  }

  const getWellnessMessage = (mood: 'happy' | 'neutral' | 'sad'): string => {
    const messages: Record<typeof mood, string[]> = {
      happy: [
        "That's wonderful! Keep up the great energy!",
        'Amazing! Your positivity is contagious!',
        'So glad to hear it! You are doing great!',
      ],
      neutral: [
        'Thanks for checking in! Steady progress counts!',
        'Appreciate you sharing! Small steps matter!',
        'Got it! Remember to take breaks when needed!',
      ],
      sad: [
        "It's okay to have tough days. You've got this!",
        'Thanks for being honest. Take care of yourself!',
        'Sending good vibes your way! Better days ahead!',
      ],
    }
    const moodMessages = messages[mood]
    return moodMessages[Math.floor(Math.random() * moodMessages.length)]
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
    const frames = activeCustomPet
      ? (activeCustomPet.manifest.animations.death?.frames ?? 3)
      : activeBuiltinModel === 'cat'
        ? ANIMATION_FRAMES.Death
        : isEvolved
          ? EVOLVED_ANIMATION_FRAMES.Death
          : ANIMATION_FRAMES.Death
    const frameMs = activeCustomPet
      ? (activeCustomPet.manifest.animations.death?.frameDurationMs ?? EVOLUTION_FRAME_MS)
      : EVOLUTION_FRAME_MS
    const timer = setTimeout(() => setDeathFrozen(true), frames * frameMs)
    return () => clearTimeout(timer)
  }, [isDead, isEvolved, activeBuiltinModel, activeCustomPet])

  // Compute level and XP progress from the total accumulated XP.
  // xp is now the CUMULATIVE total (not per-level), computed via getLevelProgress.
  const levelData = getLevelProgress(xp)

  const effectiveIsEvolved = canCurrentPetEvolve && isEvolved
  const effectiveIsEvolving = canCurrentPetEvolve && isEvolving

  useEffect(() => {
    if (!canCurrentPetEvolve && isEvolving) {
      setIsEvolving(false)
    }
  }, [canCurrentPetEvolve, isEvolving])

  // ── Level 10 evolution — manual trigger (Original Dog only) ───────────────
  // The pet reaches Level 10 passively through XP, but the evolution is
  // USER-initiated via the "Evolve" button. Pixel Cat and custom pets cannot evolve.
  const triggerEvolution = () => {
    if (!canCurrentPetEvolve || isEvolved || isEvolving) return
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
  // sprite animation finishes.
  const handleEvolutionAnimEnd = () => {
    if (!canCurrentPetEvolve) {
      setIsEvolving(false)
      return
    }
    setIsEvolving(false)
    setIsEvolved(true)
  }

  // ── Render based on mode ────────────────────────────────────────────────────

  if (mode === 'taskbar') {
    // Taskbar mode: the wrapper must fill the small Electron window exactly
    // (w-screen h-screen) so nothing gets clipped by the window edges. Content
    // is centered in a column — the pet circle on top, the timer below.
    return (
      <div className="relative w-screen h-screen flex flex-col items-center justify-center gap-1 overflow-hidden m-0 p-0 bg-transparent select-none">
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
            isEvolving={effectiveIsEvolving}
            isEvolved={effectiveIsEvolved}
            deathFrozen={deathFrozen}
            petLevel={levelData.level}
            onEvolve={triggerEvolution}
            onEvolutionAnimEnd={handleEvolutionAnimEnd}
            wellnessMode={wellnessMode}
            onSelfReport={handleQuickCheckConfirm}
            selfReportCooldown={wellnessCooldownLeft}
            petModel={activeBuiltinModel ?? 'dog'}
            customPet={activeCustomPet}
          />
        </div>

        {/* Timer + controls — centered below the pet */}
        <div className="flex flex-col items-center gap-0.5 min-w-0">
          {/* Phase label + countdown — compact themed chip (matches the
              bg-primary / bg-muted control buttons) so it stays legible on
              a light or transparent window */}
          <div className="flex flex-col items-center gap-0.5 rounded-md bg-primary text-primary-foreground px-1.5 py-0.5 min-w-0">
            <span className="text-[9px] font-bold leading-none truncate opacity-80">
              {isWorkPhase ? 'Work' : 'Break'}
            </span>
            <span className="text-lg font-bold tabular-nums leading-none">
              {formatTime(timeLeft)}
            </span>
          </div>

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

        {/* UC-5: Stretch Break overlay in taskbar widget mode */}
        <StretchBreakModal
          open={breakOverlay !== null && !wellnessMode}
          reason={breakOverlay?.reason ?? 'Persistent Slouch'}
          stretchName={breakOverlay?.stretchName ?? 'Shoulder Opener'}
          mode="taskbar"
          onFinishedStretching={handleFinishStretching}
        />

        {/* UC-4 step 3: the Quick Check prompt is a floating notification on the
            widget itself — the small window can't host the full modal. */}
        {showQuickCheck && wellnessMode && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-background/95 px-2 text-center animate-in fade-in duration-150">
            <span className="text-[11px] font-semibold leading-tight text-foreground">
              Quick Check
            </span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              Sitting up straight?
            </span>
            <button
              onClick={handleQuickCheckConfirm}
              disabled={wellnessCooldownLeft > 0}
              className="mt-0.5 rounded-full bg-primary px-3 py-1 text-[10px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {wellnessCooldownLeft > 0 ? `Wait ${wellnessCooldownLeft}s` : 'Yes, aligned!'}
            </button>
            <button
              onClick={handleQuickCheckDismiss}
              className="text-[9px] text-muted-foreground underline hover:text-foreground"
            >
              Not now
            </button>
          </div>
        )}
      </div>
    )
  }

  // Dashboard mode: Shadcn Card shell with timer, XP, pet, and controls
  return (
    <Card
      className="h-screen w-screen overflow-hidden flex flex-col border-none rounded-none bg-background text-foreground shadow-none p-4 animate-in fade-in duration-300"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Draggable header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <h1 className="text-sm font-semibold">PosturePet</h1>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            2.0
          </span>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { playToggle(); setHelpOpen(true) }}
            title="How PosturePet works"
            aria-label="Help"
            className="text-sm font-semibold"
          >
            ?
          </Button>
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
          {/* Wellness mode section */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FlowerIcon className={`size-3.5 ${wellnessMode ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={`text-xs font-medium ${wellnessMode ? 'text-foreground' : 'text-muted-foreground'}`}>
                  Wellness Mode
                </span>
              </div>
              <button
                type="button"
                onClick={() => { playToggle(); setWellnessMode(w => !w) }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  wellnessMode ? 'bg-primary' : 'bg-border'
                }`}
                aria-label="Toggle wellness mode"
                title={wellnessMode ? 'Disable wellness reminders' : 'Enable wellness reminders'}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-background shadow-sm transition-transform ${
                    wellnessMode ? 'translate-x-4' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {/* Manual check — shares the anti-spam cooldown with I'm Aligned */}
            {wellnessMode && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 w-full px-2 text-xs"
                onClick={handleOpenWellnessCheck}
                disabled={wellnessCooldownLeft > 0}
                title={wellnessCooldownLeft > 0 ? `Available in ${wellnessCooldownLeft}s` : 'Log how you feel'}
              >
                {wellnessCooldownLeft > 0 ? `Wellness Check (${wellnessCooldownLeft}s)` : 'Wellness Check'}
              </Button>
            )}
          </div>
          {/* Pet Selector, Wardrobe & Experimental Create Your Own Pet controls */}
          <div className="flex flex-col gap-2 pt-1.5 border-t border-slate-200/80">
            <div className="flex items-center justify-between gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs h-7 px-2.5"
                onClick={() => { playToggle(); setPetSelectorOpen(true) }}
                title="Switch between built-in and custom pets"
              >
                <span className="truncate max-w-[120px]">
                  {activeCustomPet
                    ? activeCustomPet.manifest.name
                    : activeBuiltinModel === 'cat'
                      ? 'Pixel Cat'
                      : 'Original Dog'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({customPets.length + 2})
                </span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-xs h-7 px-2.5"
                onClick={() => { playToggle(); setWardrobeOpen(true) }}
              >
                <PaletteIcon className="size-3.5" />
                Wardrobe
              </Button>
            </div>

            {/* Experimental Feature: Create Your Own Pet */}
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-300/70 bg-amber-50/60 px-2.5 py-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="rounded-full bg-amber-200/90 text-amber-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide shrink-0">
                  Experimental
                </span>
                <span className="text-[11px] font-medium text-amber-950 truncate">
                  Make Your Own Pet
                </span>
              </div>
              <Button
                size="sm"
                variant="default"
                className="gap-1 text-[11px] h-6 px-2 shrink-0"
                onClick={() => { playToggle(); setCreatePetOpen(true) }}
              >
                <SparkleIcon className="size-3" />
                Create Your Own Pet
              </Button>
            </div>
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
          isEvolving={effectiveIsEvolving}
          isEvolved={effectiveIsEvolved}
          deathFrozen={deathFrozen}
          petLevel={levelData.level}
          onEvolve={triggerEvolution}
          onEvolutionAnimEnd={handleEvolutionAnimEnd}
          wellnessMode={wellnessMode}
          onSelfReport={handleQuickCheckConfirm}
          selfReportCooldown={wellnessCooldownLeft}
          petModel={activeBuiltinModel ?? 'dog'}
          customPet={activeCustomPet}
        />

        {/* Create Your Own Pet modal */}
        <CreatePetModal
          open={createPetOpen}
          onClose={() => setCreatePetOpen(false)}
          onPetInstalled={handlePetInstalled}
        />

        {/* Pet Selector modal */}
        <PetSelectorModal
          open={petSelectorOpen}
          selectedPetId={selectedPetId}
          customPets={customPets}
          onSelectPet={(id) => setSelectedPetId(id)}
          onDeletePet={handleDeleteCustomPet}
          onOpenCreateModal={() => setCreatePetOpen(true)}
          onClose={() => setPetSelectorOpen(false)}
        />

        {/* Wardrobe modal */}
        <WardrobeModal
          open={wardrobeOpen}
          petLevel={levelData.level}
          isEvolved={effectiveIsEvolved}
          selectedAccessory={selectedAccessory}
          onSelect={(id) => {
            setSelectedAccessory(id)
            setWardrobeOpen(false)
          }}
          onClose={() => setWardrobeOpen(false)}
        />

        {/* UC-5: Stretch Break modal (camera-mode only) */}
        <StretchBreakModal
          open={breakOverlay !== null && !wellnessMode}
          reason={breakOverlay?.reason ?? 'Persistent Slouch'}
          stretchName={breakOverlay?.stretchName ?? 'Shoulder Opener'}
          mode="dashboard"
          onFinishedStretching={handleFinishStretching}
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
          onAddXp={() =>
            setXp((prev) => {
              const { level } = getLevelProgress(prev)
              return prev + Math.max(500, getXpRequiredForLevel(level))
            })
          }
          onDamage={() => setHealth(prev => Math.max(0, prev - 25))}
        />

        {/* Wellness mode mood selector modal */}
        {showMoodSelector && wellnessMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-150">
            <div className="relative z-10 w-full max-w-[calc(100%-2rem)] mx-4 rounded-xl border bg-card text-card-foreground shadow-xl animate-in zoom-in-95 fade-in duration-150">
              {/* Header */}
              <div className="px-5 pt-5 pb-4 border-b border-border">
                <h2 className="text-sm font-semibold leading-none">Wellness Check-in</h2>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  How are you feeling right now?
                </p>
              </div>

              {/* Mood selection */}
              <div className="grid grid-cols-3 gap-3 p-4">
                {([
                  { id: 'happy',   label: 'Good',  tone: 'text-emerald-600' },
                  { id: 'neutral', label: 'Okay',  tone: 'text-amber-600' },
                  { id: 'sad',     label: 'Bad',   tone: 'text-sky-600' },
                ] as const).map(({ id, label, tone }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleMoodSelect(id)}
                    className="group flex flex-col items-center gap-2 py-3 px-2 rounded-xl border border-border transition-all hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={label}
                  >
                    <svg className={`w-7 h-7 ${tone}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                      <circle cx="12" cy="12" r="9.5" />
                      {id === 'happy'   && <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />}
                      {id === 'neutral' && <path d="M8.5 15h7" />}
                      {id === 'sad'     && <path d="M8.5 16.5c.9-1.2 2.1-1.8 3.5-1.8s2.6.6 3.5 1.8" />}
                      <path d="M9.5 9.5h.01M14.5 9.5h.01" />
                    </svg>
                    <span className="text-xs font-medium text-foreground">{label}</span>
                  </button>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 pb-5 pt-1">
                <span className="text-[11px] text-muted-foreground">
                  {wellnessCooldownLeft > 0
                    ? `Next check in ${wellnessCooldownLeft}s`
                    : `${WELLNESS_COOLDOWN_S / 60} min cooldown after each check`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={handleSkipWellnessCheck}
                >
                  Skip
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* UC-4 step 3-4: floating "Quick Check" prompt during a focus session */}
        {showQuickCheck && wellnessMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-150">
            <div className="relative z-10 w-full max-w-[calc(100%-2rem)] mx-4 rounded-xl border bg-card text-card-foreground shadow-xl animate-in zoom-in-95 fade-in duration-150">
              <div className="px-5 pt-5 pb-4 border-b border-border">
                <h2 className="text-sm font-semibold leading-none">Quick Check</h2>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Are you sitting up straight?
                </p>
              </div>
              <div className="p-5">
                <div className="flex flex-col gap-2">
                  <Button onClick={handleQuickCheckConfirm} disabled={wellnessCooldownLeft > 0}>
                    {wellnessCooldownLeft > 0 ? `Wait ${wellnessCooldownLeft}s` : 'Yes, aligned!'}
                  </Button>
                  <Button variant="outline" onClick={handleQuickCheckDismiss}>
                    Not right now
                  </Button>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground text-center">
                  Press Space or Enter to confirm. +{ALIGNED_XP} XP.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Help legend — how HP/XP, posture states and Wellness Mode work */}
        {helpOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-150"
            onClick={() => setHelpOpen(false)}
          >
            <Card
              className="relative z-10 w-full max-w-[calc(100%-2rem)] mx-4 gap-0 p-0 shadow-xl animate-in zoom-in-95 fade-in duration-150"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-title"
            >
              <div className="px-5 pt-5 pb-3 border-b border-border">
                <h2 id="help-title" className="text-sm font-semibold leading-none">How PosturePet works</h2>
              </div>
              <ul className="flex flex-col gap-2.5 px-5 py-4 text-xs leading-relaxed text-muted-foreground">
                <li>
                  <span className="font-semibold text-foreground">HP &amp; XP</span> — Good posture earns XP
                  and restores HP; slouching drains both. (Camera mode only.)
                </li>
                <li>
                  <span className="font-semibold text-foreground">Away</span> — No person in the camera
                  frame. HP and XP pause.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Slouch</span> — Hurts your pet and the
                  screen flashes / glows red.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Wellness Mode</span> — The camera is off,
                  so posture is not tracked and earns no XP. Press <em>I'm Aligned</em> to earn
                  +{ALIGNED_XP} XP.
                </li>
                <li>
                  <span className="font-semibold text-foreground">Cooldown</span> — <em>I'm Aligned</em> and{' '}
                  <em>Wellness Check</em> share a {WELLNESS_COOLDOWN_S}-second ({WELLNESS_COOLDOWN_S / 60} min)
                  cooldown. Neither can be spammed; the buttons show the seconds remaining.
                </li>
              </ul>
              <div className="flex justify-end px-5 pb-5">
                <Button size="sm" onClick={() => { playPop(); setHelpOpen(false) }}>
                  Got it
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Wellness encouragement toast */}
        {wellnessMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-2 fade-in duration-200">
            <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-lg">
              <span className="text-xs font-medium text-card-foreground">{wellnessMessage}</span>
              <button
                onClick={handleCloseWellnessMessage}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Dismiss"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* First-time onboarding — UC-1: calibration & camera configuration */}
        {showOnboarding && (
          <div
            className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 ${
              onboardingLeaving
                ? 'animate-out fade-out duration-300'
                : 'animate-in fade-in duration-150'
            }`}
          >
            <div
              className={`relative z-10 w-full max-w-[calc(100%-2rem)] mx-4 rounded-xl border bg-card text-card-foreground shadow-xl overflow-hidden ${
                onboardingLeaving
                  ? 'animate-out zoom-out-95 fade-out duration-300'
                  : 'animate-in zoom-in-95 fade-in duration-200'
              }`}
            >
              {/* Header */}
              <div className="px-5 pt-5 pb-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <FlowerIcon className="size-4 text-primary" />
                  <h2 className="text-sm font-semibold leading-none">Set up PosturePet</h2>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {cameraDenied
                    ? 'Wellness Mode tracks habits without a camera.'
                    : 'Calibrate your neutral posture once. Everything stays on this device.'}
                </p>
              </div>

              <div className="p-5">
                {!cameraDenied ? (
                  <>
                    {/* Steps */}
                    <ol className="space-y-2.5 mb-4">
                      {[
                        'Sit in your normal working position',
                        'Face the screen with even lighting',
                        'Keep shoulders relaxed, back straight',
                      ].map((text, i) => (
                        <li key={text} className="flex items-start gap-2.5">
                          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                            {i + 1}
                          </span>
                          <span className="text-xs leading-relaxed text-foreground">{text}</span>
                        </li>
                      ))}
                    </ol>

                    {/* Calibration failure */}
                    {calibrationError && (
                      <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                        <p className="text-xs font-medium text-destructive">{calibrationError}</p>
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <Button onClick={startCalibration} disabled={isCalibrating}>
                        {isCalibrating ? 'Calibrating…' : 'Start Calibration'}
                      </Button>
                      <Button variant="outline" onClick={handleCameraDenied}>
                        Continue Without Camera
                      </Button>
                    </div>

                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground text-center">
                      Camera frames are processed locally and never stored or transmitted.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mb-4 text-xs leading-relaxed text-foreground">
                      PosturePet will use keyboard and mouse activity to tell when you're at
                      your desk, and send periodic check-ins instead of camera prompts.
                    </p>
                    <Button
                      onClick={() => {
                        setWellnessMode(true)
                        completeCalibration()
                        setPostureStatus('unknown')
                      }}
                    >
                      Get Started
                    </Button>
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground text-center">
                      Webcam hardware stays unpowered in this mode.
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

export default App
