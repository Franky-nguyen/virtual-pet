import React from 'react'

export type EnvironmentMood =
  | 'sunny'
  | 'break'
  | 'slouching'
  | 'away'
  | 'calibrating'
  | 'dead'

interface PetEnvironmentProps {
  /** Current atmospheric mood derived from posture status, phase, and life state. */
  mood?: EnvironmentMood
  /** 'full' for PetDisplay (dashboard & taskbar), 'mini' for selector/preview thumbnails. */
  variant?: 'full' | 'mini'
  /** Pet sprite layer(s) rendered between the background grass patch and foreground grass blades. */
  children: React.ReactNode
}

/**
 * Pixel-art colour palettes per atmospheric mood.
 * Keeps the grass patch lush and readable while subtly shifting the sky, sun/moon,
 * and turf highlights to reflect the pet's current environment and posture state.
 */
const MOOD_PALETTES: Record<
  EnvironmentMood,
  {
    skyGradient: string
    hillFar: string
    hillMid: string
    turfHighlight: string
    turfLight: string
    turfMid: string
    turfDeep: string
    turfEdge: string
    soilBase: string
    soilDark: string
    bladeLight: string
    bladeMid: string
    bladeDark: string
    flowerPetal1: string
    flowerPetal2: string
    flowerCenter: string
    butterflyWing: string
    butterflyAccent: string
    moteColor: string
    showSun: boolean
    showMoon: boolean
    stormy: boolean
  }
> = {
  sunny: {
    skyGradient: 'linear-gradient(180deg, #bae6fd 0%, #e0f2fe 42%, #dcfce7 72%, #bbf7d0 100%)',
    hillFar: '#86efac',
    hillMid: '#4ade80',
    turfHighlight: '#bef264',
    turfLight: '#4ade80',
    turfMid: '#22c55e',
    turfDeep: '#16a34a',
    turfEdge: '#15803d',
    soilBase: '#92400e',
    soilDark: '#78350f',
    bladeLight: '#86efac',
    bladeMid: '#22c55e',
    bladeDark: '#15803d',
    flowerPetal1: '#ffffff',
    flowerPetal2: '#f472b6',
    flowerCenter: '#facc15',
    butterflyWing: '#fde047',
    butterflyAccent: '#fb923c',
    moteColor: '#fef08a',
    showSun: true,
    showMoon: false,
    stormy: false,
  },
  break: {
    skyGradient: 'linear-gradient(180deg, #fde68a 0%, #fef3c7 42%, #dcfce7 72%, #bbf7d0 100%)',
    hillFar: '#a7f3d0',
    hillMid: '#4ade80',
    turfHighlight: '#d9f99d',
    turfLight: '#4ade80',
    turfMid: '#22c55e',
    turfDeep: '#16a34a',
    turfEdge: '#15803d',
    soilBase: '#92400e',
    soilDark: '#78350f',
    bladeLight: '#bef264',
    bladeMid: '#22c55e',
    bladeDark: '#15803d',
    flowerPetal1: '#ffffff',
    flowerPetal2: '#fb7185',
    flowerCenter: '#f59e0b',
    butterflyWing: '#38bdf8',
    butterflyAccent: '#818cf8',
    moteColor: '#fde047',
    showSun: true,
    showMoon: false,
    stormy: false,
  },
  slouching: {
    skyGradient: 'linear-gradient(180deg, #fecaca 0%, #fee2e2 40%, #d1fae5 75%, #a7f3d0 100%)',
    hillFar: '#6ee7b7',
    hillMid: '#34d399',
    turfHighlight: '#86efac',
    turfLight: '#34d399',
    turfMid: '#10b981',
    turfDeep: '#059669',
    turfEdge: '#047857',
    soilBase: '#78350f',
    soilDark: '#451a03',
    bladeLight: '#6ee7b7',
    bladeMid: '#10b981',
    bladeDark: '#047857',
    flowerPetal1: '#fecdd3',
    flowerPetal2: '#fda4af',
    flowerCenter: '#fbbf24',
    butterflyWing: '#fca5a5',
    butterflyAccent: '#f87171',
    moteColor: '#fca5a5',
    showSun: false,
    showMoon: false,
    stormy: true,
  },
  away: {
    skyGradient: 'linear-gradient(180deg, #c7d2fe 0%, #e0e7ff 44%, #d1fae5 76%, #a7f3d0 100%)',
    hillFar: '#6ee7b7',
    hillMid: '#34d399',
    turfHighlight: '#86efac',
    turfLight: '#34d399',
    turfMid: '#10b981',
    turfDeep: '#059669',
    turfEdge: '#047857',
    soilBase: '#78350f',
    soilDark: '#451a03',
    bladeLight: '#6ee7b7',
    bladeMid: '#10b981',
    bladeDark: '#047857',
    flowerPetal1: '#e0e7ff',
    flowerPetal2: '#c4b5fd',
    flowerCenter: '#fde047',
    butterflyWing: '#a5b4fc',
    butterflyAccent: '#818cf8',
    moteColor: '#fef08a',
    showSun: false,
    showMoon: true,
    stormy: false,
  },
  calibrating: {
    skyGradient: 'linear-gradient(180deg, #ddd6fe 0%, #ede9fe 42%, #dcfce7 74%, #bbf7d0 100%)',
    hillFar: '#86efac',
    hillMid: '#4ade80',
    turfHighlight: '#bef264',
    turfLight: '#4ade80',
    turfMid: '#22c55e',
    turfDeep: '#16a34a',
    turfEdge: '#15803d',
    soilBase: '#92400e',
    soilDark: '#78350f',
    bladeLight: '#86efac',
    bladeMid: '#22c55e',
    bladeDark: '#15803d',
    flowerPetal1: '#f5f3ff',
    flowerPetal2: '#c084fc',
    flowerCenter: '#facc15',
    butterflyWing: '#e879f9',
    butterflyAccent: '#a855f7',
    moteColor: '#ddd6fe',
    showSun: true,
    showMoon: false,
    stormy: false,
  },
  dead: {
    skyGradient: 'linear-gradient(180deg, #cbd5e1 0%, #e2e8f0 45%, #d6d3d1 78%, #a8a29e 100%)',
    hillFar: '#a8a29e',
    hillMid: '#84a98c',
    turfHighlight: '#a3b18a',
    turfLight: '#84a98c',
    turfMid: '#6b9080',
    turfDeep: '#52796f',
    turfEdge: '#354f52',
    soilBase: '#57534e',
    soilDark: '#44403c',
    bladeLight: '#a3b18a',
    bladeMid: '#6b9080',
    bladeDark: '#354f52',
    flowerPetal1: '#d6d3d1',
    flowerPetal2: '#a8a29e',
    flowerCenter: '#78716c',
    butterflyWing: '#94a3b8',
    butterflyAccent: '#64748b',
    moteColor: '#cbd5e1',
    showSun: false,
    showMoon: false,
    stormy: false,
  },
}

/**
 * Pixel-art outdoor meadow & patch-of-grass habitat that wraps any pet model
 * (Original Dog, Evolved Dog, Pixel Cat, and Custom Pets).
 *
 * Designed on a 96×96 pixel-art grid with 2.5D depth:
 * - Background layer (`z-0` / `z-10`): Sky, sun/moon, drifting pixel clouds,
 *   rolling hills, a multi-layered pixel patch of grass (`y = 60..96`),
 *   back-row swaying grass tufts, wildflowers, and a grounding pet shadow.
 * - Midground layer (`z-20`): The pet sprite stack (`children`).
 * - Foreground layer (`z-30`): Swaying front grass blades that frame and
 *   lightly overlap the very bottom of the pet's paws, plus a fluttering
 *   pixel butterfly and floating meadow pollen motes.
 */
export default function PetEnvironment({
  mood = 'sunny',
  variant = 'full',
  children,
}: PetEnvironmentProps) {
  const p = MOOD_PALETTES[mood]
  const isAlive = mood !== 'dead'

  if (variant === 'mini') {
    return (
      <div
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
        style={{ background: p.skyGradient }}
      >
        {/* Mini background grass patch for 48×48 / 64×64 preview thumbnails */}
        <svg
          viewBox="0 0 64 64"
          className="absolute inset-0 w-full h-full pointer-events-none"
          shapeRendering="crispEdges"
          aria-hidden="true"
        >
          {/* Soft hill */}
          <rect x="0" y="44" width="64" height="20" fill={p.hillFar} opacity="0.55" />
          {/* Main pixel grass patch */}
          <rect x="4" y="45" width="56" height="3" fill={p.turfHighlight} />
          <rect x="0" y="47" width="64" height="6" fill={p.turfLight} />
          <rect x="0" y="52" width="64" height="6" fill={p.turfMid} />
          <rect x="0" y="57" width="64" height="7" fill={p.turfDeep} />
          {/* Back grass blades */}
          <rect x="6" y="42" width="2" height="4" fill={p.bladeMid} />
          <rect x="9" y="43" width="2" height="3" fill={p.bladeLight} />
          <rect x="52" y="42" width="2" height="4" fill={p.bladeMid} />
          <rect x="55" y="43" width="2" height="3" fill={p.bladeLight} />
          {/* Tiny flower */}
          <rect x="12" y="44" width="2" height="2" fill={p.flowerPetal1} />
          <rect x="13" y="45" width="1" height="1" fill={p.flowerCenter} />
          <rect x="50" y="45" width="2" height="2" fill={p.flowerPetal2} />
          {/* Ground shadow under pet */}
          <rect x="18" y="51" width="28" height="4" fill="#064e3b" opacity="0.22" />
        </svg>

        {/* Pet sprite */}
        <div className="relative z-10 w-full h-full flex items-center justify-center">
          {children}
        </div>

        {/* Mini foreground grass tufts */}
        <svg
          viewBox="0 0 64 64"
          className="absolute inset-0 w-full h-full pointer-events-none z-20"
          shapeRendering="crispEdges"
          aria-hidden="true"
        >
          <rect x="5" y="53" width="2" height="5" fill={p.bladeDark} />
          <rect x="8" y="54" width="2" height="4" fill={p.bladeLight} />
          <rect x="22" y="55" width="2" height="4" fill={p.bladeDark} />
          <rect x="40" y="55" width="2" height="4" fill={p.bladeDark} />
          <rect x="54" y="53" width="2" height="5" fill={p.bladeDark} />
          <rect x="57" y="54" width="2" height="4" fill={p.bladeLight} />
        </svg>
      </div>
    )
  }

  return (
    <div
      className="relative w-full h-full flex items-center justify-center overflow-hidden rounded-full select-none"
      style={{ background: p.skyGradient }}
    >
      {/* ── LAYER 1: SKY, SUN/MOON, CLOUDS, HILLS & GRASS PATCH (BEHIND PET) ── */}
      <svg
        viewBox="0 0 96 96"
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {/* Pixel Sun (sunny / break / calibrating) */}
        {p.showSun && (
          <g className="pet-env-sun">
            {/* Outer warm glow */}
            <rect x="66" y="10" width="14" height="14" fill="#fef08a" opacity="0.45" />
            <rect x="68" y="8" width="10" height="18" fill="#fef08a" opacity="0.35" />
            <rect x="64" y="12" width="18" height="10" fill="#fef08a" opacity="0.35" />
            {/* Crisp pixel sun core */}
            <rect x="69" y="12" width="8" height="10" fill="#fde047" />
            <rect x="68" y="13" width="10" height="8" fill="#fde047" />
            <rect x="70" y="14" width="6" height="6" fill="#facc15" />
          </g>
        )}

        {/* Pixel Crescent Moon & Twinkling Stars (away mode) */}
        {p.showMoon && (
          <g>
            {/* Twinkling stars */}
            <rect x="18" y="16" width="2" height="2" fill="#fef9c3" className="pet-env-twinkle" />
            <rect x="36" y="11" width="2" height="2" fill="#ffffff" className="pet-env-twinkle-delayed" />
            <rect x="54" y="18" width="2" height="2" fill="#fef9c3" className="pet-env-twinkle" />
            {/* Pixel crescent moon */}
            <rect x="68" y="12" width="8" height="10" fill="#fef08a" />
            <rect x="66" y="14" width="8" height="6" fill="#fef08a" />
            <rect x="71" y="13" width="6" height="6" fill="#c7d2fe" />
          </g>
        )}

        {/* Drifting Pixel Clouds */}
        <g className="pet-env-cloud-slow" opacity={p.stormy ? 0.85 : 0.9}>
          {/* Left cloud */}
          <rect
            x="12"
            y="18"
            width="14"
            height="4"
            fill={p.stormy ? '#cbd5e1' : '#ffffff'}
          />
          <rect
            x="15"
            y="15"
            width="8"
            height="4"
            fill={p.stormy ? '#e2e8f0' : '#ffffff'}
          />
          <rect
            x="10"
            y="20"
            width="18"
            height="2"
            fill={p.stormy ? '#94a3b8' : '#e0f2fe'}
          />
        </g>

        <g className="pet-env-cloud-fast" opacity={p.stormy ? 0.8 : 0.85}>
          {/* Right-mid cloud */}
          <rect
            x="50"
            y="24"
            width="12"
            height="4"
            fill={p.stormy ? '#cbd5e1' : '#ffffff'}
          />
          <rect
            x="52"
            y="22"
            width="7"
            height="3"
            fill={p.stormy ? '#e2e8f0' : '#ffffff'}
          />
          <rect
            x="49"
            y="27"
            width="14"
            height="2"
            fill={p.stormy ? '#94a3b8' : '#e0f2fe'}
          />
        </g>

        {/* Distant Rolling Meadow Hills */}
        <rect x="6" y="54" width="38" height="10" fill={p.hillFar} opacity="0.65" />
        <rect x="12" y="52" width="26" height="4" fill={p.hillFar} opacity="0.65" />
        <rect x="46" y="53" width="44" height="11" fill={p.hillMid} opacity="0.45" />
        <rect x="54" y="51" width="28" height="4" fill={p.hillMid} opacity="0.45" />

        {/* Back-Row Swaying Grass Tufts & Meadow Flowers (along the horizon y=55..62) */}
        <g className={isAlive ? 'pet-env-grass-sway' : ''}>
          {/* Left horizon tufts */}
          <rect x="14" y="56" width="2" height="6" fill={p.bladeMid} />
          <rect x="16" y="54" width="2" height="7" fill={p.bladeLight} />
          <rect x="18" y="57" width="2" height="5" fill={p.bladeDark} />
          <rect x="25" y="56" width="2" height="5" fill={p.bladeMid} />
          <rect x="27" y="55" width="2" height="6" fill={p.bladeLight} />

          {/* Right horizon tufts */}
          <rect x="67" y="55" width="2" height="6" fill={p.bladeLight} />
          <rect x="69" y="56" width="2" height="5" fill={p.bladeMid} />
          <rect x="76" y="54" width="2" height="7" fill={p.bladeMid} />
          <rect x="78" y="56" width="2" height="6" fill={p.bladeLight} />
          <rect x="80" y="57" width="2" height="5" fill={p.bladeDark} />

          {/* Back-row pixel daisy (left) */}
          <rect x="21" y="56" width="3" height="3" fill={p.flowerPetal1} />
          <rect x="22" y="57" width="1" height="1" fill={p.flowerCenter} />

          {/* Back-row pixel blossom (right) */}
          <rect x="72" y="56" width="3" height="3" fill={p.flowerPetal2} />
          <rect x="73" y="57" width="1" height="1" fill={p.flowerCenter} />
        </g>

        {/* ── MAIN PIXEL-ART PATCH OF GRASS (Mound spanning y=59..96) ── */}
        {/* Sunlit top grass crown */}
        <rect x="14" y="59" width="68" height="3" fill={p.turfHighlight} />
        <rect x="8" y="61" width="80" height="4" fill={p.turfHighlight} />

        {/* Upper lush meadow turf */}
        <rect x="4" y="63" width="88" height="7" fill={p.turfLight} />
        <rect x="0" y="66" width="96" height="8" fill={p.turfLight} />

        {/* Pixel stepping details between light & mid turf */}
        <rect x="10" y="64" width="6" height="2" fill={p.turfHighlight} />
        <rect x="34" y="63" width="10" height="2" fill={p.turfHighlight} />
        <rect x="62" y="64" width="8" height="2" fill={p.turfHighlight} />
        <rect x="16" y="71" width="8" height="2" fill={p.turfMid} />
        <rect x="44" y="72" width="12" height="2" fill={p.turfMid} />
        <rect x="70" y="71" width="10" height="2" fill={p.turfMid} />

        {/* Mid-ground rich grass pad (where all pet models stand: y=68..82) */}
        <rect x="0" y="73" width="96" height="9" fill={p.turfMid} />
        {/* Lighter grass patch oval directly under the pet */}
        <rect x="20" y="68" width="56" height="12" fill={p.turfLight} />
        <rect x="16" y="70" width="64" height="8" fill={p.turfLight} />
        <rect x="24" y="67" width="48" height="3" fill={p.turfHighlight} opacity="0.65" />

        {/* Subtle clover & grass texture specks on the turf */}
        <rect x="12" y="75" width="3" height="2" fill={p.turfDeep} />
        <rect x="14" y="74" width="2" height="2" fill={p.turfHighlight} />
        <rect x="78" y="75" width="4" height="2" fill={p.turfDeep} />
        <rect x="76" y="73" width="3" height="2" fill={p.turfHighlight} />

        {/* Deep lower turf & shaded grass */}
        <rect x="0" y="81" width="96" height="7" fill={p.turfDeep} />
        <rect x="8" y="80" width="14" height="2" fill={p.turfDeep} />
        <rect x="38" y="81" width="20" height="2" fill={p.turfMid} />
        <rect x="72" y="80" width="16" height="2" fill={p.turfDeep} />

        {/* Turf overhang & rich soil base at bottom of circle (y=87..96) */}
        <rect x="0" y="86" width="96" height="4" fill={p.turfEdge} />
        <rect x="0" y="89" width="96" height="7" fill={p.soilBase} />
        {/* Pixel turf teeth overhanging the soil */}
        <rect x="18" y="89" width="4" height="2" fill={p.turfEdge} />
        <rect x="32" y="89" width="6" height="2" fill={p.turfEdge} />
        <rect x="48" y="89" width="5" height="3" fill={p.turfEdge} />
        <rect x="64" y="89" width="6" height="2" fill={p.turfEdge} />
        {/* Soil pebbles */}
        <rect x="26" y="91" width="4" height="2" fill={p.soilDark} />
        <rect x="42" y="92" width="5" height="2" fill={p.soilDark} />
        <rect x="58" y="91" width="4" height="2" fill={p.soilDark} />

        {/* ── GROUNDING CONTACT SHADOW (compatible with all pet models) ── */}
        {/* Layered pixel oval at y=74..81 grounds 64×64 Dog/Cat/Evolved and Custom Pets */}
        <g className={isAlive ? 'pet-env-shadow-pulse' : ''}>
          <rect x="24" y="75" width="48" height="5" fill="#052e16" opacity="0.18" />
          <rect x="20" y="76" width="56" height="3" fill="#052e16" opacity="0.16" />
          <rect x="28" y="74" width="40" height="7" fill="#052e16" opacity="0.14" />
        </g>
      </svg>

      {/* ── LAYER 2: PET SPRITE STAGE (ALL MODELS) ── */}
      <div className="relative z-20 w-full h-full flex items-center justify-center">
        {children}
      </div>

      {/* ── LAYER 3: FOREGROUND SWAYING GRASS BLADES, WILDFLOWERS & BUTTERFLY ── */}
      <svg
        viewBox="0 0 96 96"
        className="absolute inset-0 w-full h-full pointer-events-none z-30"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {/* Foreground grass tufts that frame the pet and softly overlap the bottom paw line */}
        <g className={isAlive ? 'pet-env-grass-sway-fg' : ''}>
          {/* Left foreground cluster */}
          <rect x="10" y="72" width="2" height="9" fill={p.bladeDark} />
          <rect x="12" y="70" width="2" height="10" fill={p.bladeMid} />
          <rect x="14" y="73" width="2" height="8" fill={p.bladeLight} />
          <rect x="17" y="75" width="2" height="7" fill={p.bladeDark} />
          <rect x="19" y="74" width="2" height="8" fill={p.bladeMid} />

          {/* Left wildflower */}
          <rect x="14" y="71" width="3" height="3" fill={p.flowerPetal1} />
          <rect x="15" y="72" width="1" height="1" fill={p.flowerCenter} />

          {/* Subtle center-left & center-right low blades kissing the pet's paws (y=77..83) */}
          <rect x="27" y="77" width="2" height="6" fill={p.bladeDark} />
          <rect x="29" y="78" width="2" height="5" fill={p.bladeLight} />
          <rect x="38" y="79" width="2" height="5" fill={p.bladeMid} />
          <rect x="47" y="79" width="2" height="5" fill={p.bladeLight} />
          <rect x="56" y="78" width="2" height="6" fill={p.bladeDark} />
          <rect x="65" y="77" width="2" height="6" fill={p.bladeMid} />
          <rect x="67" y="78" width="2" height="5" fill={p.bladeLight} />

          {/* Right foreground cluster */}
          <rect x="75" y="74" width="2" height="8" fill={p.bladeMid} />
          <rect x="77" y="75" width="2" height="7" fill={p.bladeDark} />
          <rect x="80" y="72" width="2" height="9" fill={p.bladeLight} />
          <rect x="82" y="70" width="2" height="10" fill={p.bladeMid} />
          <rect x="84" y="73" width="2" height="8" fill={p.bladeDark} />

          {/* Right wildflower */}
          <rect x="78" y="72" width="3" height="3" fill={p.flowerPetal2} />
          <rect x="79" y="73" width="1" height="1" fill={p.flowerCenter} />
          {/* Tiny yellow buttercup near bottom-left */}
          <rect x="23" y="80" width="3" height="2" fill={p.flowerCenter} />
          <rect x="24" y="79" width="1" height="4" fill={p.flowerCenter} />
        </g>

        {/* Lively Fluttering Pixel Butterfly & Floating Meadow Motes (when alive) */}
        {isAlive && (
          <>
            {/* Pixel butterfly */}
            <g className="pet-env-butterfly">
              <rect x="18" y="28" width="3" height="3" fill={p.butterflyWing} />
              <rect x="22" y="28" width="3" height="3" fill={p.butterflyWing} />
              <rect x="19" y="31" width="2" height="2" fill={p.butterflyAccent} />
              <rect x="22" y="31" width="2" height="2" fill={p.butterflyAccent} />
              <rect x="21" y="29" width="1" height="4" fill="#1e293b" />
            </g>

            {/* Floating sunlit pollen / dandelion motes */}
            <rect
              x="22"
              y="48"
              width="2"
              height="2"
              fill={p.moteColor}
              opacity="0.85"
              className="pet-env-mote-1"
            />
            <rect
              x="72"
              y="42"
              width="2"
              height="2"
              fill="#ffffff"
              opacity="0.8"
              className="pet-env-mote-2"
            />
            <rect
              x="62"
              y="52"
              width="2"
              height="2"
              fill={p.moteColor}
              opacity="0.75"
              className="pet-env-mote-3"
            />
          </>
        )}
      </svg>
    </div>
  )
}
