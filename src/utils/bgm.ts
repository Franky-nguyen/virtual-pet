/**
 * Advanced BGM manager for PosturePet.
 *
 * - Playlist of `.ogg` tracks in `src/assets/music/music.ogg/` with the first
 *   track always pinned at the head, followed by a randomized shuffle.
 * - Two `<audio>` players (`playerA`, `playerB`) crossfade 3 seconds before
 *   each track ends, then swap roles.
 * - `playBGM()` resumes the paused player if a track is already loaded — it does
 *   NOT rebuild the queue or reset the queue index, preserving the current track
 *   across app minimize/restore cycles.
 * - Exports `playBGM()`, `pauseBGM()`, `skipTrack()`, `setVolume()`, `getVolume()`.
 */

const trackModules = import.meta.glob('../assets/music/music.ogg/*.ogg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const TRACKS: string[] = Object.values(trackModules)

const MASTER_VOLUME = 0.5
const CROSSFADE_SECONDS = 3

const playerA = new Audio()
const playerB = new Audio()
playerA.volume = MASTER_VOLUME
playerB.volume = MASTER_VOLUME
playerA.preload = 'metadata'
playerB.preload = 'none'

let activePlayer: HTMLAudioElement = playerA
let standbyPlayer: HTMLAudioElement = playerB

let queue: string[] = []
let queueIndex = 0
let isPlaying = false
let currentVolume = 0.5
let fadeInterval: ReturnType<typeof setInterval> | null = null

/** Fisher-Yates shuffle — returns a new array, leaves input untouched. */
function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Build a fresh queue: TRACKS[0] pinned first, then a shuffled copy of the
 * remaining tracks. If there's only one track, returns a single-element queue.
 */
function regenerateQueue(): void {
  if (TRACKS.length === 0) {
    queue = []
    queueIndex = 0
    return
  }
  const first = TRACKS[0]
  const rest = TRACKS.length > 1 ? shuffle(TRACKS.slice(1)) : []
  queue = [first, ...rest]
  queueIndex = 0
}

/** Crossfade from the active player to the standby player over CROSSFADE_SECONDS. */
function startCrossfade(): void {
  if (fadeInterval) {
    clearInterval(fadeInterval)
    fadeInterval = null
  }

  // Pre-arm the standby player.
  const nextTrack = queue[queueIndex] ?? TRACKS[0]
  standbyPlayer.src = nextTrack
  standbyPlayer.currentTime = 0
  standbyPlayer.volume = 0

  // Remove the listener from the player we're about to retire; attach to the new
  // active player so the next track also gets the crossfade trigger.
  activePlayer.removeEventListener('timeupdate', handleTimeUpdate)
  const newActive = standbyPlayer
  activePlayer = newActive
  standbyPlayer = newActive === playerA ? playerB : playerA
  newActive.addEventListener('timeupdate', handleTimeUpdate)

  newActive.play().catch(() => { /* autoplay blocked */ })

  // 60Hz fade, normalized 0..1 over CROSSFADE_SECONDS.
  const startTime = performance.now()
  const durationMs = CROSSFADE_SECONDS * 1000
  const oldPlayer = newActive === playerA ? playerB : playerA
  const oldVolume = oldPlayer.volume
  const newVolume = currentVolume

  fadeInterval = setInterval(() => {
    const elapsed = performance.now() - startTime
    const t = Math.min(1, elapsed / durationMs)
    oldPlayer.volume = Math.max(0, oldVolume * (1 - t))
    newActive.volume = newVolume * t
    if (t >= 1) {
      if (fadeInterval) {
        clearInterval(fadeInterval)
        fadeInterval = null
      }
      oldPlayer.pause()
      oldPlayer.volume = oldVolume
      newActive.volume = newVolume
      // Queue advance happens here so skipTrack() can manually call this and
      // the order stays consistent.
      queueIndex++
      if (queueIndex >= queue.length) {
        regenerateQueue()
      }
    }
  }, 16)
}

function handleTimeUpdate(this: HTMLAudioElement): void {
  // Crossfade 3 seconds before the track ends.
  if (this.duration > 0 && this.currentTime >= this.duration - CROSSFADE_SECONDS) {
    startCrossfade()
  }
}

export function playBGM(): void {
  if (TRACKS.length === 0) return

  if (!isPlaying) {
    // If a track is already loaded and paused, just resume — don't reset queue/index.
    if (activePlayer.src && activePlayer.paused) {
      activePlayer.addEventListener('timeupdate', handleTimeUpdate)
      activePlayer.play().catch(() => { /* autoplay blocked */ })
      isPlaying = true
      return
    }

    // Cold start: build queue and load the first track.
    if (queue.length === 0) regenerateQueue()
    queueIndex = 0
    activePlayer.removeEventListener('timeupdate', handleTimeUpdate)
    activePlayer = playerA
    standbyPlayer = playerB
    activePlayer.src = queue[queueIndex]
    activePlayer.currentTime = 0
    activePlayer.volume = currentVolume
    activePlayer.addEventListener('timeupdate', handleTimeUpdate)
    activePlayer.play().catch(() => { /* autoplay blocked */ })
    isPlaying = true
  }
}

export function pauseBGM(): void {
  if (!isPlaying) return
  isPlaying = false
  activePlayer.removeEventListener('timeupdate', handleTimeUpdate)
  playerA.pause()
  playerB.pause()
  if (fadeInterval) {
    clearInterval(fadeInterval)
    fadeInterval = null
  }
}

export function skipTrack(): void {
  if (!isPlaying || TRACKS.length === 0) return
  startCrossfade()
}

export function setVolume(v: number): void {
  currentVolume = Math.max(0, Math.min(1, v))
  if (isPlaying) {
    activePlayer.volume = currentVolume
  }
}

export function getVolume(): number {
  return currentVolume
}
