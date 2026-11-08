import { Button } from './ui/button'
import { XIcon, LockIcon } from './icons'
import { ACCESSORIES, isAccessoryUnlocked } from '../types/accessories'
import type { AccessoryType } from '../types/accessories'
import { playPop } from '../utils/soundEffects'

interface WardrobeModalProps {
  open: boolean
  petLevel: number
  isEvolved: boolean
  selectedAccessory: AccessoryType
  onSelect: (id: AccessoryType) => void
  onClose: () => void
}

export default function WardrobeModal({
  open,
  petLevel,
  isEvolved,
  selectedAccessory,
  onSelect,
  onClose,
}: WardrobeModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Modal panel — matches main UI card style */}
      <div className="relative z-10 w-full max-w-xs mx-4 rounded-xl border bg-card text-card-foreground shadow-xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-foreground leading-none">Wardrobe</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Lv.{petLevel} · tap to equip
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => { playPop(); onClose() }}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Accessory grid */}
        <div className="grid grid-cols-3 gap-3 p-4">

          {/* None / unequip slot */}
          <button
            type="button"
            onClick={() => { playPop(); onSelect('none') }}
            className={`flex flex-col items-center gap-2 py-3 px-2 rounded-xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selectedAccessory === 'none'
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border hover:border-primary/50 hover:bg-muted'
            }`}
          >
            {/* Centered dashed circle */}
            <div className="w-12 h-12 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
              <span className="text-muted-foreground/40 text-lg font-light" aria-hidden="true">—</span>
            </div>
            <span className="text-xs font-medium text-foreground">None</span>
          </button>

          {ACCESSORIES.map((accessory) => {
            const locked = !isAccessoryUnlocked(accessory.id, petLevel, isEvolved)
            const equipped = selectedAccessory === accessory.id

            return (
              <button
                key={accessory.id}
                type="button"
                disabled={locked}
                onClick={() => { if (!locked) { playPop(); onSelect(accessory.id) } }}
                className={`group relative flex flex-col items-center gap-2 py-3 px-2 rounded-xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  equipped
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : locked
                    ? 'border-border bg-muted/40 opacity-50 grayscale cursor-not-allowed'
                    : 'border-border hover:border-primary/50 hover:bg-muted'
                }`}
                title={
                  locked
                    ? `Unlocks at level ${accessory.unlockedAtLevel}`
                    : equipped
                    ? `Equipped: ${accessory.name}`
                    : accessory.name
                }
              >
                {/* Emoji preview */}
                <div className="relative w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center">
                  <span className="text-2xl leading-none" aria-hidden="true">
                    {accessory.icon}
                  </span>

                  {/* Lock badge — pill in bottom-right corner */}
                  {locked && (
                    <div className="absolute -bottom-1 -right-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-muted border border-border shadow-sm">
                      <LockIcon className="size-2.5 text-muted-foreground" />
                      <span className="text-[10px] font-semibold text-muted-foreground leading-none">
                        {accessory.unlockedAtLevel}
                      </span>
                    </div>
                  )}

                  {/* Equipped checkmark — top-right corner */}
                  {equipped && !locked && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center shadow-sm">
                      <span className="text-[9px] font-bold text-primary-foreground leading-none">✓</span>
                    </div>
                  )}
                </div>

                {/* Label */}
                <span className="text-xs font-medium text-foreground leading-tight text-center px-1">
                  {accessory.name}
                </span>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-1 text-center text-[11px] text-muted-foreground">
          Accessories unlock as your pet levels up.
        </div>
      </div>
    </div>
  )
}
