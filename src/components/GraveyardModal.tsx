import { useEffect, useState } from 'react'
import { formatDurationReadable, type PetGrave } from '../utils/petLifecycle'
import { getVolume, suspendBGMForOverlay, resumeBGMFromOverlay } from '../utils/bgm'
import { startGraveyardBGM, stopGraveyardBGM, playPop, playToggle } from '../utils/soundEffects'

const FUNNY_DEATH_CAUSES = [
  'You sit like a duck',
  'Terminal scoliosis',
  'Full shrimp posture',
  'Folded like a lawn chair',
  'Spine shaped like a question mark',
  'Croissant-mode slouching',
  'Goblin mode at the desk',
  '90-degree gamer neck',
  'Slouched into a pretzel',
  'Vertebrae left the chat',
] as const

const GRAVE_QUIP_STORAGE_KEY = 'posturepet-grave-quip-seed'

const APP_LAUNCH_QUIP_SEED: number = (() => {
  try {
    const raw = localStorage.getItem(GRAVE_QUIP_STORAGE_KEY)
    const prev = raw !== null ? parseInt(raw, 10) : -1
    const step = 1 + Math.floor(Math.random() * (FUNNY_DEATH_CAUSES.length - 1))
    const next =
      Number.isFinite(prev) && prev >= 0
        ? (prev + step) % FUNNY_DEATH_CAUSES.length
        : Math.floor(Math.random() * FUNNY_DEATH_CAUSES.length)
    localStorage.setItem(GRAVE_QUIP_STORAGE_KEY, String(next))
    return next
  } catch {
    return 0
  }
})()

interface GraveyardModalProps {
  open: boolean
  onClose: () => void
  graves: PetGrave[]
  isDead: boolean
  onAdoptNewPet: () => void
}

function PixelTreeCanopyBanner() {
  // Crisp pixel-art autumn trees over twilight sky (shape-rendering="crispEdges")
  return (
    <svg
      viewBox="0 0 160 28"
      className="w-full h-11 block select-none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Dusk Twilight Sky Bands (stepped pixel bands, zero blurry gradients) */}
      <rect x="0" y="0" width="160" height="5" fill="#231934" />
      <rect x="0" y="5" width="160" height="5" fill="#372447" />
      <rect x="0" y="10" width="160" height="5" fill="#59324e" />
      <rect x="0" y="15" width="160" height="6" fill="#874848" />
      <rect x="0" y="21" width="160" height="7" fill="#5b281a" />

      {/* Distant twinkling stars */}
      <rect x="14" y="3" width="1" height="1" fill="#fef08a" />
      <rect x="46" y="2" width="1" height="1" fill="#fde68a" />
      <rect x="102" y="4" width="1" height="1" fill="#fef08a" />
      <rect x="144" y="2" width="1" height="1" fill="#e9d5ff" />

      {/* Autumn Pixel Tree Row across back */}
      {[4, 24, 44, 66, 88, 110, 132, 148].map((x, idx) => (
        <g key={x}>
          {/* Tree trunk */}
          <rect x={x + 6} y="19" width="4" height="9" fill="#4e2214" />
          <rect x={x + 7} y="19" width="2" height="9" fill="#6b301c" />
          {/* Dark rust canopy base */}
          <rect x={x + 1} y="11" width="14" height="10" fill="#a83d22" />
          <rect x={x} y="13" width="16" height="6" fill="#b84a27" />
          {/* Warm orange leaf crown */}
          <rect x={x + 2} y="7" width="12" height="9" fill="#d97724" />
          <rect x={x + 4} y="5" width="8" height="4" fill="#d97724" />
          {/* Sunlit amber leaf clusters */}
          <rect x={x + (idx % 2 === 0 ? 4 : 6)} y="6" width="5" height="4" fill="#ea9b38" />
          <rect x={x + 9} y="10" width="4" height="3" fill="#ea9b38" />
          <rect x={x + 3} y="12" width="3" height="2" fill="#f3b64d" />
        </g>
      ))}
    </svg>
  )
}

function PixelPicketFence() {
  const posts = Array.from({ length: 40 }, (_, i) => i * 4)
  return (
    <svg
      viewBox="0 0 160 11"
      className="w-full h-4 block select-none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Horizontal fence rails */}
      <rect x="0" y="4" width="160" height="2" fill="#1e1b2e" />
      <rect x="0" y="5" width="160" height="1" fill="#cbd5e1" />
      <rect x="0" y="8" width="160" height="2" fill="#1e1b2e" />
      <rect x="0" y="9" width="160" height="1" fill="#94a3b8" />

      {posts.map((x) => (
        <g key={x}>
          {/* Crisp outline behind picket */}
          <rect x={x} y="1" width="3" height="10" fill="#1e1b2e" />
          <rect x={x + 1} y="0" width="1" height="1" fill="#1e1b2e" />
          {/* White/cool-lavender picket body */}
          <rect x={x + 1} y="1" width="1" height="9" fill="#f8fafc" />
          <rect x={x + 2} y="2" width="1" height="8" fill="#cbd5e1" />
        </g>
      ))}
    </svg>
  )
}

function PixelFlowerCluster({ seed }: { seed: number }) {
  const colors = [
    ['#60a5fa', '#f472b6', '#fb923c'],
    ['#f472b6', '#60a5fa', '#facc15'],
    ['#fb923c', '#a78bfa', '#60a5fa'],
  ][seed % 3]

  const renderBloom = (cx: number, cy: number, color: string) => (
    <g>
      <rect x={cx} y={cy - 1} width="1" height="3" fill="#1e1b2e" />
      <rect x={cx - 1} y={cy} width="3" height="1" fill="#1e1b2e" />
      <rect x={cx} y={cy - 1} width="1" height="1" fill={color} />
      <rect x={cx} y={cy + 1} width="1" height="1" fill={color} />
      <rect x={cx - 1} y={cy} width="1" height="1" fill={color} />
      <rect x={cx + 1} y={cy} width="1" height="1" fill={color} />
      <rect x={cx} y={cy} width="1" height="1" fill="#fef9c3" />
    </g>
  )

  return (
    <svg
      viewBox="0 0 18 6"
      className="w-12 h-4 mx-auto block select-none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {renderBloom(3, 2, colors[0])}
      {renderBloom(9, 3, colors[1])}
      {renderBloom(14, 1, colors[2])}
    </svg>
  )
}

function PixelTombstoneSvg({
  variant,
  isSelected,
}: {
  variant: number
  isSelected: boolean
}) {
  const type = variant % 4
  const stoneLight = isSelected ? '#b2a8d1' : '#968db4'
  const stoneMid = isSelected ? '#8d82ad' : '#7b7496'
  const stoneDark = isSelected ? '#6c628a' : '#5e5678'
  const border = '#1c182b'

  return (
    <svg
      viewBox="0 0 24 24"
      className="w-16 h-16 mx-auto block select-none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* Moss shadow at base */}
      <rect x="4" y="21" width="16" height="2" fill="#4f5830" />

      {type === 0 && (
        // Variant 0: Classic Arched Gravestone (Bone/Paw Emblem)
        <g>
          <rect x="5" y="4" width="14" height="18" fill={border} />
          <rect x="6" y="3" width="12" height="1" fill={border} />
          <rect x="6" y="4" width="12" height="17" fill={stoneMid} />
          <rect x="6" y="4" width="12" height="2" fill={stoneLight} />
          <rect x="16" y="5" width="2" height="16" fill={stoneDark} />
          <rect x="4" y="19" width="16" height="2" fill={stoneDark} />
          {/* Carved Bone/Paw Emblem */}
          <rect x="9" y="9" width="6" height="2" fill="#231f33" />
          <rect x="8" y="8" width="2" height="1" fill="#231f33" />
          <rect x="14" y="8" width="2" height="1" fill="#231f33" />
          <rect x="8" y="11" width="2" height="1" fill="#231f33" />
          <rect x="14" y="11" width="2" height="1" fill="#231f33" />
          {/* Engraved epitaph lines */}
          <rect x="8" y="14" width="8" height="1" fill="#2d2740" />
          <rect x="9" y="16" width="6" height="1" fill="#2d2740" />
        </g>
      )}

      {type === 1 && (
        // Variant 1: Starburst Astral Crest Monument (inspired by reference #2!)
        <g>
          <rect x="6" y="3" width="12" height="10" fill={border} />
          <rect x="4" y="5" width="16" height="6" fill={border} />
          <rect x="7" y="13" width="10" height="9" fill={border} />
          <rect x="7" y="4" width="10" height="8" fill={stoneMid} />
          <rect x="5" y="6" width="14" height="4" fill={stoneMid} />
          <rect x="8" y="12" width="8" height="9" fill={stoneMid} />
          <rect x="7" y="4" width="10" height="2" fill={stoneLight} />
          <rect x="5" y="19" width="14" height="2" fill={stoneDark} />
          {/* Astral star emblem */}
          <rect x="11" y="6" width="2" height="5" fill="#231f33" />
          <rect x="9" y="8" width="6" height="1" fill="#231f33" />
          <rect x="10" y="7" width="1" height="1" fill="#231f33" />
          <rect x="13" y="7" width="1" height="1" fill="#231f33" />
          <rect x="10" y="10" width="1" height="1" fill="#231f33" />
          <rect x="13" y="10" width="1" height="1" fill="#231f33" />
          {/* Epitaph */}
          <rect x="9" y="15" width="6" height="1" fill="#2d2740" />
          <rect x="9" y="17" width="6" height="1" fill="#2d2740" />
        </g>
      )}

      {type === 2 && (
        // Variant 2: Broad Weathered Pillar Slab (inspired by reference #1!)
        <g>
          <rect x="4" y="4" width="16" height="8" fill={border} />
          <rect x="6" y="12" width="12" height="10" fill={border} />
          <rect x="5" y="5" width="14" height="6" fill={stoneMid} />
          <rect x="7" y="11" width="10" height="10" fill={stoneMid} />
          <rect x="5" y="5" width="14" height="2" fill={stoneLight} />
          <rect x="15" y="11" width="2" height="10" fill={stoneDark} />
          <rect x="5" y="19" width="14" height="2" fill={stoneDark} />
          {/* Carved Heart/Collar Crest */}
          <rect x="9" y="7" width="2" height="2" fill="#231f33" />
          <rect x="13" y="7" width="2" height="2" fill="#231f33" />
          <rect x="10" y="8" width="4" height="2" fill="#231f33" />
          <rect x="11" y="10" width="2" height="1" fill="#231f33" />
          {/* Epitaph */}
          <rect x="8" y="14" width="8" height="1" fill="#2d2740" />
          <rect x="9" y="16" width="6" height="1" fill="#2d2740" />
        </g>
      )}

      {type === 3 && (
        // Variant 3: Crescent Moon Carved Obelisk (inspired by reference #4 & Moon Panther!)
        <g>
          <rect x="5" y="4" width="13" height="10" fill={border} />
          <rect x="7" y="14" width="10" height="8" fill={border} />
          <rect x="6" y="5" width="11" height="8" fill={stoneMid} />
          <rect x="8" y="13" width="8" height="8" fill={stoneMid} />
          {/* Moon cutout notch */}
          <rect x="6" y="4" width="5" height="4" fill="#9ca363" />
          <rect x="7" y="8" width="4" height="1" fill={border} />
          <rect x="11" y="5" width="6" height="2" fill={stoneLight} />
          <rect x="6" y="19" width="12" height="2" fill={stoneDark} />
          {/* Carved Rune */}
          <rect x="12" y="9" width="3" height="2" fill="#231f33" />
          <rect x="10" y="10" width="2" height="2" fill="#231f33" />
          {/* Epitaph */}
          <rect x="9" y="15" width="6" height="1" fill="#2d2740" />
          <rect x="10" y="17" width="4" height="1" fill="#2d2740" />
        </g>
      )}
    </svg>
  )
}

export default function GraveyardModal({
  open,
  onClose,
  graves,
  isDead,
  onAdoptNewPet,
}: GraveyardModalProps) {
  const [selectedGraveId, setSelectedGraveId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedGraveId(null)
    suspendBGMForOverlay()
    startGraveyardBGM(getVolume())

    return () => {
      stopGraveyardBGM(250)
      resumeBGMFromOverlay()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const sortedGraves = [...graves].sort(
    (a, b) => new Date(b.diedAt).getTime() - new Date(a.diedAt).getTime(),
  )
  const selectedGraveIndex = sortedGraves.findIndex((g) => g.id === selectedGraveId)
  const selectedGrave = selectedGraveIndex >= 0 ? sortedGraves[selectedGraveIndex] : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="graveyard-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          playPop()
          onClose()
        }
      }}
    >
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden border-4 border-[#1c182b] bg-[#231934] shadow-2xl font-mono text-slate-100">
        {/* Top Title Bar + Dusk Autumn Tree Header */}
        <div className="relative border-b-4 border-[#1c182b]">
          <PixelTreeCanopyBanner />
          <div className="flex items-center justify-between px-3.5 py-2 bg-[#231934] border-t-2 border-[#46315e]">
            <div className="min-w-0">
              <h2
                id="graveyard-modal-title"
                className="text-sm font-bold tracking-wider uppercase text-amber-200 truncate"
              >
                Digital Pet Graveyard ({graves.length})
              </h2>
              <p className="text-[10px] text-purple-200/80 truncate">
                In loving memory of companions who guarded your posture
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                playPop()
                onClose()
              }}
              className="px-2 py-1 text-[11px] font-bold uppercase border-2 border-[#1c182b] bg-[#4c4266] hover:bg-[#5e527d] text-slate-100 cursor-pointer shrink-0"
              aria-label="Close Graveyard"
            >
              Close [Esc]
            </button>
          </div>
        </div>

        {/* Upper Pixel Picket Fence */}
        <div className="bg-[#9ca363]">
          <PixelPicketFence />
        </div>

        {/* Scrollable Pixel Cemetery Yard */}
        <div
          className="relative flex-1 overflow-y-auto no-scrollbar px-3.5 py-3.5"
          style={{
            backgroundColor: '#9ca363',
            backgroundImage:
              'radial-gradient(#b8c468 2px, transparent 2px), radial-gradient(#8b9355 2px, transparent 2px)',
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0, 12px 12px',
          }}
        >
          {/* Subtle Pixel Fireflies */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-4 left-8 w-1.5 h-1.5 bg-amber-200 animate-pulse"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-14 right-10 w-1.5 h-1.5 bg-yellow-200 animate-pulse"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-6 left-1/3 w-1.5 h-1.5 bg-lime-100 animate-pulse"
          />

          {sortedGraves.length === 0 ? (
            <div className="mx-auto max-w-md my-6 border-4 border-[#1c182b] bg-[#362f4d] p-5 text-center shadow-lg">
              <div className="mb-3">
                <PixelTombstoneSvg variant={0} isSelected={false} />
                <PixelFlowerCluster seed={0} />
              </div>
              <p className="text-sm font-bold text-amber-200">
                No fallen companions rest here yet.
              </p>
              <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                Keep your posture healthy so your companion thrives. If a pet&apos;s HP ever reaches 0, its memorial stone will stand here forever.
              </p>
            </div>
          ) : selectedGrave ? (
            /* View B: Dedicated Memorial Detail Inspection */
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    playPop()
                    setSelectedGraveId(null)
                  }}
                  className="px-2.5 py-1 text-[11px] font-bold uppercase border-2 border-[#1c182b] bg-[#362f4d] hover:bg-[#494066] text-amber-200 cursor-pointer"
                >
                  {'\u2190'} All Tombstones
                </button>
                {sortedGraves.length > 1 && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        playToggle()
                        const prevIdx = (selectedGraveIndex - 1 + sortedGraves.length) % sortedGraves.length
                        setSelectedGraveId(sortedGraves[prevIdx].id)
                      }}
                      className="px-2 py-1 text-[11px] font-bold uppercase border-2 border-[#1c182b] bg-[#362f4d] hover:bg-[#494066] text-slate-100 cursor-pointer"
                      aria-label="Previous tombstone"
                    >
                      {'\u2039'} Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playToggle()
                        const nextIdx = (selectedGraveIndex + 1) % sortedGraves.length
                        setSelectedGraveId(sortedGraves[nextIdx].id)
                      }}
                      className="px-2 py-1 text-[11px] font-bold uppercase border-2 border-[#1c182b] bg-[#362f4d] hover:bg-[#494066] text-slate-100 cursor-pointer"
                      aria-label="Next tombstone"
                    >
                      Next {'\u203A'}
                    </button>
                  </div>
                )}
              </div>

              <div className="border-2 border-[#1c182b] bg-[#2d2642] p-3">
                <div className="flex items-center gap-3 p-2.5 border-2 border-[#1c182b] bg-[#251f36]">
                  <div className="shrink-0">
                    <PixelTombstoneSvg variant={selectedGraveIndex} isSelected={true} />
                    <PixelFlowerCluster seed={selectedGraveIndex} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold text-amber-200 truncate">
                        {selectedGrave.name}
                      </span>
                      <span className="text-[10px] uppercase px-1.5 py-0.5 border border-[#1c182b] bg-[#453d5f] text-purple-100 shrink-0">
                        {selectedGrave.species}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 border border-[#1c182b] bg-[#362f4d] text-amber-100 shrink-0">
                        Lv.{selectedGrave.finalLevel}
                      </span>
                    </div>
                    <div className="text-[11px] text-rose-300 font-semibold mt-1.5 leading-snug">
                      Cause: {FUNNY_DEATH_CAUSES[(APP_LAUNCH_QUIP_SEED + Math.max(0, selectedGraveIndex)) % FUNNY_DEATH_CAUSES.length]}
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="border-2 border-[#1c182b] bg-[#1e192e] px-2.5 py-1.5">
                    <div className="text-slate-400 text-[10px] uppercase">Time Alive</div>
                    <div className="font-bold text-slate-100 mt-0.5">
                      {formatDurationReadable(selectedGrave.livedSeconds)}
                    </div>
                  </div>
                  <div className="border-2 border-[#1c182b] bg-[#1e192e] px-2.5 py-1.5">
                    <div className="text-slate-400 text-[10px] uppercase">XP Earned / Final</div>
                    <div className="font-bold text-slate-100 mt-0.5 tabular-nums">
                      {selectedGrave.xpEarned} / {selectedGrave.finalXp} XP
                    </div>
                  </div>
                  <div className="border-2 border-[#1c182b] bg-[#1e192e] px-2.5 py-1.5">
                    <div className="text-slate-400 text-[10px] uppercase">Pomodoros</div>
                    <div className="font-bold text-slate-100 mt-0.5">
                      {selectedGrave.completedSessions} done
                    </div>
                  </div>
                  <div className="border-2 border-[#1c182b] bg-[#1e192e] px-2.5 py-1.5">
                    <div className="text-slate-400 text-[10px] uppercase">Rested On</div>
                    <div className="font-bold text-slate-100 mt-0.5">
                      {new Date(selectedGrave.diedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* View A: Clean Cemetery Overview */
            <div>
              <div className="mb-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-[#231934] bg-[#b8c468]/90 border border-[#1c182b] py-1 px-2">
                Click a tombstone to inspect its memorial
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {sortedGraves.map((grave, index) => {
                  const diedDate = new Date(grave.diedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                  return (
                    <button
                      key={grave.id}
                      type="button"
                      onClick={() => {
                        playToggle()
                        setSelectedGraveId(grave.id)
                      }}
                      aria-label={`Memorial for ${grave.name}, Lv.${grave.finalLevel}, lived ${formatDurationReadable(grave.livedSeconds)}, earned ${grave.xpEarned} XP, died ${diedDate}`}
                      className="group text-center p-2 border-2 border-[#1c182b] bg-[#362f4d]/85 hover:bg-[#453d5f]/95 hover:-translate-y-0.5 transition-transform cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-300"
                    >
                      <PixelTombstoneSvg variant={index} isSelected={false} />
                      <PixelFlowerCluster seed={index} />
                      <div className="mt-1 px-1.5 py-1 border-2 border-[#1c182b] bg-[#251f36] text-center">
                        <div className="text-[11px] font-bold text-amber-200 truncate">
                          {grave.name}
                        </div>
                        <div className="text-[9px] text-purple-200/80 tabular-nums truncate">
                          Lv.{grave.finalLevel} · {formatDurationReadable(grave.livedSeconds)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Lower Pixel Picket Fence + Warm Earth Path Footer */}
        <div className="bg-[#9ca363]">
          <PixelPicketFence />
        </div>
        <div className="border-t-2 border-[#1c182b] bg-[#b56756] px-3.5 py-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-[#2b120e] leading-tight">
            Names of fallen pets stay etched here forever.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {isDead && (
              <button
                type="button"
                onClick={onAdoptNewPet}
                className="px-2.5 py-1 text-[11px] font-bold uppercase border-2 border-[#1c182b] bg-amber-400 hover:bg-amber-300 text-[#1c182b] cursor-pointer"
              >
                Adopt a New Pet
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                playPop()
                onClose()
              }}
              className="px-2.5 py-1 text-[11px] font-bold uppercase border-2 border-[#1c182b] bg-[#362f4d] hover:bg-[#494066] text-slate-100 cursor-pointer"
            >
              Return
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
