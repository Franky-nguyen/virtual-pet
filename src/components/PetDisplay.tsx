import { useState, useEffect, useRef } from 'react'
import type { PostureData } from '../types/electron'
import { type AnimationState, type AccessoryType, ANIMATION_FRAMES, EVOLVED_ANIMATION_FRAMES, EVOLUTION_DURATION_MS } from '../types/accessories'
import { ANIMATION_STATE_TO_CUSTOM_KEY, type BuiltinPetModel, type RuntimeCustomPet } from '../types/customPet'
import { ensureCustomPetAccessorySheets, getCachedCustomAccessoryUrl } from '../utils/customPetAccessories'
import { playEvolveArpeggio, startEvolveDrone, stopEvolveDrone, playEvolveFanfare } from '../utils/soundEffects'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { TargetIcon, HeartIcon } from './icons'
import PetEnvironment, { type EnvironmentMood } from './PetEnvironment'

// ─────────────────────────────────────────────────────────────────────────────
// SPRITE SHEET REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
// All sprite sheets are imported as Vite modules (with the `?inline` suffix)
// so that in production the image bytes are embedded directly in the JS bundle
// as data URLs — zero runtime fetches, immune to restart / public/ path issues.

// Original Dog base sheets (`src/assets/pets/*.png`) — untouched for backwards compatibility.
const DOG_SPRITES = import.meta.glob('../assets/pets/*.png', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>

// Pixel Cat sheets (`src/assets/pets/cat/*.png`) — base + 5 accessories across Idle, Walk, Hurt, Death, Attack.
const CAT_SPRITES = import.meta.glob('../assets/pets/cat/*.png', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>

// Evolved (Level 10) Pixel Cat sheets (`src/assets/pets/cat/evolved/evolved_*.png`).
const CAT_EVOLVED_SPRITES = import.meta.glob('../assets/pets/cat/evolved/evolved_*.png', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>

// Evolved (Level 10) adult dog base + composited accessory sheets: evolved_idle.png, evolved_idle_crown.png, etc.
const EVOLVED_SPRITES = import.meta.glob('../assets/pets/evolved/evolved_*.png', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>

/** Sprite metadata for a single animation frame sheet. */
interface SpriteSheet {
  url: string
  frames: number
  /** Which animation's tile geometry (frame size / walk class) `url` uses.
   *  Normally the requested animation; differs when a fallback sheet from
   *  another animation is substituted so the accessory is not dropped. */
  frameKey: AnimationState
  /** Optional floating accessory overlay stacked on top of `url` (evolved only). */
  overlayUrl?: string
  /** Frame count of the overlay sheet (may differ from `frames`). */
  overlayFrames?: number
  /** True when the overlay is a single held frame (no matching animated
   *  overlay exists for this animation) rather than a synced animation. */
  overlayStatic?: boolean
  /** Tile width/height in pixels for custom pet sheets (defaults to 64). */
  tileSize?: number
}

/**
 * Frame sizes per animation (base dog).
 * Most animations use 64×64px frames, but Walk uses 48×48px (6 frames = 288px wide).
 */
const FRAME_SIZES: Record<AnimationState, number> = {
  Idle: 64,
  Walk: 48,
  Hurt: 64,
  Death: 64,
  Attack: 64,
  Evolution: 64,
}

/**
 * Frame pixel sizes per animation for the EVOLVED adult dog.  All evolved
 * sheets use 64×64px tiles on a 64px-tall strip (confirmed by pixel inspection
 * of each source file).  The on-screen render size is also 64px, so no upscaling
 * is needed — the pet stays the same pixel size as the puppy.
 */
const EVOLVED_FRAME_SIZES: Record<AnimationState, number> = {
  Idle: 64,
  Walk: 64,
  Hurt: 64,
  Death: 64,
  Attack: 64,
  Evolution: 64,
}

// The adult dog has denser sheets (6–8 frames instead of the puppy's 4–6),
// so keeping the old fixed 150ms frame time made its motion look choppy. These
// durations keep the main loops close to the puppy's cycle length while using
// the same timing for every evolved accessory sheet.
const EVOLVED_FRAME_DURATIONS: Record<AnimationState, string> = {
  Idle: '100ms',
  Walk: '75ms',
  Hurt: '100ms',
  Death: '100ms',
  Attack: '75ms',
  Evolution: '150ms',
}

/**
 * Model-aware sprite sheet lookup for a given built-in pet model, animation,
 * accessory, and evolution state.
 *
 * - For `model === 'cat'`:
 *   Resolves exclusively from `CAT_SPRITES` (`src/assets/pets/cat/`).
 *   The cat has dedicated base and accessorized sheets for all 5 animations
 *   (Idle, Walk, Hurt, Death, Attack).
 *   Evolution fallback: The cat does not have `evolution.png` or evolved 64×64
 *   cat sheets. When `evolved === true`, the cat continues using its own
 *   48×48 base and accessorized cat sheets and never substitutes dog assets.
 *
 * - For `model === 'dog'`:
 *   Preserves the exact original dog behavior:
 *   - Evolved: uses `evolved/evolved_${anim}_${acc}.png` composites or base + overlay.
 *   - Non-evolved: uses `src/assets/pets/${anim}_${acc}.png` (falling back to
 *     `Idle_${acc}.png` when an accessorized Walk/Attack sheet is absent).
 */
export function getSpriteUrl(
  animation: AnimationState,
  accessory: AccessoryType,
  evolved: boolean,
  model: BuiltinPetModel = 'dog',
): SpriteSheet {
  if (model === 'cat') {
    if (evolved) {
      const frames = EVOLVED_ANIMATION_FRAMES[animation]
      if (accessory !== 'none') {
        const compositePath = `../assets/pets/cat/evolved/evolved_${animation.toLowerCase()}_${accessory}.png`
        const compositeUrl = CAT_EVOLVED_SPRITES[compositePath]
        if (compositeUrl) return { url: compositeUrl, frames, frameKey: animation }
      }
      const basePath = `../assets/pets/cat/evolved/evolved_${animation.toLowerCase()}.png`
      const baseUrl = CAT_EVOLVED_SPRITES[basePath]
      if (baseUrl) return { url: baseUrl, frames, frameKey: animation }

      const idleComposite = accessory !== 'none'
        ? CAT_EVOLVED_SPRITES[`../assets/pets/cat/evolved/evolved_idle_${accessory}.png`]
        : undefined
      if (idleComposite) return { url: idleComposite, frames: EVOLVED_ANIMATION_FRAMES['Idle'], frameKey: 'Idle' }
      const idleUrl = CAT_EVOLVED_SPRITES['../assets/pets/cat/evolved/evolved_idle.png'] ?? ''
      return { url: idleUrl, frames: EVOLVED_ANIMATION_FRAMES['Idle'], frameKey: 'Idle' }
    }

    // Non-evolved cat uses 48×48 sheets
    const targetAnim: AnimationState = animation === 'Evolution' ? 'Idle' : animation
    const frames = ANIMATION_FRAMES[targetAnim]

    if (accessory !== 'none') {
      const accessorized = `../assets/pets/cat/${targetAnim}_${accessory}.png`
      const url = CAT_SPRITES[accessorized]
      if (url) return { url, frames, frameKey: targetAnim }

      const idleAccessorized = CAT_SPRITES[`../assets/pets/cat/Idle_${accessory}.png`]
      if (idleAccessorized) return { url: idleAccessorized, frames: ANIMATION_FRAMES['Idle'], frameKey: 'Idle' }
    }

    const base = `../assets/pets/cat/${targetAnim}.png`
    const baseUrl = CAT_SPRITES[base]
    if (baseUrl) return { url: baseUrl, frames, frameKey: targetAnim }

    const catIdleUrl = CAT_SPRITES['../assets/pets/cat/Idle.png'] ?? ''
    return { url: catIdleUrl, frames: ANIMATION_FRAMES['Idle'], frameKey: 'Idle' }
  }

  if (evolved) {
    const frames = EVOLVED_ANIMATION_FRAMES[animation]
    // When an accessory is equipped, use the baked composite sheet directly.
    // These have the accessory drawn onto the correct-sized dog at the right position.
    if (accessory !== 'none') {
      const compositePath = `../assets/pets/evolved/evolved_${animation.toLowerCase()}_${accessory}.png`
      const compositeUrl = EVOLVED_SPRITES[compositePath]
      if (compositeUrl) return { url: compositeUrl, frames, frameKey: animation }
    }
    // No accessory or composite not found — use the base evolved sprite, with
    // the accessory overlaid on top when one is equipped.
    const basePath = `../assets/pets/evolved/evolved_${animation.toLowerCase()}.png`
    const baseUrl = EVOLVED_SPRITES[basePath]
    if (baseUrl) return { url: baseUrl, frames, frameKey: animation }
    // Fallback: evolved Idle (guaranteed to exist) — composite first, then base.
    const idleComposite = accessory !== 'none'
      ? EVOLVED_SPRITES[`../assets/pets/evolved/evolved_idle_${accessory}.png`]
      : undefined
    if (idleComposite) return { url: idleComposite, frames: EVOLVED_ANIMATION_FRAMES['Idle'], frameKey: 'Idle' }
    const idleUrl = EVOLVED_SPRITES['../assets/pets/evolved/evolved_idle.png'] ?? ''
    return { url: idleUrl, frames: EVOLVED_ANIMATION_FRAMES['Idle'], frameKey: 'Idle' }
  }

  const frames = ANIMATION_FRAMES[animation]

  if (accessory !== 'none') {
    const accessorized = `../assets/pets/${animation}_${accessory}.png`
    const url = DOG_SPRITES[accessorized]
    if (url) return { url, frames, frameKey: animation }
    // No accessorized sheet for this animation: keep the outfit by using the
    // accessorized Idle sheet rather than the bare base sheet.
    const idleAccessorized = DOG_SPRITES[`../assets/pets/Idle_${accessory}.png`]
    if (idleAccessorized) return { url: idleAccessorized, frames: ANIMATION_FRAMES['Idle'], frameKey: 'Idle' }
    const base = `../assets/pets/${animation}.png`
    const baseUrl = DOG_SPRITES[base]
    if (baseUrl) return { url: baseUrl, frames, frameKey: animation }
  } else {
    const base = `../assets/pets/${animation}.png`
    const url = DOG_SPRITES[base]
    if (url) return { url: url, frames, frameKey: animation }
  }

  // Ultimate fallback: Idle.png (guaranteed to exist)
  const idleUrl = DOG_SPRITES['../assets/pets/Idle.png'] ?? ''
  return { url: idleUrl, frames: ANIMATION_FRAMES['Idle'], frameKey: 'Idle' }
}

// Sprites are inlined as data URLs by Vite; avoid eagerly instantiating 80+
// HTMLImageElement bitmap buffers at module load time so unused pet models and
// unequipped accessories consume zero decoded image memory.

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION → SPRITE KEY MAPPING
// ─────────────────────────────────────────────────────────────────────────────

type SpriteKey = AnimationState
const DEFAULT_SPRITE_KEY: SpriteKey = 'Idle'

type PostureStatus = PostureData['status'] | 'unknown' | 'calibrating' | 'calibrated'

/**
 * Maps every posture state to a known sprite key.
 * During calibration the pet walks in place (Walk animation).
 */
function getSpriteKey(status: PostureStatus): SpriteKey {
  switch (status) {
    case 'good':      return 'Idle'
    case 'slouching': return 'Hurt'
    case 'calibrating': return 'Walk'  // Walk animation during calibration
    case 'away':      return 'Death'
    default:          return DEFAULT_SPRITE_KEY
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS UI CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  good: {
    glow:       '0 0 24px 8px rgba(74,222,128,0.55)',
    ring:       'ring-green-500',
    bg:         'bg-green-50',
    label:      'bg-green-100 text-green-800',
    text:       'Great posture! Keep it up!',
  },
  slouching: {
    glow:       '0 0 24px 8px rgba(248,113,113,0.55)',
    ring:       'ring-red-500',
    bg:         'bg-red-50',
    label:      'bg-red-100 text-red-800',
    text:       'Slouching detected! Sit up straight!',
  },
  away: {
    glow:       '0 0 20px 6px rgba(250,204,21,0.4)',
    ring:       'ring-amber-500',
    bg:         'bg-amber-50',
    label:      'bg-amber-100 text-amber-800',
    text:       'Come back soon!',
  },
  unknown: {
    glow:       '0 0 16px 4px rgba(148,163,184,0.35)',
    ring:       'ring-border',
    bg:         'bg-muted',
    label:      'bg-muted text-muted-foreground',
    text:       'Connecting to camera...',
  },
  calibrating: {
    glow:       '0 0 24px 10px rgba(139,92,246,0.6)',
    ring:       'ring-violet-500',
    bg:         'bg-violet-50',
    label:      'bg-violet-100 text-violet-800',
    text:       'Calibrating... hold still!',
  },
  calibrated: {
    glow:       '0 0 24px 8px rgba(74,222,128,0.7)',
    ring:       'ring-green-500',
    bg:         'bg-green-50',
    label:      'bg-green-100 text-green-800',
    text:       'Calibration saved!',
  },
} as const satisfies Record<string, { glow: string; ring: string; bg: string; label: string; text: string }>

function resolveDisplayStatus(postureStatus: PostureStatus): keyof typeof STATUS_CONFIG {
  if (postureStatus === 'calibrating') return 'calibrating'
  if (postureStatus === 'calibrated')  return 'calibrated'
  if (postureStatus === 'unknown')     return 'unknown'
  if (postureStatus === 'away')        return 'away'
  if (postureStatus === 'good')        return 'good'
  if (postureStatus === 'slouching')   return 'slouching'
  return 'unknown'
}

// ─────────────────────────────────────────────────────────────────────────────
// POKÉMON-STYLE EVOLUTION CINEMATIC
// ─────────────────────────────────────────────────────────────────────────────

/** How long the Pokémon silhouette morph & energy particles run before the climax flash + reveal. */
const PARTICLES_MS = 5800
/** Overlay fade-in / fade-out duration (matches `.evolve-overlay`). */
const OVERLAY_FADE_MS = 400

type PokemonParticlePhase = 'gather' | 'radiate' | 'climax'

interface EvolveParticle {
  id: number
  phase: PokemonParticlePhase
  shape: 'orb' | 'star'
  size: number
  color: string
  glowColor: string
  /** Start offset (px) relative to pet center */
  sx: number
  sy: number
  /** End offset (px) relative to pet center */
  ex: number
  ey: number
  /** Animation delay (ms) */
  delayMs: number
  /** Animation duration (ms) */
  durationMs: number
}

const POKEMON_PALETTE: Array<{ color: string; glow: string }> = [
  { color: '#ffffff', glow: '#67e8f9' }, // Pure white core + cyan aura
  { color: '#e0f2fe', glow: '#38bdf8' }, // Ice white + sky blue aura
  { color: '#67e8f9', glow: '#0284c7' }, // Classic Pokémon evolution cyan
  { color: '#fde047', glow: '#f59e0b' }, // Starlight gold sparkle
  { color: '#c4b5fd', glow: '#7c3aed' }, // Mystic evolution violet
]

/**
 * Build the 3-phase Pokémon evolution particle sequence centered on the pet:
 *  1. 'gather'  (0ms–1000ms):    Light spheres spawn in a ring and converge into the pet.
 *  2. 'radiate' (650ms–5600ms):  Accelerating waves of glowing orbs & 4-point star sparkles
 *                                burst outward and float upward while the silhouette morphs.
 *  3. 'climax'  (5800ms–7000ms): 360° celebratory starburst when the evolved form is revealed.
 */
function generatePokemonParticles(): EvolveParticle[] {
  const list: EvolveParticle[] = []
  let id = 0

  // Phase 1: 18 converging energy orbs pulled into the pet center
  const GATHER_COUNT = 18
  for (let i = 0; i < GATHER_COUNT; i++) {
    const angle = (i / GATHER_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.25
    const radius = 85 + (i % 3) * 28
    const pal = POKEMON_PALETTE[i % 3] // white & cyan spheres
    list.push({
      id: id++,
      phase: 'gather',
      shape: 'orb',
      size: 7 + (i % 3) * 2,
      color: pal.color,
      glowColor: pal.glow,
      sx: Math.cos(angle) * radius,
      sy: Math.sin(angle) * radius,
      ex: 0,
      ey: 0,
      delayMs: (i % 6) * 75,
      durationMs: 680,
    })
  }

  // Phase 2: 48 radiating & rising Pokémon evolution orbs and star sparkles
  // Spawned in accelerating waves that mirror the accelerating silhouette swap
  const RADIATE_COUNT = 48
  for (let i = 0; i < RADIATE_COUNT; i++) {
    const progress = i / RADIATE_COUNT
    // Non-linear stagger so particle density accelerates toward the climax
    const delayMs = Math.round(650 + Math.pow(progress, 0.82) * 4650)
    const angle = i * 2.39996 + (Math.random() - 0.5) * 0.3 // golden-angle spiral distribution
    const dist = 75 + Math.random() * 95
    // Classic Pokémon evolution particles burst outward and drift upward in an energy column
    const ex = Math.cos(angle) * dist
    const ey = Math.sin(angle) * dist - (25 + Math.random() * 55)
    const pal = POKEMON_PALETTE[i % POKEMON_PALETTE.length]
    const isStar = i % 3 === 0
    list.push({
      id: id++,
      phase: 'radiate',
      shape: isStar ? 'star' : 'orb',
      size: isStar ? 10 + (i % 3) * 3 : 5 + (i % 4) * 2,
      color: pal.color,
      glowColor: pal.glow,
      sx: Math.cos(angle) * 8,
      sy: Math.sin(angle) * 8,
      ex,
      ey,
      delayMs,
      durationMs: 780 + (i % 4) * 110,
    })
  }

  // Phase 3: 24 climax starburst particles at t = PARTICLES_MS (rendered when flashActive is true)
  const CLIMAX_COUNT = 24
  for (let i = 0; i < CLIMAX_COUNT; i++) {
    const angle = (i / CLIMAX_COUNT) * Math.PI * 2
    const ring = i % 2 === 0 ? 125 : 85
    const pal = POKEMON_PALETTE[i % POKEMON_PALETTE.length]
    const isStar = i % 2 === 0
    list.push({
      id: id++,
      phase: 'climax',
      shape: isStar ? 'star' : 'orb',
      size: isStar ? 12 + (i % 3) * 3 : 6 + (i % 3) * 2,
      color: pal.color,
      glowColor: pal.glow,
      sx: 0,
      sy: 0,
      ex: Math.cos(angle) * ring,
      ey: Math.sin(angle) * ring,
      delayMs: (i % 4) * 35,
      durationMs: 950,
    })
  }

  return list
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT PROPS
// ─────────────────────────────────────────────────────────────────────────────

interface PetDisplayProps {
  mode: 'dashboard' | 'taskbar'
  isWorkPhase: boolean
  postureStatus: PostureStatus
  onCalibrate: () => void
  /** CSS hue-rotate angle (degrees) applied to the sprite layers. 0 = original color. */
  petHue: number
  /** Permadeath flag — when true the Death sprite is forced until a new pet is adopted. */
  isDead: boolean
  /** Reset handler for the "Adopt a New Dog" button (dashboard mode only). */
  onAdoptNewPet?: () => void
  /** Currently equipped accessory type. */
  selectedAccessory?: AccessoryType
  /** True while the one-time Level 10 evolution animation plays — locks the
   *  sprite to evolution.png and blocks all other animation states. */
  isEvolving: boolean
  /** True once the pet has permanently evolved. Routes every sprite source to
   *  the evolved/ sheets and uses the evolved frame counts. */
  isEvolved: boolean
  /** True once the death animation has finished playing. Locks the Death sprite
   *  on its final frame and prevents posture changes (away/calibrating) from
   *  restarting the animation. */
  deathFrozen: boolean
  /** Current pet level, used to show the Evolve button at Level 10. */
  petLevel: number
  /** Called when the user clicks the "Evolve" button. Only active when
   *  petLevel >= 10 && !isEvolved && !isEvolving. */
  onEvolve: () => void
  /** Called by the evolution layer's onAnimationEnd event, exactly once per
   *  evolution cutscene, at the instant the 1.2s sprite animation finishes.
   *  App uses this to call setIsEvolving(false) so the blink wrapper and the
   *  evolution layer itself both unmount precisely when the animation ends. */
  onEvolutionAnimEnd: () => void
  /** True in Wellness Mode: the camera is released, so calibration is
   *  meaningless. The Calibrate button is replaced by a manual self-report
   *  action and the camera status badge is hidden. */
  wellnessMode?: boolean
  /** Manual "I'm aligned" self-report (Wellness Mode only). Grants pet XP. */
  onSelfReport?: () => void
  /** Seconds left on the shared Wellness cooldown; the self-report button is
   *  disabled and shows the countdown while this is > 0. */
  selfReportCooldown?: number
  /** Selected built-in pet model ('dog' | 'cat'); ignored when `customPet` is set. */
  petModel?: BuiltinPetModel
  /** Optional selected custom pet pack; when null/undefined, renders the built-in pet. */
  customPet?: RuntimeCustomPet | null
  /** User-chosen name of the current pet (empty string if not yet named). */
  petName?: string
  /** Optional callback to open the Digital Pet Graveyard modal when deceased. */
  onOpenGraveyard?: () => void
}

/**
 * Resolve sprite sheet metadata for a validated custom pet manifest,
 * applying the equipped Wardrobe accessory (`selectedAccessory`) when active.
 */
function getCustomSpriteSheet(
  animation: AnimationState,
  customPet: RuntimeCustomPet,
  accessory: AccessoryType = 'none',
): SpriteSheet & { tileSize: number } {
  const customKey = ANIMATION_STATE_TO_CUSTOM_KEY[animation]
  const spec = customPet.manifest.animations[customKey] ?? customPet.manifest.animations.idle
  const baseUrl = customPet.spriteUrls[customKey] ?? customPet.spriteUrls.idle

  if (accessory !== 'none') {
    const compositedUrl = getCachedCustomAccessoryUrl(customPet.manifest.id, customKey, accessory)
    if (compositedUrl) {
      return {
        url: compositedUrl,
        frames: spec.frames,
        frameKey: animation,
        tileSize: spec.tileWidth || 64,
      }
    }
    // Immediate 0ms fallback to base sheet while offscreen canvas finishes compositing (< 2ms)
    return {
      url: baseUrl,
      frames: spec.frames,
      frameKey: animation,
      tileSize: spec.tileWidth || 64,
    }
  }

  return {
    url: baseUrl,
    frames: spec.frames,
    frameKey: animation,
    tileSize: spec.tileWidth || 64,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function PetDisplay({
  mode,
  isWorkPhase,
  postureStatus,
  onCalibrate,
  petHue,
  isDead,
  onAdoptNewPet,
  selectedAccessory = 'none',
  isEvolving,
  isEvolved,
  petLevel,
  onEvolve,
  onEvolutionAnimEnd,
  deathFrozen,
  wellnessMode = false,
  onSelfReport,
  selfReportCooldown = 0,
  petModel = 'dog',
  customPet = null,
  petName = '',
  onOpenGraveyard,
}: PetDisplayProps) {

  // Both built-in pets (Original Dog & Pixel Cat) can evolve; Custom Pets do not evolve.
  const canEvolve = !customPet && (petModel === 'dog' || petModel === 'cat')
  const effectiveEvolved = canEvolve && isEvolved
  const effectiveEvolving = canEvolve && isEvolving

  // Tracks when custom pet accessory composites finish generating so layers re-render
  const [, setCustomAccessoryRevision] = useState(0)

  // Preload custom pet sprite data URLs and precompute accessory composites
  useEffect(() => {
    if (!customPet) return
    for (const url of Object.values(customPet.spriteUrls)) {
      if (url) {
        const img = new Image()
        img.src = url
      }
    }
    if (selectedAccessory !== 'none') {
      let cancelled = false
      ensureCustomPetAccessorySheets(customPet, selectedAccessory).then(() => {
        if (!cancelled) {
          setCustomAccessoryRevision((r) => r + 1)
        }
      })
      return () => {
        cancelled = true
      }
    }
  }, [customPet, selectedAccessory])

  const displayStatus = resolveDisplayStatus(postureStatus)
  const cfg = STATUS_CONFIG[displayStatus]

  // The active sprite key.  Permadeath overrides posture.  In Wellness Mode
  // there is no camera, so an "away" status (which the detector broadcasts when
  // it releases the device) must not read as death — idle is the honest state.
  const activeKey: SpriteKey = isDead
    ? 'Death'
    : wellnessMode && postureStatus === 'away'
      ? 'Idle'
      : getSpriteKey(postureStatus)

  // ── Pokémon-style evolution cinematic state ───────────────────────────────
  const evolveBtnRef = useRef<HTMLButtonElement | null>(null)
  const petCircleRef = useRef<HTMLDivElement | null>(null)
  const [particles, setParticles] = useState<EvolveParticle[]>([])
  const [petCenter, setPetCenter] = useState<{ x: number; y: number } | null>(null)
  const [evolutionSpriteActive, setEvolutionSpriteActive] = useState(false)
  const [flashActive, setFlashActive] = useState(false)
  const [overlayMounted, setOverlayMounted] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(false)

  // The Evolve button click: play the Pokémon evolution start SFX, measure the
  // pet circle center, spawn the 3-phase Pokémon evolution particles, and hand
  // off to App (which sets isEvolving=true).
  const handleEvolveClick = () => {
    if (!canEvolve) return
    playEvolveArpeggio()

    const pet = petCircleRef.current
    if (pet) {
      const p = pet.getBoundingClientRect()
      setPetCenter({ x: p.left + p.width / 2, y: p.top + p.height / 2 })
    }

    setParticles(generatePokemonParticles())
    onEvolve()
  }

  // Drives the Pokémon evolution timeline off the isEvolving flag:
  //   t=0        Pokémon evolution start SFX, dark indigo arena fades in, energy spheres converge into pet
  //   t=500ms    Pokémon Evolution BGM ostinato starts + glowing white silhouette begins alternating morph
  //   t=5300ms   Evolution BGM fades out as silhouette swap reaches maximum speed
  //   t=5800ms   Climax white/cyan flash + expanding shockwave rings + Pokémon Evolution Complete fanfare + evolved sprite reveal
  //   t=7000ms   evolution sprite animationend → App sets isEvolving=false & isEvolved=true
  useEffect(() => {
    if (effectiveEvolving) {
      if (!petCenter && petCircleRef.current) {
        const p = petCircleRef.current.getBoundingClientRect()
        setPetCenter({ x: p.left + p.width / 2, y: p.top + p.height / 2 })
      }
      setParticles((prev) => (prev.length > 0 ? prev : generatePokemonParticles()))
      setOverlayMounted(true)
      setEvolutionSpriteActive(false)
      setFlashActive(false)
      // A short delay lets the opacity-0 state paint before we flip to 1, so the
      // 0.4s fade-in transition actually plays (avoids a hard pop on mount).
      const fadeTimer = window.setTimeout(() => setOverlayVisible(true), 20)
      const droneStart = window.setTimeout(() => startEvolveDrone(), 500)
      const droneStop = window.setTimeout(() => stopEvolveDrone(350), PARTICLES_MS - 500)
      const climax = window.setTimeout(() => {
        setEvolutionSpriteActive(true)
        setFlashActive(true)
        playEvolveFanfare()
      }, PARTICLES_MS)
      return () => {
        clearTimeout(fadeTimer)
        clearTimeout(droneStart)
        clearTimeout(droneStop)
        clearTimeout(climax)
        stopEvolveDrone(150) // safety: kill the loop if the cutscene tears down early
      }
    } else {
      setOverlayVisible(false)
      setEvolutionSpriteActive(false)
      setFlashActive(false)
      setParticles([])
      stopEvolveDrone(250) // completion fade — no lingering loop
      const timer = window.setTimeout(() => {
        setOverlayMounted(false)
        setPetCenter(null)
      }, OVERLAY_FADE_MS)
      return () => clearTimeout(timer)
    }
  }, [effectiveEvolving])

  // Model-safe fallback timer for pets that do not have a dedicated 8-frame
  // `evolution.png` sheet (custom pets imported without `evolution.png`).
  // Those keep their own Idle sprite visible during the climax and complete
  // evolution after `EVOLUTION_DURATION_MS` (1.2s).
  useEffect(() => {
    if (!evolutionSpriteActive) return
    const usesIdleFallback = customPet
      ? !(customPet.spriteUrls.evolution && customPet.manifest.animations.evolution)
      : false
    if (!usesIdleFallback) return
    const timer = window.setTimeout(() => {
      onEvolutionAnimEnd()
    }, EVOLUTION_DURATION_MS)
    return () => clearTimeout(timer)
  }, [evolutionSpriteActive, customPet, onEvolutionAnimEnd])

  // ── Notification → Attack animation hook ─────────────────────────────────
  // Listens for the `pet:notify` custom DOM event dispatched by App.tsx whenever
  // a notification is triggered. Plays the pet's attack animation (one-shot),
  // then automatically reverts to the idle/walk state when the animation ends.
  const [isAttacking, setIsAttacking] = useState(false)
  const attackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isEvolving || isDead) {
      if (attackTimerRef.current) {
        clearTimeout(attackTimerRef.current)
        attackTimerRef.current = null
      }
      setIsAttacking(false)
    }

    const handleNotify = () => {
      // Guard: never interrupt evolution or death
      if (isEvolving || isDead) return
      // Cancel any in-progress attack
      if (attackTimerRef.current) clearTimeout(attackTimerRef.current)
      setIsAttacking(true)
      // Attack animation duration: frames × frameDurationMs (default 150ms)
      const frames = customPet
        ? (customPet.manifest.animations.attack?.frames ?? 4)
        : (petModel === 'dog' || petModel === 'cat') && isEvolved
          ? EVOLVED_ANIMATION_FRAMES.Attack
          : ANIMATION_FRAMES.Attack
      const frameDurationMs = customPet
        ? (customPet.manifest.animations.attack?.frameDurationMs ?? 150)
        : 150
      const durationMs = frames * frameDurationMs
      attackTimerRef.current = setTimeout(() => {
        attackTimerRef.current = null
        setIsAttacking(false)
      }, durationMs)
    }

    window.addEventListener('pet:notify', handleNotify)
    return () => {
      window.removeEventListener('pet:notify', handleNotify)
      if (attackTimerRef.current) {
        clearTimeout(attackTimerRef.current)
        attackTimerRef.current = null
      }
      setIsAttacking(false)
    }
  }, [isEvolving, isDead, isEvolved, petModel, customPet])

  const effectiveAttacking = isAttacking && !isDead && !effectiveEvolving && !evolutionSpriteActive

  // ── Sprite URL resolution ─────────────────────────────────────────────────
  // One layer per animation state, stacked with opacity toggling.  The active
  // layer gets opacity-100; all others opacity-0.  This avoids swapping
  // background-image at runtime (which caused micro-stutter / flicker).
  // While the evolution sprite is active every base layer is hidden and the
  // one-shot evolution sheet takes over.
  const renderSpriteLayer = (key: SpriteKey) => {
    const resolved = customPet
      ? getCustomSpriteSheet(key, customPet, selectedAccessory)
      : getSpriteUrl(key, selectedAccessory, effectiveEvolved, petModel)
    const { url, frames, frameKey, overlayUrl, overlayFrames, overlayStatic } = resolved
    // The active layer stays visible unless the Pokémon evolution morph, evolution reveal
    // sprite, or attack animation is active.
    const isActive = !effectiveEvolving && !evolutionSpriteActive && !effectiveAttacking && key === activeKey
    // Geometry follows the sheet actually returned (frameKey), which can differ
    // from `key` when an accessorized fallback sheet was substituted.
    const usesEvolvedGeometry = !customPet && (petModel === 'dog' || petModel === 'cat') && effectiveEvolved
    const frameSize: number = customPet
      ? (resolved.tileSize ?? 64)
      : usesEvolvedGeometry
        ? EVOLVED_FRAME_SIZES[frameKey]
        : FRAME_SIZES[frameKey]

    // Extra CSS classes per animation type
    const extraClass =
      key === 'Hurt'  ? 'hurt-shake'  :
      key === 'Death' ? 'death-sprite' :
      ''

    // Base walk (both non-evolved dog and Pixel Cat) uses a dedicated CSS class
    // (.walk-sprite) because its 6-frame, 48×48px sheet needs a hardcoded -288px
    // keyframe offset. Evolved dog/cat walk and custom pet walk (64×64 tiles) are
    // driven by the generic `.sprite-base` CSS-var animation.
    const walkClass = !customPet && frameKey === 'Walk' && !usesEvolvedGeometry ? 'walk-sprite' : ''

    // Ground-plane alignment across all pet models so every model's paws rest
    // naturally on the pixel-art patch of grass:
    // - 48×48 walk sheets sit 8px higher when centered than 64×64 sheets, so
    //   nudging top by +12px lowers the centered box by +6px to match Idle paws.
    // - Custom pet 64×64 tiles have ~6px of bottom transparent margin below the paws,
    //   so nudging top by +6px lowers them by +3px onto the center of the turf.
    const groundOffsetTop = walkClass ? '12px' : customPet ? '6px' : undefined

    // For the Death layer only, once the death animation has run its full cycle
    // (deathFrozen), pin it on its final frame indefinitely.
    const isDeathFrozen = key === 'Death' && deathFrozen

    // Inline style that drives one animated sprite div (used for both the base
    // pet and its accessory overlay so both run the identical CSS animation).
    const frameDuration = usesEvolvedGeometry ? EVOLVED_FRAME_DURATIONS[frameKey] : undefined
    const useSyncedClock = usesEvolvedGeometry && !overlayStatic
    const spriteStyle = (imageUrl: string): React.CSSProperties => ({
      '--frame-size': `${frameSize}px`,
      '--frames': `${frames}`,
      '--frame-ms': frameDuration,
      '--pet-hue': `${petHue}deg`,
      backgroundImage: `url("${imageUrl}")`,
      filter: `hue-rotate(${petHue}deg)`,
      top: groundOffsetTop,
      animation: isDeathFrozen ? 'none' : undefined,
      backgroundPosition: isDeathFrozen
        ? `${-(frames - 1) * frameSize}px 0px`
        : undefined,
    } as React.CSSProperties)

    const petPrefix = customPet ? customPet.manifest.id : `builtin-${petModel}`
    // Restart the CSS animation when the model or accessory changes. Reusing
    // the old DOM node could swap in a new sheet halfway through its cycle,
    // which is especially noticeable on the denser evolved sheets.
    const layerKey = `${petPrefix}-${key}-${effectiveEvolved ? 'evolved' : 'base'}-${selectedAccessory}-${key === 'Death' ? isDead : ''}`
    const baseClasses = `${extraClass} ${walkClass} transition-opacity duration-150 ${isActive ? 'opacity-100' : 'opacity-0'}`

    // Accessory overlay: a wrapper sized to the frame that stacks the base dog
    // and the floating accessory.  An animated overlay carries identical
    // --frames / --frame-size so both step through tiles on the same clock; a
    // static overlay (no matching overlay sheet) holds its first tile.
    if (overlayUrl) {
      const overlayStyle: React.CSSProperties = overlayStatic
        ? {
            ...spriteStyle(overlayUrl),
            '--frames': `${overlayFrames ?? frames}`,
            top: undefined,
            animation: 'none',
            backgroundPosition: '0px 0px',
          } as React.CSSProperties
        : { ...spriteStyle(overlayUrl), top: undefined }
      return (
        <div
          key={layerKey}
          className={`absolute inset-0 m-auto ${baseClasses} ${useSyncedClock ? 'sync-clock' : ''}`}
          style={{
            width: frameSize,
            height: frameSize,
            top: groundOffsetTop,
            animation: !useSyncedClock
              ? undefined
              : `play-sprite calc(${frames} * ${frameDuration ?? '150ms'}) steps(${frames}) infinite`,
          }}
        >
          <div className="absolute inset-0 m-auto sprite-base" style={{ ...spriteStyle(url), top: undefined }} />
          <div className="absolute inset-0 m-auto sprite-base" style={overlayStyle} />
        </div>
      )
    }

    return (
      <div
        // Remount the Death layer when the alive/dead state flips so the death
        // animation always restarts cleanly from frame 0 on death.
        key={layerKey}
        className={`absolute inset-0 m-auto sprite-base ${baseClasses}`}
        style={spriteStyle(url)}
      />
    )
  }

  /** Static accessory tile (first frame of an overlay sheet) stacked on a
   *  64px one-shot layer that has no accessorized sheet of its own. */
  const renderStaticOverlay = (overlayUrl: string, overlayFrames: number, topOffset?: string) => (
    <div
      className="absolute inset-0 m-auto sprite-base pointer-events-none"
      style={{
        '--frame-size': '64px',
        '--frames': `${overlayFrames}`,
        '--pet-hue': `${petHue}deg`,
        backgroundImage: `url("${overlayUrl}")`,
        filter: `hue-rotate(${petHue}deg)`,
        top: topOffset,
        animation: 'none',
        backgroundPosition: '0px 0px',
      } as React.CSSProperties}
    />
  )

  // One-shot attack layer — visible only when isAttacking is true.
  // The attack animation is one-shot (infinite=false) so the pet returns to its
  // normal idle/walk pose automatically when the timer expires.
  const renderAttackLayer = () => {
    const resolved = customPet
      ? getCustomSpriteSheet('Attack', customPet, selectedAccessory)
      : getSpriteUrl('Attack', selectedAccessory, effectiveEvolved, petModel)
    const { url, frames, overlayUrl, overlayFrames } = resolved
    const tileSize: number = customPet ? (resolved.tileSize ?? 64) : 64
    const topOffset = customPet ? '6px' : undefined
    const attackFrameDuration = !customPet && (petModel === 'dog' || petModel === 'cat') && effectiveEvolved
      ? EVOLVED_FRAME_DURATIONS.Attack
      : undefined
    return (
      <>
        <div
          className="absolute inset-0 m-auto sprite-base"
          style={{
            '--frame-size': `${tileSize}px`,
            '--frames': `${frames}`,
            '--frame-ms': attackFrameDuration,
            '--pet-hue': `${petHue}deg`,
            backgroundImage: `url("${url}")`,
            filter: `hue-rotate(${petHue}deg)`,
            top: topOffset,
          } as React.CSSProperties}
        />
        {/* Keep the accessory if the attack sheet had to fall back to the bare
            evolved sheet (overlay is only returned in that case). */}
        {overlayUrl && renderStaticOverlay(overlayUrl, overlayFrames ?? frames, topOffset)}
      </>
    )
  }

  // One-shot evolution overlay (evolution.png, 8 frames at 64px = 512px wide strip).
  // Conditionally mounted so the CSS animation restarts cleanly on every evolution
  // (remount replays the @keyframes from frame 0 and holds the final frame with `forwards`).
  // The `onAnimationEnd` prop fires at t=1200ms when the sprite animation finishes,
  // giving us a pixel-accurate unmount without any setTimeout drift.
  //
  // Model-Safe Evolution Fallback (Pixel Cat & Custom Pets without evolution.png):
  // - If `petModel === 'cat'`, the cat does not have `evolution.png` or evolved 64×64 sheets.
  //   During the evolution transition climax, we keep the cat's own bare Idle sprite visible
  //   with `.evolution-blink` and never substitute the evolved
  //   yellow dog. After evolution completes (`isEvolved = true`), the cat continues using
  //   its own Idle, Walk, Hurt, Death, and Attack sheets.
  // - If a custom pet pack includes `evolution` (8 frames × 64px = 512px), it plays
  //   that custom evolution sheet directly; otherwise it falls back to its own `idle` sheet.
  const renderEvolutionLayer = () => {
    if (customPet) {
      const hasCustomEvo = !!(customPet.spriteUrls.evolution && customPet.manifest.animations.evolution)
      if (hasCustomEvo) {
        const evoSpec = customPet.manifest.animations.evolution!
        const sheetPx = evoSpec.frames * evoSpec.tileWidth
        return (
          <div
            className="absolute inset-0 m-auto evolution-sprite"
            onAnimationEnd={onEvolutionAnimEnd}
            style={{
              backgroundImage: `url("${customPet.spriteUrls.evolution}")`,
              filter: `hue-rotate(${petHue}deg)`,
              '--pet-hue': `${petHue}deg`,
              '--evo-sheet-px': `${sheetPx}px`,
            } as React.CSSProperties}
          />
        )
      }
      // Safe fallback when a custom pet pack omits `evolution`: keep the custom pet's
      // idle sprite visible with the evolution glow and complete after 1.2s.
      const idleSpec = customPet.manifest.animations.idle
      return (
        <div
          className="absolute inset-0 m-auto sprite-base evolution-blink"
          onAnimationEnd={onEvolutionAnimEnd}
          style={{
            '--frame-size': `${idleSpec.tileWidth}px`,
            '--frames': `${idleSpec.frames}`,
            '--pet-hue': `${petHue}deg`,
            backgroundImage: `url("${customPet.spriteUrls.idle}")`,
            filter: `hue-rotate(${petHue}deg)`,
          } as React.CSSProperties}
        />
      )
    }

    const url = petModel === 'cat'
      ? (CAT_EVOLVED_SPRITES['../assets/pets/cat/evolved/evolved_evolution.png']
        ?? CAT_EVOLVED_SPRITES['../assets/pets/cat/evolved/evolved_idle.png']
        ?? '')
      : (EVOLVED_SPRITES['../assets/pets/evolved/evolved_evolution.png']
        ?? EVOLVED_SPRITES['../assets/pets/evolved/evolved_idle.png']
        ?? '')
    return (
      <div
        className="absolute inset-0 m-auto evolution-sprite"
        // React's onAnimationEnd translates to the native animationend event on the DOM
        // element, fired at the instant the CSS animation completes.
        onAnimationEnd={onEvolutionAnimEnd}
        style={{
          backgroundImage: `url("${url}")`,
          filter: `hue-rotate(${petHue}deg)`,
          '--pet-hue': `${petHue}deg`,
          // Total width of the evolution.png strip (8 frames * 64px = 512px).
          // Injected as a CSS variable so background-size stays accurate; the inline
          // style always overrides the class default.
          '--evo-sheet-px': '512px',
        } as React.CSSProperties}
      />
    )
  }

  // Pokémon Evolution Silhouette Morph (0.0s–5.8s):
  // While `effectiveEvolving && !evolutionSpriteActive` is active, the pet turns into a
  // glowing white silhouette (`brightness(0) invert(1)`) and alternates between its
  // pre-evolved form and its evolved form at an accelerating pace.
  const renderPokemonMorphLayers = () => {
    const baseIdle = customPet
      ? getCustomSpriteSheet('Idle', customPet, 'none')
      : getSpriteUrl('Idle', 'none', false, petModel)
    const evolvedIdle = customPet
      ? getCustomSpriteSheet('Idle', customPet, 'none')
      : getSpriteUrl('Idle', 'none', true, petModel)
    const baseSize = customPet ? (baseIdle.tileSize ?? 64) : FRAME_SIZES.Idle
    const evoSize = customPet ? (evolvedIdle.tileSize ?? 64) : EVOLVED_FRAME_SIZES.Idle

    return (
      <>
        <div
          className="absolute inset-0 m-auto sprite-base pokemon-morph-base"
          style={{
            '--frame-size': `${baseSize}px`,
            '--frames': `${baseIdle.frames}`,
            backgroundImage: `url("${baseIdle.url}")`,
          } as React.CSSProperties}
        />
        <div
          className="absolute inset-0 m-auto sprite-base pokemon-morph-evolved"
          style={{
            '--frame-size': `${evoSize}px`,
            '--frames': `${evolvedIdle.frames}`,
            '--frame-ms': EVOLVED_FRAME_DURATIONS.Idle,
            backgroundImage: `url("${evolvedIdle.url}")`,
          } as React.CSSProperties}
        />
      </>
    )
  }

  // All animation layers are stacked and opacity-toggled. During evolution:
  //  - 0.0s–5.8s: `renderPokemonMorphLayers()` alternates glowing white silhouettes of the
  //               base form and evolved form at accelerating speed.
  //  - 5.8s–7.0s: `renderEvolutionLayer()` reveals the newly evolved form (`evolved_evolution.png`)
  //               and fires `onAnimationEnd` at completion.
  const renderStackedSprites = () => {
    // Build the list of sprite layers
    const spriteLayers = (['Idle', 'Walk', 'Hurt', 'Death'] as SpriteKey[]).map(renderSpriteLayer)

    // Non-evolved cat sheets use 48px tiles while evolved cat and dog sheets use 64px tiles.
    // Only scale up non-evolved cat so evolved cat stays at native 64×64 proportion like evolved dog.
    const shouldScaleBaseCat = petModel === 'cat' && !customPet && !effectiveEvolved && !effectiveEvolving && !evolutionSpriteActive

    return (
      <div
        className="relative w-full h-full flex items-center justify-center"
        style={shouldScaleBaseCat ? { transform: 'scale(1.33)' } : undefined}
      >
        {spriteLayers}
        {effectiveAttacking && renderAttackLayer()}
        {effectiveEvolving && !evolutionSpriteActive && renderPokemonMorphLayers()}
        {evolutionSpriteActive && renderEvolutionLayer()}
      </div>
    )
  }

  // Full-screen Pokémon Evolution cinematic:
  // Deep indigo/midnight-blue Pokémon evolution backdrop with a glowing cyan energy spotlight
  // around the pet, rotating evolution light beams, converging/radiating orbs & 4-point star
  // sparkles, and a blinding climax flash + expanding shockwave rings at reveal.
  const renderEvolutionCinematic = () => (
    <div
      className="evolve-overlay"
      style={{
        opacity: overlayVisible ? 1 : 0,
        background: petCenter
          ? `radial-gradient(circle at ${petCenter.x}px ${petCenter.y}px, rgba(56, 189, 248, 0.16) 0px, rgba(15, 23, 42, 0.25) 68px, rgba(8, 12, 32, 0.92) 150px)`
          : 'rgba(8, 12, 32, 0.92)',
      }}
    >
      {petCenter && (
        <>
          {/* Rotating Pokémon evolution light beams behind the spotlight */}
          <div
            className="evolve-light-rays"
            style={{ left: petCenter.x, top: petCenter.y }}
          />
          <div
            className="evolve-spotlight"
            style={{
              left: petCenter.x,
              top: petCenter.y,
              animation: `evolve-spotlight-pulse 0.85s ease-in-out infinite, evolve-shake 0.45s ease-in-out 0.05s, evolve-shake 0.6s ease-in-out ${PARTICLES_MS}ms`,
            }}
          />
        </>
      )}
      {flashActive && petCenter && (
        <>
          <div className="evolve-flash" style={{ left: petCenter.x, top: petCenter.y }} />
          <div className="evolve-shockwave" style={{ left: petCenter.x, top: petCenter.y }} />
          <div
            className="evolve-shockwave"
            style={{ left: petCenter.x, top: petCenter.y, animationDelay: '140ms' }}
          />
        </>
      )}
      {petCenter && particles.map((p) => {
        if (p.phase === 'climax' && !flashActive) return null
        const animName =
          p.phase === 'gather'
            ? 'pokemon-particle-gather'
            : p.phase === 'radiate'
              ? 'pokemon-particle-radiate'
              : 'pokemon-particle-climax'
        const delay = p.phase === 'climax' ? p.delayMs : p.delayMs
        return (
          <div
            key={p.id}
            className={`evolve-particle ${p.shape === 'star' ? 'evolve-particle-star' : ''}`}
            style={{
              left: petCenter.x,
              top: petCenter.y,
              width: p.size,
              height: p.size,
              marginLeft: -p.size / 2,
              marginTop: -p.size / 2,
              background: p.color,
              boxShadow: `0 0 8px 2px ${p.color}, 0 0 18px 5px ${p.glowColor}`,
              '--sx': `${p.sx}px`,
              '--sy': `${p.sy}px`,
              '--ex': `${p.ex}px`,
              '--ey': `${p.ey}px`,
              animation: `${animName} ${p.durationMs}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms both`,
            } as React.CSSProperties}
          />
        )
      })}
    </div>
  )

  // Resolve status text
  const statusText = (() => {
    if (isDead) {
      return petName ? `${petName} passed away from poor posture...` : 'Your pet passed away from poor posture...'
    }
    if (displayStatus === 'calibrating' || displayStatus === 'calibrated') return cfg.text
    if (!isWorkPhase && postureStatus !== 'away' && postureStatus !== 'unknown') {
      return 'Break time — but keep that posture!'
    }
    return cfg.text
  })()

  // Resolve atmospheric mood for the pixel-art grass habitat & sky
  const envMood: EnvironmentMood = isDead
    ? 'dead'
    : displayStatus === 'calibrating'
      ? 'calibrating'
      : !wellnessMode && displayStatus === 'slouching'
        ? 'slouching'
        : !wellnessMode && displayStatus === 'away'
          ? 'away'
          : !isWorkPhase
            ? 'break'
            : 'sunny'

  // ─── TASKBAR MODE ─────────────────────────────────────────────────────────
  if (mode === 'taskbar') {
    // Fill whatever square the parent gives us (src/App.tsx sizes the pet
    // circle). The mild scale-up keeps the 64px sprite looking proportionate
    // in the larger 180×180 taskbar window. w-full h-full prevents the
    // absolutely-positioned sprite layers from collapsing or being clipped.
    return (
      <PetEnvironment mood={envMood}>
        <div
          className="w-full h-full flex items-center justify-center relative"
          style={{ transform: 'scale(1.15)' }}
        >
          {renderStackedSprites()}
        </div>
      </PetEnvironment>
    )
  }

  // ─── DASHBOARD MODE ───────────────────────────────────────────────────────
  return (
    <>
    <div className={`relative overflow-hidden w-full ${cfg.bg} rounded-xl flex flex-col items-center gap-3 p-4 transition-colors duration-700`}>
      {/* Ambient outdoor meadow border along the bottom of the card */}
      <svg
        viewBox="0 0 320 28"
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-5 w-full opacity-55"
      >
        <rect x="0" y="20" width="320" height="8" fill={isDead ? '#a8a29e' : '#86efac'} />
        <rect x="0" y="24" width="320" height="4" fill={isDead ? '#78716c' : '#4ade80'} />
        {/* Left & right corner pixel grass tufts */}
        <rect x="10" y="14" width="3" height="8" fill={isDead ? '#78716c' : '#22c55e'} />
        <rect x="14" y="12" width="3" height="10" fill={isDead ? '#a8a29e' : '#4ade80'} />
        <rect x="18" y="15" width="3" height="7" fill={isDead ? '#57534e' : '#16a34a'} />
        <rect x="28" y="16" width="4" height="4" fill={isDead ? '#d6d3d1' : '#ffffff'} />
        <rect x="29" y="17" width="2" height="2" fill={isDead ? '#78716c' : '#facc15'} />
        <rect x="286" y="16" width="4" height="4" fill={isDead ? '#d6d3d1' : '#f472b6'} />
        <rect x="287" y="17" width="2" height="2" fill={isDead ? '#78716c' : '#facc15'} />
        <rect x="298" y="15" width="3" height="7" fill={isDead ? '#57534e' : '#16a34a'} />
        <rect x="302" y="12" width="3" height="10" fill={isDead ? '#a8a29e' : '#4ade80'} />
        <rect x="306" y="14" width="3" height="8" fill={isDead ? '#78716c' : '#22c55e'} />
      </svg>

      {/* Pet name banner (shown when named) */}
      {petName && (
        <div className="relative z-10 flex items-center gap-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border/60 px-2.5 py-0.5 shadow-xs">
          <span className="text-xs font-semibold text-foreground">{petName}</span>
        </div>
      )}

      {/* Pet sprite with glow ring and pixel-art patch of grass */}
      <div className="relative z-10 flex items-center justify-center">
        <div
          ref={petCircleRef}
          className={`w-28 h-28 rounded-full bg-muted ring-2 ${cfg.ring} flex items-center justify-center overflow-hidden transition-all duration-700`}
          style={{ boxShadow: cfg.glow }}
        >
          <PetEnvironment mood={envMood}>
            {renderStackedSprites()}
          </PetEnvironment>
        </div>
      </div>

      {/* Calibrate / Evolve / Adopt button */}
      <div className="relative z-10 w-full">
        {isDead ? (
          <div className="space-y-1.5">
            <Button
              variant="destructive"
              className="w-full gap-2"
              onClick={onAdoptNewPet}
            >
              <HeartIcon /> {customPet ? 'Adopt a New Pet' : petModel === 'cat' ? 'Adopt a New Cat' : 'Adopt a New Dog'}
            </Button>
            {onOpenGraveyard && (
              <Button
                variant="outline"
                className="w-full gap-2 font-mono text-xs border-slate-300"
                onClick={onOpenGraveyard}
              >
                Visit Graveyard
              </Button>
            )}
          </div>
        ) : canEvolve && petLevel >= 10 && !effectiveEvolved && !effectiveEvolving ? (
          <Button
            ref={evolveBtnRef}
            variant="default"
            tactile={false}
            className="w-full gap-2 font-semibold text-amber-100"
            onClick={handleEvolveClick}
          >
            Evolve
          </Button>
        ) : wellnessMode ? (
          /* Wellness Mode is camera-free: calibration cannot run, so it is
             replaced by the manual self-report from UC-4 step 4. It is
             rate-limited by the shared Wellness cooldown. */
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={onSelfReport}
            disabled={selfReportCooldown > 0}
            title={selfReportCooldown > 0 ? `Available in ${selfReportCooldown}s` : 'Earn XP for sitting up straight'}
          >
            <TargetIcon /> {selfReportCooldown > 0 ? `I'm Aligned (${selfReportCooldown}s)` : "I'm Aligned"}
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={onCalibrate}
            disabled={displayStatus === 'calibrating'}
          >
            {displayStatus === 'calibrating'
              ? 'Calibrating… hold still!'
              : (<><TargetIcon /> Calibrate Posture</>)
            }
          </Button>
        )}
      </div>

      {/* Status text */}
      <p className="relative z-10 text-muted-foreground text-center text-xs font-medium leading-snug">
        {wellnessMode && !isDead
          ? 'Wellness Mode — no camera in use.'
          : statusText}
      </p>

      {/* Status badge — posture badges are meaningless without a camera */}
      {!wellnessMode && (
        <Badge variant="secondary" className={`relative z-10 ${isDead ? 'bg-red-100 text-red-800' : `${cfg.label} capitalize`}`}>
          {isDead ? 'Deceased' : displayStatus}
        </Badge>
      )}
    </div>

    {overlayMounted && renderEvolutionCinematic()}
    </>
  )
}
