import { useState, useEffect } from 'react'
import type { PostureData } from '../types/electron'
// The `?inline` suffix forces Vite to embed each sheet as a base64 data URL in
// the PRODUCTION bundle, so packaged builds make zero image requests at
// runtime. In dev, Vite serves the sheet through its module graph (a
// `/src/assets/...` URL generated at build time) — the same pipeline that
// serves the page itself, never the `public/` static middleware. Either way
// the URL cannot be mistyped, cannot go stale, and cannot break on restarts.
// (These sheets are ~1.4 KB each, so inlining adds only a few KB.)
import idleSprite from '../assets/Idle.png?inline'
import hurtSprite from '../assets/Hurt.png?inline'
import deathSprite from '../assets/Death.png?inline'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

type PostureStatus = PostureData['status'] | 'unknown' | 'calibrating' | 'calibrated'

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
}

// ─────────────────────────────────────────────────────────────────────────────
// SPRITE CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
// The sprite sheets are imported as Vite modules (with the `?inline` suffix)
// instead of being referenced by hand-typed "/assets/*.png" URLs. This is what
// makes the sprites immune to dev-server / restart failures: in production the
// image bytes are embedded directly in the JavaScript bundle as data URLs, and
// in dev the sheets are served through Vite's module graph from the same
// server that serves the page — no zombie Vite instance, stale `public/`
// middleware, or cleared cache can make them disappear. If a sheet is
// replaced, the bundle rebuilds with the new bytes; the URL cannot go stale or
// be mistyped.
interface SpriteSheet {
  key: string
  url: string
  frames: number
}

const SPRITE_SHEETS = {
  Idle:  { key: 'Idle',  url: idleSprite,  frames: 4 },
  Hurt:  { key: 'Hurt',  url: hurtSprite,  frames: 2 },
  Death: { key: 'Death', url: deathSprite, frames: 4 },
} as const satisfies Record<string, SpriteSheet>

type SpriteKey = keyof typeof SPRITE_SHEETS

/** The one sprite that is guaranteed to render, no matter what. */
const DEFAULT_SPRITE_KEY: SpriteKey = 'Idle'

/**
 * Map every posture state to a known sprite key. This switch is total: any
 * unrecognised status — including malformed payloads from stale or zombie
 * backends — resolves to the default sprite instead of producing an invalid
 * image path that renders as nothing.
 */
function getSpriteKey(status: PostureStatus): SpriteKey {
  switch (status) {
    case 'good':      return 'Idle'
    case 'slouching': return 'Hurt'
    case 'calibrating':
    case 'away':      return 'Death'
    default:          return DEFAULT_SPRITE_KEY // 'unknown' / 'calibrated' / junk
  }
}

// Preload every sheet as soon as the module loads. With data-URL sprites this
// is a local no-op, but it guarantees that any build variant that emits real
// files has them cached before the first paint.
for (const sheet of Object.values(SPRITE_SHEETS)) {
  const img = new Image()
  img.src = sheet.url
}

// ─── Per-status UI config (colors, text, glow) ─────────────────────────────
// Tuned for the light Shadcn `bg-background` theme: tinted backgrounds with
// dark text so everything stays readable on a white card.
const STATUS_CONFIG = {
  good: {
    glow:       '0 0 24px 8px rgba(74,222,128,0.55)',
    ring:       'ring-green-500',
    bg:         'bg-green-50',
    label:      'bg-green-100 text-green-800',
    text:       'Great posture! Keep it up! 💪',
  },
  slouching: {
    glow:       '0 0 24px 8px rgba(248,113,113,0.55)',
    ring:       'ring-red-500',
    bg:         'bg-red-50',
    label:      'bg-red-100 text-red-800',
    text:       'Slouching detected! Sit up straight! ⚠️',
  },
  away: {
    glow:       '0 0 20px 6px rgba(250,204,21,0.4)',
    ring:       'ring-amber-500',
    bg:         'bg-amber-50',
    label:      'bg-amber-100 text-amber-800',
    text:       'Come back soon! 🔍',
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
    text:       'Calibrating... hold still! 🧘',
  },
  calibrated: {
    glow:       '0 0 24px 8px rgba(74,222,128,0.7)',
    ring:       'ring-green-500',
    bg:         'bg-green-50',
    label:      'bg-green-100 text-green-800',
    text:       'Calibration saved! 🎉',
  },
}

/**
 * Derive what state the pet should visually display.
 */
function resolveDisplayStatus(
  postureStatus: PostureStatus,
): keyof typeof STATUS_CONFIG {
  if (postureStatus === 'calibrating') return 'calibrating'
  if (postureStatus === 'calibrated')  return 'calibrated'
  if (postureStatus === 'unknown')     return 'unknown'
  if (postureStatus === 'away')        return 'away'
  if (postureStatus === 'good')        return 'good'
  if (postureStatus === 'slouching')   return 'slouching'
  return 'unknown'
}

export default function PetDisplay({ mode, isWorkPhase, postureStatus, onCalibrate, petHue, isDead, onAdoptNewPet }: PetDisplayProps) {

  const displayStatus = resolveDisplayStatus(postureStatus)
  const cfg = STATUS_CONFIG[displayStatus]

  // ─── Sprite rendering (DOM stacking) ──────────────────────────────────────
  // All three sheets are pre-rendered as absolutely-positioned layers stacked
  // on the same anchor, so a posture change only toggles `opacity` between the
  // layers. The browser never has to swap a live node's background-image
  // source — that repaint was causing the micro-stutter / flicker. Each
  // fixed-size layer is centered with `inset-0` + `m-auto`, and all layers
  // share the same rules so they stack exactly on top of one another.
  // Permadeath overrides posture: a dead pet always shows the Death sprite.
  const activeKey: SpriteKey = isDead ? 'Death' : getSpriteKey(postureStatus)

  // ── Death animation freeze ────────────────────────────────────────────────
  // The Death sheet plays on the standard infinite `.sprite-base` loop. Once a
  // genuinely dead pet has run it for 1200ms, we stop the animation and lock
  // `background-position` at 100% (the sheet's right edge), which pins the
  // sprite to its final frame.
  const [freezeDeath, setFreezeDeath] = useState(false)
  useEffect(() => {
    if (activeKey === 'Death') {
      // Wait for the death animation to finish, then freeze it
      const timer = setTimeout(() => setFreezeDeath(true), 1200)
      return () => clearTimeout(timer)
    } else {
      setFreezeDeath(false)
    }
  }, [activeKey])

  // Freeze applies ONLY to genuine permadeath. `isDead` is the extra gate
  // because the calibrating / away states also resolve to the Death sprite key
  // (see getSpriteKey) — they must keep looping infinitely, never freeze.
  const shouldFreeze = isDead && freezeDeath

  const renderStackedSprites = () => (
    <div className="relative w-full h-full flex items-center justify-center">
      <div
        className={`absolute inset-0 m-auto sprite-base frames-4 transition-opacity duration-75 ${activeKey === 'Idle' ? 'opacity-100' : 'opacity-0'}`}
        style={{
          backgroundImage: `url("${idleSprite}")`,
          filter: `hue-rotate(${petHue}deg)`,
          animation: shouldFreeze ? 'none' : undefined,
          backgroundPosition: shouldFreeze ? '100% center' : undefined,
        }}
      />
      <div
        className={`absolute inset-0 m-auto sprite-base frames-2 hurt-shake transition-opacity duration-75 ${activeKey === 'Hurt' ? 'opacity-100' : 'opacity-0'}`}
        style={{
          backgroundImage: `url("${hurtSprite}")`,
          filter: `hue-rotate(${petHue}deg)`,
          animation: shouldFreeze ? 'none' : undefined,
          backgroundPosition: shouldFreeze ? '100% center' : undefined,
        }}
      />
      <div
        className={`absolute inset-0 m-auto sprite-base frames-4 transition-opacity duration-75 ${activeKey === 'Death' ? 'opacity-100' : 'opacity-0'}`}
        style={{
          backgroundImage: `url("${deathSprite}")`,
          filter: `hue-rotate(${petHue}deg)`,
          animation: shouldFreeze ? 'none' : undefined,
          backgroundPosition: shouldFreeze ? '100% center' : undefined,
        }}
      />
    </div>
  )

  // Resolve status text
  const statusText = (() => {
    if (isDead) return 'Your pet passed away from poor posture... 🪦'
    if (displayStatus === 'calibrating' || displayStatus === 'calibrated') return cfg.text
    if (!isWorkPhase && postureStatus !== 'away' && postureStatus !== 'unknown') {
      return 'Break time — but keep that posture! 🧘'
    }
    return cfg.text
  })()

  // ─── TASKBAR MODE: Minimal transparent widget ──────────────────────────────
  // Hardcoded 150x150 (matching the taskbar window size in main.ts) so the
  // absolutely-positioned sprite layers never collapse to 0x0 if the OS
  // resizes the window mid-transition. overflow-hidden clips any sub-pixel
  // bleed from the sprite shake animation.
  if (mode === 'taskbar') {
    return (
      <div className="w-[150px] h-[150px] flex items-center justify-center relative overflow-hidden">
        {renderStackedSprites()}
      </div>
    )
  }

  // ─── DASHBOARD MODE: Full UI with Shadcn Button + Badge ────────────────────
  return (
    <div className={`w-full ${cfg.bg} rounded-xl flex flex-col items-center gap-3 p-4 transition-colors duration-700`}>

      {/* Pet sprite */}
      <div className="relative flex items-center justify-center">
        {/* Glow ring around sprite */}
        <div
          className={`w-24 h-24 rounded-full bg-muted ring-2 ${cfg.ring} flex items-center justify-center transition-all duration-700`}
          style={{ boxShadow: cfg.glow }}
        >
          {renderStackedSprites()}
        </div>
      </div>

      {/* Calibrate button — replaced by the adopt button while dead */}
      {isDead ? (
        <Button
          variant="destructive"
          className="w-full"
          onClick={onAdoptNewPet}
        >
          🐾 Adopt a New Dog
        </Button>
      ) : (
        <Button
          variant="outline"
          className="w-full"
          onClick={onCalibrate}
          disabled={displayStatus === 'calibrating'}
        >
          {displayStatus === 'calibrating' ? '⏳ Calibrating… hold still!' : '🎯 Calibrate Posture'}
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
