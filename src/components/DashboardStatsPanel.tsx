import { useEffect, useMemo, useState } from 'react'
import { Button } from './ui/button'
import { XIcon } from './icons'
import { playPop, playToggle } from '../utils/soundEffects'
import {
  formatDurationReadable,
  getDashboardStats,
  type ActivePetLife,
} from '../utils/petLifecycle'

interface DashboardStatsPanelProps {
  activeLife: ActivePetLife | null
  currentXp: number
  currentLevel: number
  refreshTick: number
}

function SteppedXpProgressionBlock({
  points,
}: {
  points: Array<{ timestamp: string; xp: number; level: number }>
}) {
  if (points.length === 0) {
    return (
      <div className="w-full flex flex-col gap-2 px-3.5 py-3 bg-slate-50 rounded-xl border border-slate-200">
        <span className="text-xs font-medium text-gray-700">XP Progression</span>
        <p className="text-xs text-muted-foreground py-1">
          No XP progression events recorded in this period yet.
        </p>
      </div>
    )
  }

  const width = 264
  const height = 68
  const padX = 10
  const padY = 10
  const minXp = Math.min(...points.map((p) => p.xp))
  const maxXp = Math.max(...points.map((p) => p.xp), minXp + 10)
  const spanXp = Math.max(1, maxXp - minXp)

  const coords = points.map((p, idx) => {
    const x =
      points.length === 1
        ? Math.round(width / 2)
        : Math.round(padX + (idx / (points.length - 1)) * (width - padX * 2))
    const y = Math.round(
      height - padY - ((p.xp - minXp) / spanXp) * (height - padY * 2),
    )
    return { x, y }
  })

  // Orthogonal stepped pixel path: horizontal to next X, then vertical to next Y.
  const steppedPath =
    coords.length > 1
      ? coords
          .map((c, idx) => {
            if (idx === 0) return `M ${c.x} ${c.y}`
            const prev = coords[idx - 1]
            if (c.x === prev.x && c.y === prev.y) return ''
            return `H ${c.x} V ${c.y}`
          })
          .filter(Boolean)
          .join(' ')
      : ''

  const visibleNodes = coords.filter(
    (_, idx) =>
      coords.length <= 20 ||
      idx % Math.ceil(coords.length / 20) === 0 ||
      idx === coords.length - 1,
  )

  const first = points[0]
  const latest = points[points.length - 1]

  return (
    <div className="w-full flex flex-col gap-2 px-3.5 py-3 bg-slate-50 rounded-xl border border-slate-200">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-700 shrink-0">
          XP Progression
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums truncate">
          Lv.{first.level} ({first.xp}) {'\u2192'} Lv.{latest.level} ({latest.xp} XP)
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[68px] block bg-white border border-slate-200 rounded-lg"
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Pet progression chart from level ${first.level} (${first.xp} XP) to level ${latest.level} (${latest.xp} XP)`}
      >
        {/* Subtle horizontal pixel grid lines */}
        <rect x="0" y="17" width={width} height="1" fill="#e2e8f0" />
        <rect x="0" y="34" width={width} height="1" fill="#e2e8f0" />
        <rect x="0" y="51" width={width} height="1" fill="#e2e8f0" />

        {steppedPath && (
          <path
            d={steppedPath}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
          />
        )}

        {visibleNodes.map((c, idx) => {
          const isLast = idx === visibleNodes.length - 1
          return (
            <rect
              key={`${c.x}-${c.y}-${idx}`}
              x={c.x - 1}
              y={c.y - 1}
              width="3"
              height="3"
              fill={isLast ? '#1d4ed8' : '#3b82f6'}
            />
          )
        })}
      </svg>
    </div>
  )
}

export default function DashboardStatsPanel({
  activeLife,
  currentXp,
  currentLevel,
  refreshTick,
}: DashboardStatsPanelProps) {
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<'weekly' | 'all'>('weekly')

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const compactStats = useMemo(() => {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    return getDashboardStats({
      from: sevenDaysAgo,
      to: now,
      petLifeId: activeLife ? activeLife.id : null,
    })
  }, [refreshTick, activeLife?.id])

  const stats = useMemo(() => {
    if (!open) return compactStats
    const lifeScope = activeLife ? activeLife.id : null
    if (range === 'weekly') {
      const now = new Date()
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return getDashboardStats({
        from: sevenDaysAgo,
        to: now,
        petLifeId: lifeScope,
        currentXp,
        currentLevel,
      })
    }
    return getDashboardStats({
      petLifeId: lifeScope,
      currentXp,
      currentLevel,
    })
  }, [open, range, refreshTick, activeLife?.id, currentXp, currentLevel, compactStats])

  const barColor =
    stats.postureScore >= 80
      ? 'bg-emerald-500'
      : stats.postureScore >= 55
        ? 'bg-amber-500'
        : 'bg-red-500'

  return (
    <>
      {/* Trigger bar on main dashboard matching handcrafted HUD style */}
      <div className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200">
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium text-gray-700 truncate">
            Posture &amp; Work History
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums truncate">
            {compactStats.postureScore}% · {compactStats.completedSessions} done
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs shrink-0"
          onClick={() => {
            playToggle()
            setOpen(true)
          }}
        >
          Open
        </Button>
      </div>

      {/* History Modal matching PetSelectorModal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-history-title"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              playPop()
              setOpen(false)
            }}
          />

          <div className="relative z-10 w-full max-w-[344px] max-h-[540px] rounded-xl border bg-card text-card-foreground shadow-xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
              <div className="min-w-0">
                <h2
                  id="dashboard-history-title"
                  className="text-sm font-semibold leading-none"
                >
                  Posture &amp; Work History
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground truncate">
                  {activeLife
                    ? `${activeLife.name} · Lv.${currentLevel} · ${activeLife.xpEarned} XP earned`
                    : 'Posture & session log'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => {
                  playPop()
                  setOpen(false)
                }}
                aria-label="Close dashboard history"
              >
                <XIcon className="size-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-3.5 space-y-3">
              {/* Range Selector Row matching Work / Break presets */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground font-medium shrink-0">
                  Range
                </span>
                <div
                  className="flex gap-1.5"
                  role="group"
                  aria-label="Statistics time range"
                >
                  <Button
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    variant={range === 'weekly' ? 'default' : 'outline'}
                    aria-pressed={range === 'weekly'}
                    onClick={() => {
                      playToggle()
                      setRange('weekly')
                    }}
                  >
                    7 Days
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    variant={range === 'all' ? 'default' : 'outline'}
                    aria-pressed={range === 'all'}
                    onClick={() => {
                      playToggle()
                      setRange('all')
                    }}
                  >
                    All-Time
                  </Button>
                </div>
              </div>

              {/* Flat Stats HUD Block matching HP / XP bars */}
              <div className="w-full flex flex-col gap-2.5 px-3.5 py-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center gap-3">
                  <span className="w-16 shrink-0 font-medium text-xs text-gray-700 whitespace-nowrap">
                    Posture
                  </span>
                  <div className="h-2.5 flex-1 min-w-0 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ease-in-out ${barColor}`}
                      style={{ width: `${stats.postureScore}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right font-medium text-xs text-gray-700 tabular-nums whitespace-nowrap">
                    {stats.postureScore}%
                  </span>
                </div>

                <div className="border-t border-slate-200/80 pt-2 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground font-medium">
                      Work Time
                    </span>
                    <span className="text-xs font-medium text-gray-700 tabular-nums">
                      {formatDurationReadable(stats.totalWorkTimeSeconds)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground font-medium">
                      Completed
                    </span>
                    <span className="text-xs font-medium text-gray-700 tabular-nums">
                      {stats.completedSessions} Pomodoros
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground font-medium">
                      Interrupted
                    </span>
                    <span className="text-xs font-medium text-gray-700 tabular-nums">
                      {stats.interruptedSessions} reset
                    </span>
                  </div>
                </div>
              </div>

              {/* Stepped Pixel XP Progression */}
              <SteppedXpProgressionBlock points={stats.petProgression} />

              {/* Session History Block */}
              <div className="w-full flex flex-col gap-2 px-3.5 py-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-gray-700">
                    Session History
                  </span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {stats.sessionSummaries.length} logged
                  </span>
                </div>

                {stats.sessionSummaries.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">
                    Complete or reset a work Pomodoro to log sessions.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200/80 max-h-28 overflow-y-auto no-scrollbar text-xs">
                    {stats.sessionSummaries.slice(0, 20).map((sess) => {
                      const endedLabel = new Date(sess.endedAt).toLocaleString(
                        undefined,
                        {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        },
                      )
                      return (
                        <div
                          key={sess.id}
                          className="flex items-center justify-between gap-2 py-1.5"
                        >
                          <span className="text-muted-foreground truncate">
                            {endedLabel}
                          </span>
                          <div className="flex items-center gap-2 shrink-0 tabular-nums">
                            <span className="font-medium text-gray-700">
                              {formatDurationReadable(sess.durationSeconds)}
                            </span>
                            <span className="text-muted-foreground">
                              {sess.postureScore}%
                            </span>
                            <span
                              className={`font-medium ${
                                sess.completed
                                  ? 'text-emerald-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              {sess.completed ? 'Done' : 'Reset'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
