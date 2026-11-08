import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { XIcon } from './icons'
import { BUILTIN_DOG_ID, BUILTIN_CAT_ID, type RuntimeCustomPet } from '../types/customPet'
import { getSpriteUrl } from './PetDisplay'
import { playPop, playToggle } from '../utils/soundEffects'

interface PetSelectorModalProps {
  open: boolean
  selectedPetId: string
  customPets: RuntimeCustomPet[]
  onSelectPet: (petId: string) => void
  onDeletePet: (petId: string) => Promise<void>
  onOpenCreateModal: () => void
  onClose: () => void
}

export default function PetSelectorModal({
  open,
  selectedPetId,
  customPets,
  onSelectPet,
  onDeletePet,
  onOpenCreateModal,
  onClose,
}: PetSelectorModalProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setConfirmDeleteId(null)
      setDeletingId(null)
      return
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const handleConfirmDelete = async (petId: string) => {
    playToggle()
    setDeletingId(petId)
    try {
      await onDeletePet(petId)
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pet-selector-title"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => { playPop(); onClose() }}
      />

      {/* Modal Panel */}
      <div className="relative z-10 w-full max-w-[352px] max-h-[560px] rounded-xl border bg-card text-card-foreground shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
          <div>
            <h2 id="pet-selector-title" className="text-sm font-semibold leading-none">
              Select Your Pet
            </h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Switch between Original Dog, Pixel Cat, and custom pets
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => { playPop(); onClose() }}
            aria-label="Close pet selector"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {/* Pet List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {/* Built-in Pets: Original Dog & Pixel Cat */}
          {([
            {
              id: BUILTIN_DOG_ID,
              name: 'Original Dog',
              model: 'dog' as const,
              description: 'Supports Wardrobe accessories & Level 10 evolution',
            },
            {
              id: BUILTIN_CAT_ID,
              name: 'Pixel Cat',
              model: 'cat' as const,
              description: 'Supports all 5 Wardrobe accessories (does not evolve)',
            },
          ]).map((builtin) => {
            const isSelected = selectedPetId === builtin.id
            const preview = getSpriteUrl('Idle', 'none', false, builtin.model)
            return (
              <div
                key={builtin.id}
                className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'border-border bg-muted/30 hover:bg-muted/60'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    playPop()
                    onSelectPet(builtin.id)
                    onClose()
                  }}
                  className="flex flex-1 items-center gap-3 text-left focus:outline-none"
                >
                  <div className="w-12 h-12 rounded-lg bg-background border border-border flex items-center justify-center overflow-hidden shrink-0">
                    <div
                      className="sprite-base"
                      style={{
                        '--frame-size': '64px',
                        '--frames': `${preview.frames}`,
                        backgroundImage: `url("${preview.url}")`,
                        transform: 'scale(0.75)',
                      } as React.CSSProperties}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {builtin.name}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                        Built-in
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {builtin.description}
                    </p>
                  </div>
                </button>
                {isSelected ? (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shrink-0">
                    Active
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs shrink-0"
                    onClick={() => {
                      playPop()
                      onSelectPet(builtin.id)
                      onClose()
                    }}
                  >
                    Use
                  </Button>
                )}
              </div>
            )
          })}

          {/* Installed Custom Pets */}
          {customPets.map((pet) => {
            const isSelected = selectedPetId === pet.manifest.id
            const isConfirming = confirmDeleteId === pet.manifest.id
            const idleSpec = pet.manifest.animations.idle

            return (
              <div
                key={pet.manifest.id}
                className={`rounded-xl border p-2.5 transition-colors ${
                  isSelected
                    ? 'border-primary bg-primary/10 ring-1 ring-primary'
                    : 'border-border bg-muted/30 hover:bg-muted/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      playPop()
                      onSelectPet(pet.manifest.id)
                      onClose()
                    }}
                    className="flex flex-1 items-center gap-3 text-left min-w-0 focus:outline-none"
                  >
                    <div className="w-12 h-12 rounded-lg bg-background border border-border flex items-center justify-center overflow-hidden shrink-0">
                      <div
                        className="sprite-base"
                        style={{
                          '--frame-size': `${idleSpec.tileWidth}px`,
                          '--frames': `${idleSpec.frames}`,
                          backgroundImage: `url("${pet.spriteUrls.idle}")`,
                          transform: 'scale(0.75)',
                        } as React.CSSProperties}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {pet.manifest.name}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground capitalize">
                          {pet.manifest.species}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {pet.manifest.breed ? `${pet.manifest.breed} · ` : ''}
                        Supports Wardrobe accessories
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {isSelected ? (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                        Active
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => {
                          playPop()
                          onSelectPet(pet.manifest.id)
                          onClose()
                        }}
                      >
                        Use
                      </Button>
                    )}

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        playPop()
                        setConfirmDeleteId(isConfirming ? null : pet.manifest.id)
                      }}
                      aria-label={`Delete ${pet.manifest.name}`}
                      title={`Delete ${pet.manifest.name}`}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Delete Confirmation Row */}
                {isConfirming && (
                  <div
                    role="alert"
                    className="mt-2 pt-2 border-t border-border flex items-center justify-between gap-2"
                  >
                    <span className="text-[11px] font-medium text-destructive">
                      Delete &ldquo;{pet.manifest.name}&rdquo; permanently?
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="h-6 px-2 text-[11px]"
                        disabled={deletingId === pet.manifest.id}
                        onClick={() => handleConfirmDelete(pet.manifest.id)}
                      >
                        {deletingId === pet.manifest.id ? 'Deleting…' : 'Confirm'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {customPets.length === 0 && (
            <p className="text-center text-[11px] text-muted-foreground py-2">
              No custom pets installed yet. Create one from photos of your pet!
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border shrink-0">
          <Button
            type="button"
            className="w-full gap-1.5 text-xs"
            onClick={() => {
              playToggle()
              onClose()
              onOpenCreateModal()
            }}
          >
            Create Your Own Pet
            <span className="rounded-full bg-amber-200 text-amber-950 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
              Experimental
            </span>
          </Button>
        </div>
      </div>
    </div>
  )
}
