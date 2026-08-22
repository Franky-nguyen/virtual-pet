import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
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

type PostureStatus = PostureData['status'] | 'unknown' | 'calibrating' | 'calibrated'

interface PetDisplayProps {
  mode: 'dashboard' | 'taskbar'
  isWorkPhase: boolean
  postureStatus: PostureStatus
  xp: number
  level: number
  onCalibrate: () => void
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
const STATUS_CONFIG = {
  good: {
    glow:       '0 0 24px 8px rgba(74,222,128,0.55)',
    ring:       'ring-green-400',
    bg:         'bg-green-400/20',
    label:      'bg-green-400/30 text-green-100',
    text:       'Great posture! Keep it up! 💪',
    xpBarColor: 'bg-green-400',
  },
  slouching: {
    glow:       '0 0 24px 8px rgba(248,113,113,0.55)',
    ring:       'ring-red-400',
    bg:         'bg-red-400/20',
    label:      'bg-red-400/30 text-red-100',
    text:       'Slouching detected! Sit up straight! ⚠️',
    xpBarColor: 'bg-red-400',
  },
  away: {
    glow:       '0 0 20px 6px rgba(250,204,21,0.4)',
    ring:       'ring-yellow-400',
    bg:         'bg-yellow-400/20',
    label:      'bg-yellow-400/30 text-yellow-100',
    text:       'Come back soon! 🔍',
    xpBarColor: 'bg-yellow-400',
  },
  unknown: {
    glow:       '0 0 16px 4px rgba(255,255,255,0.2)',
    ring:       'ring-white/40',
    bg:         'bg-white/10',
    label:      'bg-white/20 text-white/70',
    text:       'Connecting to camera...',
    xpBarColor: 'bg-white/40',
  },
  calibrating: {
    glow:       '0 0 24px 10px rgba(139,92,246,0.6)',
    ring:       'ring-violet-400',
    bg:         'bg-violet-400/20',
    label:      'bg-violet-400/30 text-violet-100',
    text:       'Calibrating... hold still! 🧘',
    xpBarColor: 'bg-violet-400',
  },
  calibrated: {
    glow:       '0 0 24px 8px rgba(74,222,128,0.7)',
    ring:       'ring-green-400',
    bg:         'bg-green-400/20',
    label:      'bg-green-400/30 text-green-100',
    text:       'Calibration saved! 🎉',
    xpBarColor: 'bg-green-400',
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

export default function PetDisplay({ mode, isWorkPhase, postureStatus, xp, level, onCalibrate }: PetDisplayProps) {

  const displayStatus = resolveDisplayStatus(postureStatus)
  const cfg = STATUS_CONFIG[displayStatus]

  // ─── Bulletproof sprite selection ──────────────────────────────────────────
  // A <div> with a background-image fails silently, so an invisible probe <img>
  // is the only way to learn that a sheet could not be loaded. If that ever
  // happens (e.g. a missing file in a partial build), we swap to the default
  // Idle sheet instead of rendering an empty pet. The fallback clears whenever
  // the requested status changes.
  const spriteKey = getSpriteKey(postureStatus)
  const [spriteLoadFailed, setSpriteLoadFailed] = useState(false)
  useEffect(() => {
    setSpriteLoadFailed(false)
  }, [spriteKey])
  const activeKey: SpriteKey = spriteLoadFailed ? DEFAULT_SPRITE_KEY : spriteKey
  const sprite = SPRITE_SHEETS[activeKey]

  // The key forces a fresh DOM node per sheet, which naturally restarts the
  // CSS step animation whenever the sprite changes.
  const renderSprite = (extraClass = '') => (
    <div
      key={activeKey}
      className={`pixel-pet ${extraClass} ${postureStatus === 'slouching' ? 'pixel-pet--hurt' : ''}`}
      style={{ backgroundImage: `url("${sprite.url}")`, '--frames': sprite.frames } as React.CSSProperties}
    />
  )

  // Invisible probe: reports load failures for the active sheet. The src is
  // rendered only if a real <img> is present in the DOM; opacity/pointer-events
  // hide it without using display:none so loading still fires reliably.
  const spriteProbe = (
    <img
      src={sprite.url}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="pet-sprite-probe"
      onError={() => setSpriteLoadFailed(true)}
    />
  )

  // ─── XP bar animation ───────────────────────────────────────────────────────
  const barRef = useRef<HTMLDivElement>(null)
  const prevXpRef = useRef(xp)
  useEffect(() => {
    if (barRef.current) {
      barRef.current.style.setProperty('--xp-from', `${prevXpRef.current}%`)
      barRef.current.style.setProperty('--xp-to', `${xp}%`)
      barRef.current.style.animation = 'none'
      void barRef.current.offsetWidth  // force reflow
      barRef.current.style.animation = 'xp-bar 0.4s ease forwards'
    }
    prevXpRef.current = xp
  }, [xp])

  // Resolve status text
  const statusText = (() => {
    if (displayStatus === 'calibrating' || displayStatus === 'calibrated') return cfg.text
    if (!isWorkPhase && postureStatus !== 'away' && postureStatus !== 'unknown') {
      return 'Break time — but keep that posture! 🧘'
    }
    return cfg.text
  })()

  // ─── TASKBAR MODE: Minimal widget ───────────────────────────────────────────
  if (mode === 'taskbar') {
    return (
      <div className="pixel-pet-container">
        {renderSprite('pixel-pet--taskbar')}
        {spriteProbe}
      </div>
    )
  }

  // ─── DASHBOARD MODE: Full UI with XP, calibrate button, etc. ────────────────
  return (
    <div className={`w-full ${cfg.bg} backdrop-blur-sm rounded-2xl p-4 flex flex-col items-center gap-3 transition-colors duration-700`}>

      {/* Level badge + XP bar row */}
      <div className="w-full flex items-center gap-3">
        {/* Level badge */}
        <div className="shrink-0 w-8 h-8 rounded-full bg-white/20 ring-2 ring-white/40 flex items-center justify-center">
          <span className="text-white text-xs font-bold leading-none">L{level}</span>
        </div>

        {/* XP bar track */}
        <div className="flex-1 flex flex-col gap-0.5">
          <div className="flex justify-between">
            <span className="text-white/70 text-[10px] font-semibold uppercase tracking-wider">XP</span>
            <span className="text-white/70 text-[10px]">{xp}/100</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/20 overflow-hidden">
            <div
              ref={barRef}
              className={`h-full rounded-full ${cfg.xpBarColor}`}
              style={{ width: `${xp}%` }}
            />
          </div>
        </div>
      </div>

      {/* Pet sprite */}
      <div className="relative flex items-center justify-center">
        {/* Glow ring around sprite */}
        <div
          className={`w-24 h-24 rounded-full bg-white/10 ring-2 ${cfg.ring} flex items-center justify-center transition-all duration-700`}
          style={{ boxShadow: cfg.glow }}
        >
          {renderSprite()}
          {spriteProbe}
        </div>
      </div>

      {/* Calibrate button */}
      <button
        onClick={onCalibrate}
        disabled={displayStatus === 'calibrating'}
        className={[
          'w-full py-2 rounded-xl text-xs font-semibold tracking-wide',
          'transition-all duration-300 select-none border',
          displayStatus === 'calibrating'
            ? 'bg-violet-400/20 text-violet-200 border-violet-400/30 cursor-not-allowed opacity-70'
            : 'bg-white/15 text-white border-white/20 hover:bg-white/25 active:scale-95 cursor-pointer',
        ].join(' ')}
      >
        {displayStatus === 'calibrating' ? '⏳ Calibrating… hold still!' : '🎯 Calibrate Posture'}
      </button>

      {/* Status text */}
      <p className="text-white text-center text-xs font-medium leading-snug">
        {statusText}
      </p>

      {/* Status badge */}
      <div className={`px-3 py-1 rounded-lg transition-colors duration-500 ${cfg.label}`}>
        <span className="text-[10px] font-semibold uppercase tracking-widest">
          {displayStatus}
        </span>
      </div>
    </div>
  )
}
