import { XIcon } from './icons'

// Telemetry fields pushed by detector.py alongside each debug frame.
export interface DebugMetrics {
  status?: string
  ratio?: number
  baseline?: number
  threshold?: number
  shoulder_slope_deg?: number
  ear_shoulder_ratio?: number
  shoulder_width?: number
  slouch_window?: string
}

interface DebugPanelProps {
  open: boolean
  frame: string | null
  metrics: DebugMetrics | null
  status: string
  onClose: () => void
  /** Quick test action: +50 XP (identical to the old throwaway dashboard button). */
  onAddXp: () => void
  /** Quick test action: -25 HP (identical to the old throwaway dashboard button). */
  onDamage: () => void
}

const STATUS_COLORS: Record<string, string> = {
  good: 'text-green-400',
  slouching: 'text-red-400',
  away: 'text-gray-400',
  calibrating: 'text-sky-400',
}

/**
 * "Inside the Brain" — internal developer inspection overlay.
 *
 * Renders NOTHING when closed, so the consumer-facing dashboard is completely
 * unaffected. Opened with Ctrl+Shift+D (or the close button toggles it back).
 * The annotated frame only streams while this is open: opening it sends the
 * `debug: true` command to the Python backend, closing sends `debug: false`,
 * which keeps CPU at ~zero in normal use.
 */
export default function DebugPanel({ open, frame, metrics, status, onClose, onAddXp, onDamage }: DebugPanelProps) {
  if (!open) return null

  const rows: [string, string][] = []
  const add = (key: string, value: unknown) => {
    rows.push([key, value === undefined || value === null || value === '' ? '—' : String(value)])
  }
  add('status', status.toUpperCase())
  add('ratio', metrics?.ratio)
  add('baseline', metrics?.baseline)
  add('threshold', metrics?.threshold)
  add('shoulder_tilt', metrics?.shoulder_slope_deg !== undefined ? `${metrics.shoulder_slope_deg} deg` : undefined)
  add('ear->shoulder', metrics?.ear_shoulder_ratio)
  add('shoulder_w', metrics?.shoulder_width)
  add('slouch_window', metrics?.slouch_window)

  return (
    <div className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 text-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800">
        <span className="text-[10px] font-mono font-semibold tracking-widest text-slate-400 uppercase">
          Inside the Brain — detector telemetry
        </span>
        <button
          onClick={onClose}
          title="Close debug view (Ctrl+Shift+D)"
          aria-label="Close debug view"
          className="text-slate-400 hover:text-white transition-colors"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {/* Annotated live feed */}
      {frame ? (
        <img src={frame} alt="Annotated posture feed" className="w-full h-auto" />
      ) : (
        <div className="px-3 py-6 text-center text-xs text-slate-500 font-mono">
          Waiting for frames... (detector streams only while this view is open)
        </div>
      )}

      {/* Real-time numeric readouts */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-2 font-mono text-[11px]">
        {rows.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-2">
            <span className="text-slate-500">{key}</span>
            <span
              className={
                key === 'status'
                  ? (STATUS_COLORS[status] ?? 'text-white')
                  : 'text-slate-100 tabular-nums'
              }
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Quick test actions — the old throwaway dashboard buttons, tucked
          inside this drawer. The panel returns null while closed, so these
          can never leak into the consumer-facing UI. */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-700">
        <span className="text-[10px] font-mono font-semibold tracking-widest text-slate-500 uppercase">
          Actions
        </span>
        <div className="flex gap-2 ml-auto">
          <button
            type="button"
            onClick={onAddXp}
            className="rounded border border-slate-600 bg-slate-800 px-2.5 py-1 font-mono text-[11px] text-violet-300 hover:bg-slate-700 transition-colors"
          >
            Debug: +50 XP
          </button>
          <button
            type="button"
            onClick={onDamage}
            className="rounded border border-slate-600 bg-slate-800 px-2.5 py-1 font-mono text-[11px] text-red-300 hover:bg-slate-700 transition-colors"
          >
            Debug: -25 HP
          </button>
        </div>
      </div>
    </div>
  )
}
