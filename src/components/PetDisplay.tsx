import { useState, useEffect } from 'react'
import type { PostureData } from '../types/electron'
import { type AnimationState, type AccessoryType, ANIMATION_FRAMES } from '../types/accessories'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { TargetIcon, HeartIcon } from './icons'

// ─────────────────────────────────────────────────────────────────────────────
// SPRITE SHEET REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
// All sprite sheets are imported as Vite modules (with the `?inline` suffix)
// so that in production the image bytes are embedded directly in the JS bundle
// as data URLs — zero runtime fetches, immune to restart / public/ path issues.
//
// We use Vite's `import.meta.glob` with eager: true to build a compile-time
// registry of all available sprite URLs.  Missing combinations (e.g. Walk with
// an accessory that hasn't been drawn yet) fall back to the base Walk.png.

const ALL_SPRITES = import.meta.glob('../assets/pets/*.png', { eager: true, query: '?inline', import: 'default' }) as Record<string, string>

/** Sprite metadata for a single animation frame sheet. */
interface SpriteSheet {
  url: string
  frames: number
}

/**
 * Frame sizes per animation.
 * Most animations use 64×64px frames, but Walk uses 48×48px (6 frames = 288px wide).
 */
const FRAME_SIZES: Record<AnimationState, number> = {
  Idle: 64,
  Walk: 48,
  Hurt: 64,
  Death: 64,
}

/**
 * Look up the sprite sheet URL for a given animation + accessory combination.
 * If the specific combination doesn't exist (e.g. Walk_wizardhat.png), falls
 * back to the base animation (Walk.png).  Returns the base Idle sprite as the
 * final fallback.
 */
function getSpriteUrl(animation: AnimationState, accessory: AccessoryType): SpriteSheet {
  const frames = ANIMATION_FRAMES[animation]

  if (accessory !== 'none') {
    const accessorized = `../assets/pets/${animation}_${accessory}.png`
    const url = ALL_SPRITES[accessorized]
    if (url) return { url, frames }
    // Fall back to base animation — don't crash on missing baked sheets
    const base = `../assets/pets/${animation}.png`
    const baseUrl = ALL_SPRITES[base]
    if (baseUrl) return { url: baseUrl, frames }
  } else {
    const base = `../assets/pets/${animation}.png`
    const url = ALL_SPRITES[base]
    if (url) return { url, frames }
  }

  // Ultimate fallback: Idle.png (guaranteed to exist)
  const idleUrl = ALL_SPRITES['../assets/pets/Idle.png'] ?? ''
  return { url: idleUrl, frames: ANIMATION_FRAMES['Idle'] }
}

// Preload all sprite sheets at module load time. With data-URL inlining this
// is a cheap no-op in production, but ensures assets are ready for first paint.
for (const url of Object.values(ALL_SPRITES)) {
  const img = new Image()
  img.src = url
}

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
}: PetDisplayProps) {

  const displayStatus = resolveDisplayStatus(postureStatus)
  const cfg = STATUS_CONFIG[displayStatus]

  // The active sprite key.  Permadeath overrides posture.
  const activeKey: SpriteKey = isDead ? 'Death' : getSpriteKey(postureStatus)

  // ── Death animation freeze ────────────────────────────────────────────────
  // The Death sheet plays on the standard infinite `.sprite-base` loop.  Once a
  // genuinely dead pet has run it for 1200 ms we stop the animation and pin
  // `background-position` at 100% (the sheet's right edge), locking on the
  // final frame.
  const [freezeDeath, setFreezeDeath] = useState(false)
  useEffect(() => {
    if (activeKey === 'Death') {
      const timer = setTimeout(() => setFreezeDeath(true), 1200)
      return () => clearTimeout(timer)
    } else {
      setFreezeDeath(false)
    }
  }, [activeKey])

  // Freeze applies ONLY to genuine permadeath.  `isDead` is the extra gate
  // because calibrating / away states also resolve to Death — they must keep
  // looping indefinitely.
  const shouldFreeze = isDead && freezeDeath

  // ── Sprite URL resolution ─────────────────────────────────────────────────
  // One layer per animation state, stacked with opacity toggling.  The active
  // layer gets opacity-100; all others opacity-0.  This avoids swapping
  // background-image at runtime (which caused micro-stutter / flicker).
  const renderSpriteLayer = (key: SpriteKey) => {
    const { url, frames } = getSpriteUrl(key, selectedAccessory)
    const isActive = key === activeKey
    const frameSize = FRAME_SIZES[key]

    // Extra CSS classes based on animation type
    const extraClass = key === 'Hurt' ? 'hurt-shake' : ''
    // Walk uses a dedicated CSS class (.walk-sprite) because its 6-frame,
    // 48×48px sheet needs a hardcoded -288px keyframe offset
    const walkClass = key === 'Walk' ? 'walk-sprite' : ''

    return (
      <div
        key={key}
        className={`absolute inset-0 m-auto sprite-base ${extraClass} ${walkClass} transition-opacity duration-75 ${isActive ? 'opacity-100' : 'opacity-0'}`}
        style={{
          // Override CSS variables per-layer so each animation gets the right
          // frame count and frame size.  The `.sprite-base` defaults (64px,
          // steps(N) from frames-N utility) are overridden here inline.
          '--frame-size': `${frameSize}px`,
          '--frames': `${frames}`,
          backgroundImage: `url("${url}")`,
          filter: `hue-rotate(${petHue}deg)`,
          animation: shouldFreeze ? 'none' : undefined,
          backgroundPosition: shouldFreeze ? '100% center' : undefined,
        } as React.CSSProperties}
      />
    )
  }

  const renderStackedSprites = () => (
    <div className="relative w-full h-full flex items-center justify-center">
      {(['Idle', 'Walk', 'Hurt', 'Death'] as SpriteKey[]).map(renderSpriteLayer)}
    </div>
  )

  // Resolve status text
  const statusText = (() => {
    if (isDead) return 'Your pet passed away from poor posture...'
    if (displayStatus === 'calibrating' || displayStatus === 'calibrated') return cfg.text
    if (!isWorkPhase && postureStatus !== 'away' && postureStatus !== 'unknown') {
      return 'Break time — but keep that posture!'
    }
    return cfg.text
  })()

  // ─── TASKBAR MODE ─────────────────────────────────────────────────────────
  if (mode === 'taskbar') {
    // Fill whatever square the parent gives us (src/App.tsx sizes the pet
    // circle). The mild scale-up keeps the 64px sprite looking proportionate
    // in the larger 180×180 taskbar window. w-full h-full prevents the
    // absolutely-positioned sprite layers from collapsing or being clipped.
    return (
      <div
        className="w-full h-full flex items-center justify-center relative overflow-hidden"
        style={{ transform: 'scale(1.15)' }}
      >
        {renderStackedSprites()}
      </div>
    )
  }

  // ─── DASHBOARD MODE ───────────────────────────────────────────────────────
  return (
    <div className={`w-full ${cfg.bg} rounded-xl flex flex-col items-center gap-3 p-4 transition-colors duration-700`}>

      {/* Pet sprite with glow ring */}
      <div className="relative flex items-center justify-center">
        <div
          className={`w-24 h-24 rounded-full bg-muted ring-2 ${cfg.ring} flex items-center justify-center transition-all duration-700`}
          style={{ boxShadow: cfg.glow }}
        >
          {renderStackedSprites()}
        </div>
      </div>

      {/* Calibrate / Adopt button */}
      {isDead ? (
        <Button
          variant="destructive"
          className="w-full gap-2"
          onClick={onAdoptNewPet}
        >
          <HeartIcon /> Adopt a New Dog
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

      {/* Status text */}
      <p className="text-muted-foreground text-center text-xs font-medium leading-snug">
        {statusText}
      </p>

      {/* Status badge */}
      <Badge variant="secondary" className={isDead ? 'bg-red-100 text-red-800' : `${cfg.label} capitalize`}>
        {isDead ? 'Deceased' : displayStatus}
      </Badge>
    </div>
  )
}
