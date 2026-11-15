/**
 * Persistent Pet Lifecycle, Posture/Session History, and Dashboard Statistics.
 *
 * All writes use versioned localStorage keys so schema changes stay isolated and
 * existing saves migrate safely without data loss or duplicate grave records.
 */

export const STORAGE_KEYS = {
  ACTIVE_LIFE: 'posturepet-active-life-v1',
  GRAVES: 'posturepet-graves-v1',
  POSTURE_HISTORY: 'posturepet-posture-history-v1',
  SESSION_HISTORY: 'posturepet-session-history-v1',
  XP_EVENTS: 'posturepet-xp-events-v1',
  LEGACY_DECEASED_NAMES: 'posturepet-deceased-names',
} as const

export const HISTORY_LIMITS = {
  MAX_POSTURE_SAMPLES: 3000,
  MAX_SESSION_RESULTS: 500,
  MAX_XP_EVENTS: 1500,
} as const

export interface ActivePetLife {
  id: string
  name: string
  petId: string
  species: string
  startedAt: string
  xpEarned: number
  completedSessions: number
}

export interface PetGrave {
  id: string
  name: string
  petId: string
  species: string
  startedAt: string
  diedAt: string
  livedSeconds: number
  xpEarned: number
  finalXp: number
  finalLevel: number
  completedSessions: number
  cause: 'hp-depleted'
}

export interface PostureSample {
  timestamp: string
  status: 'good' | 'slouching' | 'away' | 'unknown'
  deviationDegree?: number
}

export interface SessionResult {
  id: string
  petLifeId: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  postureScore: number
  completed: boolean
  interrupted: boolean
}

export type XpEventSource = 'posture' | 'pomodoro' | 'wellness' | 'debug' | 'initial'

export interface XpEvent {
  id: string
  petLifeId: string
  timestamp: string
  deltaXp: number
  xp: number
  level: number
  source: XpEventSource
}

export interface DashboardStats {
  postureScore: number
  totalWorkTimeSeconds: number
  completedSessions: number
  interruptedSessions: number
  sessionSummaries: SessionResult[]
  petProgression: Array<{
    timestamp: string
    xp: number
    level: number
  }>
}

export interface DateRangeFilter {
  from?: Date | string | number
  to?: Date | string | number
  /** Scope petProgression to a specific life ID (defaults to active life if present). Pass null to skip scoping. */
  petLifeId?: string | null
  /** Live current XP to include as the latest progression point when viewing the active life. */
  currentXp?: number
  /** Live current level paired with currentXp. */
  currentLevel?: number
}

// ─── Storage Utilities (Defensive Parsing & Bounded Writes) ───────────────────

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function createUniqueId(prefix = 'id'): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`
    }
  } catch {
    // Fallback when Web Crypto randomUUID is unavailable
  }
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

const jsonParseCache = new Map<string, { raw: string; value: unknown }>()

function readJson<T>(key: string, fallback: T): T {
  const storage = getStorage()
  if (!storage) return fallback
  try {
    const raw = storage.getItem(key)
    if (!raw) {
      jsonParseCache.delete(key)
      return fallback
    }
    const cached = jsonParseCache.get(key)
    if (cached && cached.raw === raw) {
      const val = cached.value
      return (Array.isArray(val) ? [...val] : val) as T
    }
    const parsed = JSON.parse(raw) as unknown
    jsonParseCache.set(key, { raw, value: parsed })
    return (Array.isArray(parsed) ? [...parsed] : parsed) as T
  } catch {
    jsonParseCache.delete(key)
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  const storage = getStorage()
  if (!storage) return
  try {
    const raw = JSON.stringify(value)
    storage.setItem(key, raw)
    jsonParseCache.set(key, { raw, value })
  } catch {
    // Ignore storage quota errors gracefully
  }
}

function removeKey(key: string): void {
  const storage = getStorage()
  jsonParseCache.delete(key)
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // Ignore storage removal errors
  }
}

function toTimestampMs(value?: Date | string | number): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const ms = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function clampNonNegativeInt(n: unknown, fallback = 0): number {
  const num = typeof n === 'number' ? n : Number(n)
  return Number.isFinite(num) ? Math.max(0, Math.round(num)) : fallback
}

// ─── Level Computation (Matches App.tsx XP Curve) ─────────────────────────────

const XP_BASE = 100
const XP_EXPONENT = 1.5

export function computeLevelFromXp(totalXp: number): number {
  const safeXp = Math.max(0, Number.isFinite(totalXp) ? totalXp : 0)
  let level = 1
  let cumulative = 0
  while (level < 999) {
    const nextReq = Math.floor(XP_BASE * Math.pow(level, XP_EXPONENT))
    if (safeXp < cumulative + nextReq) break
    cumulative += nextReq
    level++
  }
  return level
}

// ─── Type Guards & Readers ────────────────────────────────────────────────────

function isValidActiveLife(v: unknown): v is ActivePetLife {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.name === 'string' &&
    typeof o.petId === 'string' &&
    typeof o.species === 'string' &&
    typeof o.startedAt === 'string'
  )
}

function isValidGrave(v: unknown): v is PetGrave {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.name === 'string' &&
    typeof o.petId === 'string' &&
    typeof o.species === 'string' &&
    typeof o.diedAt === 'string'
  )
}

export function loadActiveLife(): ActivePetLife | null {
  const parsed = readJson<unknown>(STORAGE_KEYS.ACTIVE_LIFE, null)
  if (!isValidActiveLife(parsed)) return null
  return {
    id: parsed.id,
    name: parsed.name,
    petId: parsed.petId,
    species: parsed.species,
    startedAt: parsed.startedAt,
    xpEarned: clampNonNegativeInt(parsed.xpEarned),
    completedSessions: clampNonNegativeInt(parsed.completedSessions),
  }
}

export function saveActiveLife(life: ActivePetLife | null): void {
  if (!life) {
    removeKey(STORAGE_KEYS.ACTIVE_LIFE)
    return
  }
  writeJson(STORAGE_KEYS.ACTIVE_LIFE, life)
}

export function loadGraves(): PetGrave[] {
  const parsed = readJson<unknown>(STORAGE_KEYS.GRAVES, [])
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isValidGrave).map((g) => ({
    ...g,
    startedAt: typeof g.startedAt === 'string' && g.startedAt ? g.startedAt : g.diedAt,
    livedSeconds: clampNonNegativeInt(g.livedSeconds),
    xpEarned: clampNonNegativeInt(g.xpEarned),
    finalXp: clampNonNegativeInt(g.finalXp),
    finalLevel: Math.max(1, clampNonNegativeInt(g.finalLevel, 1)),
    completedSessions: clampNonNegativeInt(g.completedSessions),
    cause: 'hp-depleted',
  }))
}

export function saveGraves(graves: PetGrave[]): void {
  writeJson(STORAGE_KEYS.GRAVES, graves)
}

export function loadPostureHistory(): PostureSample[] {
  const parsed = readJson<unknown>(STORAGE_KEYS.POSTURE_HISTORY, [])
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (s): s is PostureSample =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as PostureSample).timestamp === 'string' &&
      ((s as PostureSample).status === 'good' ||
        (s as PostureSample).status === 'slouching' ||
        (s as PostureSample).status === 'away' ||
        (s as PostureSample).status === 'unknown'),
  )
}

export function loadSessionHistory(): SessionResult[] {
  const parsed = readJson<unknown>(STORAGE_KEYS.SESSION_HISTORY, [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter(
      (s): s is SessionResult =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as SessionResult).id === 'string' &&
        typeof (s as SessionResult).petLifeId === 'string' &&
        typeof (s as SessionResult).startedAt === 'string' &&
        typeof (s as SessionResult).endedAt === 'string',
    )
    .map((s) => ({
      ...s,
      durationSeconds: clampNonNegativeInt(s.durationSeconds),
      postureScore: Math.min(100, clampNonNegativeInt(s.postureScore, 100)),
      completed: Boolean(s.completed),
      interrupted: Boolean(s.interrupted),
    }))
}

export function loadXpEvents(): XpEvent[] {
  const parsed = readJson<unknown>(STORAGE_KEYS.XP_EVENTS, [])
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (e): e is XpEvent =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as XpEvent).id === 'string' &&
      typeof (e as XpEvent).timestamp === 'string' &&
      typeof (e as XpEvent).xp === 'number',
  )
}

// ─── Lifecycle Operations ─────────────────────────────────────────────────────

/**
 * Check if a pet name belongs to any deceased pet (graves list or legacy name memorial).
 */
export function isDeceasedPetName(name: string, legacyDeceasedNames: string[] = []): boolean {
  const target = name.trim().toLowerCase()
  if (!target) return false
  if (legacyDeceasedNames.some((n) => n.trim().toLowerCase() === target)) return true
  const graves = loadGraves()
  return graves.some((g) => g.name.trim().toLowerCase() === target)
}

/**
 * Migrate legacy saves (name-only memorial or dead/alive localStorage without v1 keys)
 * into the versioned lifecycle model without crashing or inventing fake lifetimes.
 */
export function initializeOrMigrateLifecycle(params: {
  currentName: string
  petId: string
  species: string
  currentXp: number
  currentHealth: number
  legacyDeceasedNames: string[]
}): {
  activeLife: ActivePetLife | null
  graves: PetGrave[]
  deceasedNames: string[]
} {
  let graves = loadGraves()
  let activeLife = loadActiveLife()
  const nowIso = new Date().toISOString()
  const trimmedName = params.currentName.trim()

  if (params.currentHealth <= 0) {
    // Existing save is already dead: finalize activeLife into a single grave if needed,
    // or create a best-effort grave with livedSeconds: 0 without inventing a fake lifetime.
    if (activeLife) {
      if (!graves.some((g) => g.id === activeLife!.id)) {
        const startedMs = toTimestampMs(activeLife.startedAt)
        const diedMs = Date.now()
        const livedSeconds =
          startedMs !== null ? Math.max(0, Math.round((diedMs - startedMs) / 1000)) : 0
        const grave: PetGrave = {
          id: activeLife.id,
          name: activeLife.name,
          petId: activeLife.petId,
          species: activeLife.species,
          startedAt: activeLife.startedAt,
          diedAt: nowIso,
          livedSeconds,
          xpEarned: Math.max(activeLife.xpEarned, clampNonNegativeInt(params.currentXp)),
          finalXp: clampNonNegativeInt(params.currentXp),
          finalLevel: computeLevelFromXp(params.currentXp),
          completedSessions: activeLife.completedSessions,
          cause: 'hp-depleted',
        }
        graves = [...graves, grave]
        saveGraves(graves)
      }
      activeLife = null
      saveActiveLife(null)
    } else if (trimmedName) {
      const alreadyGraved = graves.some(
        (g) => g.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      )
      if (!alreadyGraved) {
        const bestEffortGrave: PetGrave = {
          id: createUniqueId('grave-migrated'),
          name: trimmedName,
          petId: params.petId,
          species: params.species,
          startedAt: nowIso,
          diedAt: nowIso,
          livedSeconds: 0,
          xpEarned: clampNonNegativeInt(params.currentXp),
          finalXp: clampNonNegativeInt(params.currentXp),
          finalLevel: computeLevelFromXp(params.currentXp),
          completedSessions: 0,
          cause: 'hp-depleted',
        }
        graves = [...graves, bestEffortGrave]
        saveGraves(graves)
      }
    }
  } else if (!activeLife && trimmedName) {
    // Migrate existing live pet into a persistent active life
    activeLife = {
      id: createUniqueId('life'),
      name: trimmedName,
      petId: params.petId,
      species: params.species,
      startedAt: nowIso,
      xpEarned: clampNonNegativeInt(params.currentXp),
      completedSessions: 0,
    }
    saveActiveLife(activeLife)
    appendXpEvent({
      id: createUniqueId('xp'),
      petLifeId: activeLife.id,
      timestamp: nowIso,
      deltaXp: clampNonNegativeInt(params.currentXp),
      xp: clampNonNegativeInt(params.currentXp),
      level: computeLevelFromXp(params.currentXp),
      source: 'initial',
    })
  }

  // Merge grave names into deceasedNames set so deceased names stay protected
  const seen = new Set<string>()
  const mergedNames: string[] = []
  for (const candidate of [...params.legacyDeceasedNames, ...graves.map((g) => g.name)]) {
    const clean = candidate.trim()
    if (!clean) continue
    const lower = clean.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      mergedNames.push(clean)
    }
  }

  return { activeLife, graves, deceasedNames: mergedNames }
}

/**
 * Create and persist a brand-new ActivePetLife when first naming a pet or adopting after death.
 */
export function startNewPetLife(params: {
  name: string
  petId: string
  species: string
}): ActivePetLife {
  const nowIso = new Date().toISOString()
  const life: ActivePetLife = {
    id: createUniqueId('life'),
    name: params.name.trim(),
    petId: params.petId,
    species: params.species,
    startedAt: nowIso,
    xpEarned: 0,
    completedSessions: 0,
  }
  saveActiveLife(life)
  lastPostureXpEventMs = 0
  appendXpEvent({
    id: createUniqueId('xp'),
    petLifeId: life.id,
    timestamp: nowIso,
    deltaXp: 0,
    xp: 0,
    level: 1,
    source: 'initial',
  })
  return life
}

/**
 * Update the visual pet pack on an existing live pet without resetting its life or stats.
 */
export function updateActiveLifePetPack(
  life: ActivePetLife | null,
  params: { petId: string; species: string },
): ActivePetLife | null {
  if (!life) return null
  if (life.petId === params.petId && life.species === params.species) return life
  const updated: ActivePetLife = {
    ...life,
    petId: params.petId,
    species: params.species,
  }
  saveActiveLife(updated)
  return updated
}

function appendXpEvent(event: XpEvent): void {
  const events = loadXpEvents()
  const next = [...events, event]
  const bounded =
    next.length > HISTORY_LIMITS.MAX_XP_EVENTS
      ? next.slice(next.length - HISTORY_LIMITS.MAX_XP_EVENTS)
      : next
  writeJson(STORAGE_KEYS.XP_EVENTS, bounded)
}

const XP_POSTURE_THROTTLE_MS = 15_000
let lastPostureXpEventMs = 0

/**
 * Track XP progression & accumulate total lifetime `xpEarned` separately from current XP
 * (because slouching drains current XP without erasing earned achievements).
 */
export function recordXpChange(params: {
  activeLife: ActivePetLife | null
  deltaXp: number
  nextXp: number
  nextLevel: number
  source: XpEventSource
}): ActivePetLife | null {
  const { activeLife, deltaXp, nextXp, nextLevel, source } = params
  let updatedLife = activeLife

  if (updatedLife && deltaXp > 0) {
    updatedLife = {
      ...updatedLife,
      xpEarned: updatedLife.xpEarned + deltaXp,
    }
    saveActiveLife(updatedLife)
  }

  const nowMs = Date.now()
  const events = loadXpEvents()
  const prevLevel = events.length > 0 ? events[events.length - 1].level : 1
  const levelChanged = nextLevel !== prevLevel

  const shouldLogEvent =
    source !== 'posture' ||
    levelChanged ||
    nowMs - lastPostureXpEventMs >= XP_POSTURE_THROTTLE_MS

  if (shouldLogEvent) {
    if (source === 'posture') lastPostureXpEventMs = nowMs
    appendXpEvent({
      id: createUniqueId('xp'),
      petLifeId: updatedLife?.id ?? 'unassigned',
      timestamp: new Date(nowMs).toISOString(),
      deltaXp,
      xp: Math.max(0, nextXp),
      level: Math.max(1, nextLevel),
      source,
    })
  }

  return updatedLife
}

/**
 * Create a single PetGrave record when HP hits zero, preventing duplicates on rerenders/reloads.
 */
export function recordPetDeath(params: {
  activeLife: ActivePetLife | null
  fallbackName: string
  petId: string
  species: string
  finalXp: number
  finalLevel: number
}): { grave: PetGrave | null; graves: PetGrave[]; created: boolean } {
  const existingGraves = loadGraves()
  const persistedLife = loadActiveLife()
  const life = params.activeLife ?? persistedLife

  const lifeId = life?.id
  if (lifeId && existingGraves.some((g) => g.id === lifeId)) {
    saveActiveLife(null)
    return {
      grave: existingGraves.find((g) => g.id === lifeId) ?? null,
      graves: existingGraves,
      created: false,
    }
  }

  const nowIso = new Date().toISOString()
  const diedMs = Date.now()
  const startedAt = life?.startedAt ?? nowIso
  const startedMs = toTimestampMs(startedAt)
  const livedSeconds =
    startedMs !== null ? Math.max(0, Math.round((diedMs - startedMs) / 1000)) : 0

  const resolvedName = (life?.name || params.fallbackName || 'Companion').trim()
  const grave: PetGrave = {
    id: lifeId ?? createUniqueId('grave'),
    name: resolvedName,
    petId: life?.petId ?? params.petId,
    species: life?.species ?? params.species,
    startedAt,
    diedAt: nowIso,
    livedSeconds,
    xpEarned: Math.max(life?.xpEarned ?? 0, clampNonNegativeInt(params.finalXp)),
    finalXp: clampNonNegativeInt(params.finalXp),
    finalLevel: Math.max(1, clampNonNegativeInt(params.finalLevel, 1)),
    completedSessions: life?.completedSessions ?? 0,
    cause: 'hp-depleted',
  }

  const nextGraves = [...existingGraves, grave]
  saveGraves(nextGraves)
  saveActiveLife(null)
  return { grave, graves: nextGraves, created: true }
}

// ─── Posture History & Documented Posture Score Calculation ───────────────────

/**
 * Convert normalized region slouch scores ([0..1]) into an estimated deviation angle in degrees.
 */
export function estimateDeviationDegree(
  scores:
    | { neck?: number; lowerBack?: number; torso?: number; shoulder?: number }
    | null
    | undefined,
): number | undefined {
  if (!scores) return undefined
  const neck = scores.neck ?? 0
  const torso = scores.lowerBack ?? scores.torso ?? 0
  const shoulder = scores.shoulder ?? 0
  const weighted = neck * 0.5 + torso * 0.35 + shoulder * 0.15
  if (!Number.isFinite(weighted)) return undefined
  return Math.round(Math.max(0, Math.min(1, weighted)) * 45 * 10) / 10
}

/**
 * Compute an overall 0-100 posture score from posture samples.
 *
 * Calculation documented for clarity:
 * - Only active posture states (`'good'` and `'slouching'`) contribute to the score;
 *   `'away'` and `'unknown'` samples are excluded so stepping away or brief calibration
 *   gaps do not penalize or artificially inflate posture quality.
 * - `postureScore = Math.round((goodCount / (goodCount + slouchingCount)) * 100)`
 * - If no active `'good'` or `'slouching'` samples exist in the range, returns `100`
 *   (neutral baseline).
 */
export function computePostureScore(samples: PostureSample[]): number {
  let goodCount = 0
  let slouchCount = 0
  for (const s of samples) {
    if (s.status === 'good') goodCount++
    else if (s.status === 'slouching') slouchCount++
  }
  const activeTotal = goodCount + slouchCount
  if (activeTotal === 0) return 100
  return Math.round((goodCount / activeTotal) * 100)
}

export function recordPostureSample(sample: PostureSample): PostureSample[] {
  const history = loadPostureHistory()
  const next = [...history, sample]
  const bounded =
    next.length > HISTORY_LIMITS.MAX_POSTURE_SAMPLES
      ? next.slice(next.length - HISTORY_LIMITS.MAX_POSTURE_SAMPLES)
      : next
  writeJson(STORAGE_KEYS.POSTURE_HISTORY, bounded)
  return bounded
}

// ─── Pomodoro Session History ─────────────────────────────────────────────────

export function recordSessionResult(params: {
  activeLife: ActivePetLife | null
  startedAt: string
  endedAt?: string
  durationSeconds: number
  completed: boolean
  interrupted: boolean
}): {
  session: SessionResult
  activeLife: ActivePetLife | null
} {
  const endedAt = params.endedAt ?? new Date().toISOString()
  const startMs = toTimestampMs(params.startedAt) ?? Date.now()
  const endMs = toTimestampMs(endedAt) ?? Date.now()

  const samples = loadPostureHistory().filter((s) => {
    const t = toTimestampMs(s.timestamp)
    return t !== null && t >= startMs && t <= endMs
  })

  const postureScore = computePostureScore(samples)
  const session: SessionResult = {
    id: createUniqueId('sess'),
    petLifeId: params.activeLife?.id ?? 'unassigned',
    startedAt: params.startedAt,
    endedAt,
    durationSeconds: clampNonNegativeInt(params.durationSeconds),
    postureScore,
    completed: params.completed,
    interrupted: params.interrupted,
  }

  const history = loadSessionHistory()
  const next = [...history, session]
  const bounded =
    next.length > HISTORY_LIMITS.MAX_SESSION_RESULTS
      ? next.slice(next.length - HISTORY_LIMITS.MAX_SESSION_RESULTS)
      : next
  writeJson(STORAGE_KEYS.SESSION_HISTORY, bounded)

  let updatedLife = params.activeLife
  if (params.completed && updatedLife) {
    updatedLife = {
      ...updatedLife,
      completedSessions: updatedLife.completedSessions + 1,
    }
    saveActiveLife(updatedLife)
  }

  return { session, activeLife: updatedLife }
}

// ─── Reusable Dashboard Statistics Selector ───────────────────────────────────

/**
 * Reusable statistics selector for both All-Time and custom/Weekly date ranges.
 */
export function getDashboardStats(filter: DateRangeFilter = {}): DashboardStats {
  const fromMs = toTimestampMs(filter.from)
  const toMs = toTimestampMs(filter.to)

  const inRange = (iso: string): boolean => {
    const t = toTimestampMs(iso)
    if (t === null) return false
    if (fromMs !== null && t < fromMs) return false
    if (toMs !== null && t > toMs) return false
    return true
  }

  const postureSamples = loadPostureHistory().filter((s) => inRange(s.timestamp))
  const sessionSummaries = loadSessionHistory()
    .filter((s) => inRange(s.endedAt))
    .sort((a, b) => (toTimestampMs(b.endedAt) ?? 0) - (toTimestampMs(a.endedAt) ?? 0))

  const targetLifeId =
    filter.petLifeId !== undefined ? filter.petLifeId : (loadActiveLife()?.id ?? null)

  const allXpEventsInRange = loadXpEvents()
    .filter((e) => inRange(e.timestamp))
    .sort((a, b) => (toTimestampMs(a.timestamp) ?? 0) - (toTimestampMs(b.timestamp) ?? 0))

  const scopedXpEvents = targetLifeId
    ? allXpEventsInRange.filter((e) => e.petLifeId === targetLifeId)
    : allXpEventsInRange

  const petProgression = scopedXpEvents.map((e) => ({
    timestamp: e.timestamp,
    xp: e.xp,
    level: e.level,
  }))

  if (
    typeof filter.currentXp === 'number' &&
    typeof filter.currentLevel === 'number' &&
    (targetLifeId === null || targetLifeId === loadActiveLife()?.id) &&
    (toMs === null || Date.now() <= toMs)
  ) {
    const lastPoint = petProgression[petProgression.length - 1]
    if (!lastPoint || lastPoint.xp !== filter.currentXp || lastPoint.level !== filter.currentLevel) {
      petProgression.push({
        timestamp: new Date().toISOString(),
        xp: filter.currentXp,
        level: filter.currentLevel,
      })
    }
  }

  let totalWorkTimeSeconds = 0
  let completedSessions = 0
  let interruptedSessions = 0
  let sessionScoreSum = 0

  for (const sess of sessionSummaries) {
    totalWorkTimeSeconds += sess.durationSeconds
    sessionScoreSum += sess.postureScore
    if (sess.completed) completedSessions++
    if (sess.interrupted) interruptedSessions++
  }

  const hasActiveSamples = postureSamples.some(
    (s) => s.status === 'good' || s.status === 'slouching',
  )
  const postureScore = hasActiveSamples
    ? computePostureScore(postureSamples)
    : sessionSummaries.length > 0
      ? Math.round(sessionScoreSum / sessionSummaries.length)
      : 100

  return {
    postureScore,
    totalWorkTimeSeconds,
    completedSessions,
    interruptedSessions,
    sessionSummaries,
    petProgression,
  }
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

export function formatDurationReadable(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const days = Math.floor(safe / 86400)
  const hours = Math.floor((safe % 86400) / 3600)
  const mins = Math.floor((safe % 3600) / 60)
  const secs = safe % 60

  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}
