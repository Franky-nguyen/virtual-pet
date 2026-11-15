/**
 * Advanced BGM manager for PosturePet.
 *
 * - Playlist of `.ogg` tracks in `src/assets/music/music.ogg/` sorted
 *   deterministically by filename, with the first track (`Afternoon-Classes`)
 *   pinned at the head on cold start, then randomized shuffles on subsequent
 *   cycles without back-to-back repeats across cycle boundaries.
 * - Two `<audio>` players (`playerA`, `playerB`) crossfade 3 seconds before
 *   each track ends (with an `'ended'` fallback), then swap roles.
 * - `playBGM()` resumes the paused player if a track is already loaded — it does
 *   NOT rebuild the queue or reset the queue index, preserving the current track
 *   across app pause/resume cycles.
 * - Exports `playBGM()`, `pauseBGM()`, `skipTrack()`, `setVolume()`,
 *   `getVolume()`, `isBGMPlaying()`, `suspendBGMForOverlay()`, and
 *   `resumeBGMFromOverlay()`.
 */

const trackModules = import.meta.glob('../assets/music/music.ogg/*.ogg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const TRACKS: string[] = Object.entries(trackModules)
  .sort(([pathA], [pathB]) => pathA.localeCompare(pathB))
  .map(([, url]) => url)

const MASTER_VOLUME = 0.5
const CROSSFADE_SECONDS = 3
const BGM_VOLUME_STORAGE_KEY = 'bgm-volume'

function loadSavedVolume(): number {
  try {
    const raw = localStorage.getItem(BGM_VOLUME_STORAGE_KEY)
    if (raw === null) return MASTER_VOLUME
    const parsed = parseFloat(raw)
    if (!Number.isFinite(parsed)) return MASTER_VOLUME
    return Math.max(0, Math.min(1, parsed))
  } catch {
    return MASTER_VOLUME
  }
}

let currentVolume = loadSavedVolume()

const playerA = new Audio()
const playerB = new Audio()
playerA.volume = currentVolume
playerB.volume = currentVolume
playerA.preload = 'metadata'
playerB.preload = 'none'

let activePlayer: HTMLAudioElement = playerA
let standbyPlayer: HTMLAudioElement = playerB

let queue: string[] = []
let queueIndex = 0
let lastQueuedTrack: string | null = null
let isPlaying = false
let isCrossfading = false
let suspendedForOverlay = false
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
 * Build a fresh queue:
 * - On initial start (`pinFirstTrack = true`), `TRACKS[0]` is pinned first,
 *   followed by a shuffled copy of the remaining tracks.
 * - On playlist wrap-around (`pinFirstTrack = false`), all tracks are shuffled
 *   and the head is prevented from repeating `lastQueuedTrack` back-to-back.
 */
function regenerateQueue(pinFirstTrack: boolean): void {
  if (TRACKS.length === 0) {
    queue = []
    queueIndex = 0
    return
  }

  if (pinFirstTrack) {
    const first = TRACKS[0]
    const rest = TRACKS.length > 1 ? shuffle(TRACKS.slice(1)) : []
    queue = [first, ...rest]
  } else {
    queue = shuffle(TRACKS)
    if (queue.length > 1 && lastQueuedTrack && queue[0] === lastQueuedTrack) {
      ;[queue[0], queue[1]] = [queue[1], queue[0]]
    }
  }
  queueIndex = 0
}

/**
 * Pull the next track from the queue and immediately advance `queueIndex`,
 * wrapping cleanly to a newly shuffled queue once the current cycle finishes.
 */
function dequeueNextTrack(pinFirstIfEmpty = false): string {
  if (queue.length === 0 || queueIndex >= queue.length) {
    regenerateQueue(queue.length === 0 && pinFirstIfEmpty)
  }
  const track = queue[queueIndex++] ?? TRACKS[0]
  lastQueuedTrack = track
  if (queueIndex >= queue.length) {
    regenerateQueue(false)
  }
  return track
}

function attachListeners(player: HTMLAudioElement): void {
  player.addEventListener('timeupdate', handleTimeUpdate)
  player.addEventListener('ended', handleEnded)
}

function detachListeners(player: HTMLAudioElement): void {
  player.removeEventListener('timeupdate', handleTimeUpdate)
  player.removeEventListener('ended', handleEnded)
}

function clearFadeInterval(): void {
  if (fadeInterval) {
    clearInterval(fadeInterval)
    fadeInterval = null
  }
}

/** Crossfade from the active player to the standby player over CROSSFADE_SECONDS. */
function startCrossfade(): void {
  if (!isPlaying || TRACKS.length === 0) return

  // If a prior crossfade is still in flight (e.g. rapid Skip Track click),
  // stop the old outgoing standby player cleanly without volume-spiking activePlayer.
  if (fadeInterval) {
    clearFadeInterval()
    standbyPlayer.pause()
    standbyPlayer.currentTime = 0
  }

  isCrossfading = true

  // Pull next track immediately so rapid skips always advance cleanly.
  const nextTrack = dequeueNextTrack(false)
  standbyPlayer.pause()
  standbyPlayer.src = nextTrack
  standbyPlayer.currentTime = 0
  standbyPlayer.volume = 0

  // Move listeners from the outgoing player to the incoming active player.
  detachListeners(activePlayer)
  const oldPlayer = activePlayer
  const newActive = standbyPlayer
  activePlayer = newActive
  standbyPlayer = oldPlayer
  attachListeners(newActive)

  newActive.play().catch(() => { /* autoplay blocked */ })

  // 60Hz fade, normalized 0..1 over CROSSFADE_SECONDS using live currentVolume.
  const startTime = performance.now()
  const durationMs = CROSSFADE_SECONDS * 1000
  const startOldVol = oldPlayer.volume

  fadeInterval = setInterval(() => {
    const elapsed = performance.now() - startTime
    const t = Math.min(1, elapsed / durationMs)
    const liveVol = currentVolume
    const oldCap = Math.min(startOldVol, liveVol)
    oldPlayer.volume = Math.max(0, oldCap * (1 - t))
    newActive.volume = liveVol * t
    if (t >= 1) {
      clearFadeInterval()
      isCrossfading = false
      oldPlayer.pause()
      oldPlayer.currentTime = 0
      oldPlayer.volume = liveVol
      newActive.volume = liveVol
    }
  }, 16)
}

function handleTimeUpdate(this: HTMLAudioElement): void {
  // Crossfade 3 seconds before the track ends.
  if (
    !isCrossfading &&
    isPlaying &&
    Number.isFinite(this.duration) &&
    this.duration > 0 &&
    this.currentTime >= this.duration - CROSSFADE_SECONDS
  ) {
    startCrossfade()
  }
}

function handleEnded(this: HTMLAudioElement): void {
  // Fallback in case background throttling skipped the final timeupdate window.
  if (!isCrossfading && isPlaying) {
    startCrossfade()
  }
}

function stopPlayback(): void {
  isPlaying = false
  isCrossfading = false
  clearFadeInterval()
  detachListeners(playerA)
  detachListeners(playerB)
  playerA.pause()
  playerB.pause()
  activePlayer.volume = currentVolume
  standbyPlayer.currentTime = 0
}

export function playBGM(): void {
  if (TRACKS.length === 0) return
  suspendedForOverlay = false

  if (!isPlaying) {
    // If a track is already loaded and paused, just resume — don't reset queue/index.
    if (activePlayer.src && activePlayer.paused) {
      isCrossfading = false
      activePlayer.volume = currentVolume
      attachListeners(activePlayer)
      activePlayer.play().catch(() => { /* autoplay blocked */ })
      isPlaying = true
      return
    }

    // Cold start: dequeue track 0 and advance queueIndex to 1 immediately.
    const firstTrack = dequeueNextTrack(true)
    detachListeners(playerA)
    detachListeners(playerB)
    activePlayer = playerA
    standbyPlayer = playerB
    isCrossfading = false
    activePlayer.src = firstTrack
    activePlayer.currentTime = 0
    activePlayer.volume = currentVolume
    attachListeners(activePlayer)
    activePlayer.play().catch(() => { /* autoplay blocked */ })
    isPlaying = true
  }
}

export function pauseBGM(): void {
  // Always cancel any pending overlay resume so closing a modal won't restart
  // music after timer completion, reset, break, or pet death.
  suspendedForOverlay = false
  if (!isPlaying) return
  stopPlayback()
}

export function suspendBGMForOverlay(): boolean {
  if (!isPlaying) {
    suspendedForOverlay = false
    return false
  }
  stopPlayback()
  suspendedForOverlay = true
  return true
}

export function resumeBGMFromOverlay(): void {
  if (!suspendedForOverlay) return
  suspendedForOverlay = false
  playBGM()
}

export function skipTrack(): void {
  if (!isPlaying || TRACKS.length === 0) return
  startCrossfade()
}

export function setVolume(v: number): void {
  currentVolume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : MASTER_VOLUME
  try {
    localStorage.setItem(BGM_VOLUME_STORAGE_KEY, String(currentVolume))
  } catch {
    // Ignore storage quota / privacy mode errors
  }
  if (!isCrossfading) {
    activePlayer.volume = currentVolume
  }
}

export function getVolume(): number {
  return currentVolume
}

export function isBGMPlaying(): boolean {
  return isPlaying
}
