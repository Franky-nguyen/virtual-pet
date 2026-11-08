import { Card } from './ui/card'
import { Button } from './ui/button'
import type { SlouchScores } from '../types/electron'
import { playPop } from '../utils/soundEffects'

export type { SlouchScores }

export type StretchName = 'Shoulder Opener' | 'Neck Release' | 'Lower Back Stretch'

export interface StretchInfo {
  name: StretchName
  region: 'shoulder' | 'neck' | 'lowerBack'
  instruction: string
}

export const STRETCH_CATALOG: Readonly<Record<StretchName, StretchInfo>> = {
  'Shoulder Opener': {
    name: 'Shoulder Opener',
    region: 'shoulder',
    instruction:
      'Interlace your fingers behind your back, draw your shoulder blades together, and hold for 20 seconds.',
  },
  'Neck Release': {
    name: 'Neck Release',
    region: 'neck',
    instruction:
      'Drop your shoulders, slowly tilt your ear toward each shoulder, and gently tuck your chin for 20 seconds.',
  },
  'Lower Back Stretch': {
    name: 'Lower Back Stretch',
    region: 'lowerBack',
    instruction:
      'Sit tall, place one hand on the opposite knee, and gently twist your torso to each side for 20 seconds.',
  },
} as const

/**
 * P7: Pure function that returns the recommended stretch name for the highest
 * regional slouch score (`{ neck, lowerBack, shoulder }`).
 *
 * Fixture: `selectStretch({ neck: 2, lowerBack: 4, shoulder: 8 })` -> `'Shoulder Opener'`.
 * Ties: prefers `shoulder`, then `neck`, then `lowerBack`.
 */
export function selectStretch({ neck, lowerBack, shoulder }: SlouchScores): StretchName {
  const s = Number.isFinite(shoulder) ? shoulder : 0
  const n = Number.isFinite(neck) ? neck : 0
  const b = Number.isFinite(lowerBack) ? lowerBack : 0

  if (s >= n && s >= b) {
    return 'Shoulder Opener'
  }
  if (n >= b) {
    return 'Neck Release'
  }
  return 'Lower Back Stretch'
}

/**
 * Compute the average regional slouch scores across a history of samples.
 */
export function averageSlouchHistory(history: readonly SlouchScores[]): SlouchScores {
  if (!history || history.length === 0) {
    return { neck: 0, lowerBack: 0, shoulder: 0 }
  }
  let neckSum = 0
  let lowerBackSum = 0
  let shoulderSum = 0
  for (const sample of history) {
    neckSum += Number.isFinite(sample.neck) ? sample.neck : 0
    lowerBackSum += Number.isFinite(sample.lowerBack) ? sample.lowerBack : 0
    shoulderSum += Number.isFinite(sample.shoulder) ? sample.shoulder : 0
  }
  const count = history.length
  return {
    neck: neckSum / count,
    lowerBack: lowerBackSum / count,
    shoulder: shoulderSum / count,
  }
}

/**
 * P7: Average the sampled `{ neck, lowerBack, shoulder }` slouch history and
 * return the winning stretch via `selectStretch`.
 */
export function analyzeSlouchHistory(history: readonly SlouchScores[]): StretchName {
  return selectStretch(averageSlouchHistory(history))
}

/**
 * Extract numeric `{ neck, lowerBack, shoulder }` scores (clamped to 0..10)
 * from any posture WebSocket payload, or return null if no scores are present.
 */
export function parseSlouchScores(raw: unknown): SlouchScores | null {
  let obj: Record<string, unknown> | null = null
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        obj = parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  }
  if (!obj) return null

  const nested =
    obj.scores && typeof obj.scores === 'object'
      ? (obj.scores as Record<string, unknown>)
      : null
  const metrics =
    obj.metrics && typeof obj.metrics === 'object'
      ? (obj.metrics as Record<string, unknown>)
      : null

  const pick = (key: string): number | undefined => {
    for (const source of [obj, nested, metrics]) {
      if (source && typeof source[key] === 'number' && Number.isFinite(source[key] as number)) {
        return Math.min(10, Math.max(0, source[key] as number))
      }
    }
    return undefined
  }

  const neck = pick('neck')
  const lowerBack = pick('lowerBack') ?? pick('lower_back')
  const shoulder = pick('shoulder')

  if (neck === undefined && lowerBack === undefined && shoulder === undefined) {
    return null
  }

  return {
    neck: neck ?? 0,
    lowerBack: lowerBack ?? 0,
    shoulder: shoulder ?? 0,
  }
}

export interface StretchBreakModalProps {
  open: boolean
  reason: string
  stretchName: StretchName
  mode?: 'dashboard' | 'taskbar'
  onFinishedStretching: () => void
}

export default function StretchBreakModal({
  open,
  reason,
  stretchName,
  mode = 'dashboard',
  onFinishedStretching,
}: StretchBreakModalProps) {
  if (!open) return null

  const stretch = STRETCH_CATALOG[stretchName] ?? STRETCH_CATALOG['Shoulder Opener']

  if (mode === 'taskbar') {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Stretch Break"
        className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-1 rounded-xl bg-background/95 p-2 text-center animate-in fade-in duration-150"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-800">
          {reason}
        </span>
        <span className="text-[11px] font-semibold leading-tight text-foreground">
          {stretch.name}
        </span>
        <p className="text-[9px] leading-snug text-muted-foreground line-clamp-3 px-1">
          {stretch.instruction}
        </p>
        <Button
          size="sm"
          className="mt-0.5 h-6 px-2.5 text-[10px]"
          onClick={() => {
            playPop()
            onFinishedStretching()
          }}
        >
          Finished Stretching
        </Button>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stretch-break-title"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Card className="relative z-10 w-full max-w-[calc(100%-2rem)] mx-4 gap-0 p-0 shadow-xl animate-in zoom-in-95 fade-in duration-150">
        {/* Header */}
        <div className="px-5 pt-5 pb-3.5 border-b border-border flex items-center justify-between gap-2">
          <div>
            <h2 id="stretch-break-title" className="text-sm font-semibold leading-none text-foreground">
              Time for a Stretch Break
            </h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Reason: <span className="font-medium text-foreground">{reason}</span>
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold text-amber-800">
            Break Paused
          </span>
        </div>

        {/* Recommended Stretch Body */}
        <div className="p-5 space-y-3">
          <div className="rounded-xl border border-border bg-muted/50 p-3.5 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recommended Stretch
            </div>
            <div className="text-base font-bold text-foreground">
              {stretch.name}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {stretch.instruction}
            </p>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground text-center">
            Your Pomodoro timer and webcam are paused while you stretch.
          </p>

          <Button
            className="w-full"
            onClick={() => {
              playPop()
              onFinishedStretching()
            }}
          >
            Finished Stretching
          </Button>
        </div>
      </Card>
    </div>
  )
}
