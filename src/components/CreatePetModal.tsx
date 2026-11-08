import { useState, useEffect, useRef } from 'react'
import { Button } from './ui/button'
import { XIcon, SparkleIcon } from './icons'
import {
  ALLOWED_PHOTO_MIME_TYPES,
  PET_CREATION_STAGES,
  PET_SPECIES_OPTIONS,
  type AllowedPhotoMimeType,
  type CustomAnimationKey,
  type PetCreationProgress,
  type PetSpecies,
  type RuntimeCustomPet,
  type UploadedPetPhoto,
} from '../types/customPet'
import {
  createCustomPetViaBridge,
  importCustomPetDirectoryViaBridge,
  importFixturePetViaBridge,
  subscribeCustomPetProgress,
} from '../utils/customPetBridge'
import { playPop, playToggle } from '../utils/soundEffects'

interface CreatePetModalProps {
  open: boolean
  onClose: () => void
  onPetInstalled: (pet: RuntimeCustomPet, selectImmediately: boolean) => void
}

type ModalView = 'form' | 'progress' | 'error' | 'preview'

const MAX_PHOTOS = 6
const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB

const ANIMATION_PREVIEW_ORDER: readonly { key: CustomAnimationKey; label: string }[] = [
  { key: 'idle',      label: 'Idle' },
  { key: 'walk',      label: 'Walk' },
  { key: 'hurt',      label: 'Hurt' },
  { key: 'death',     label: 'Death' },
  { key: 'attack',    label: 'Attack' },
] as const

/** Generate a tiny valid 32×32 PNG data URL for quick sample testing when desired. */
function makeSampleReferencePhotoDataUrl(species: PetSpecies): UploadedPetPhoto {
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const colorMap: Record<PetSpecies, string> = {
      dog: '#d99b43',
      cat: '#8a94a6',
      rabbit: '#f0e6e0',
      hamster: '#e6ac5c',
      bird: '#48a8e0',
      fox: '#e0662b',
      other: '#7bc476',
    }
    ctx.fillStyle = colorMap[species] || '#d99b43'
    ctx.fillRect(8, 8, 32, 32)
    ctx.fillStyle = '#fff5e4'
    ctx.fillRect(16, 20, 16, 14)
    ctx.fillStyle = '#221a16'
    ctx.fillRect(16, 16, 4, 4)
    ctx.fillRect(28, 16, 4, 4)
  }
  return {
    name: `${species}-reference.png`,
    mimeType: 'image/png',
    dataUrl: canvas.toDataURL('image/png'),
  }
}

export default function CreatePetModal({
  open,
  onClose,
  onPetInstalled,
}: CreatePetModalProps) {
  const [view, setView] = useState<ModalView>('form')
  const [name, setName] = useState('')
  const [species, setSpecies] = useState<PetSpecies>('dog')
  const [breed, setBreed] = useState('')
  const [photos, setPhotos] = useState<UploadedPetPhoto[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [progress, setProgress] = useState<PetCreationProgress>({
    stage: 'preparing',
    message: 'Preparing photos…',
    percent: 10,
  })
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [createdPet, setCreatedPet] = useState<RuntimeCustomPet | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Subscribe to main-process progress updates while open
  useEffect(() => {
    if (!open) return
    return subscribeCustomPetProgress((p) => {
      setProgress(p)
    })
  }, [open])

  // Escape key closes modal when not actively running a job
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && view !== 'progress') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, view, onClose])

  if (!open) return null

  const resetForm = () => {
    setView('form')
    setName('')
    setSpecies('dog')
    setBreed('')
    setPhotos([])
    setValidationErrors([])
    setGenerationError(null)
    setCreatedPet(null)
  }

  const handleClose = () => {
    if (view === 'progress') return
    playPop()
    onClose()
  }

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error(`Failed to read "${file.name}".`))
      reader.readAsDataURL(file)
    })

  const verifyImageLoadable = (dataUrl: string): Promise<boolean> =>
    new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0)
      img.onerror = () => resolve(false)
      img.src = dataUrl
    })

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const errors: string[] = []
    const nextPhotos: UploadedPetPhoto[] = [...photos]

    for (const file of Array.from(fileList)) {
      if (nextPhotos.length >= MAX_PHOTOS) {
        errors.push(`Maximum of ${MAX_PHOTOS} photos allowed.`)
        break
      }

      if (!ALLOWED_PHOTO_MIME_TYPES.includes(file.type as AllowedPhotoMimeType)) {
        errors.push(`"${file.name}" has unsupported format (${file.type || 'unknown'}). Upload JPG, PNG, or WebP.`)
        continue
      }

      if (file.size === 0) {
        errors.push(`"${file.name}" is empty.`)
        continue
      }

      if (file.size > MAX_PHOTO_BYTES) {
        errors.push(`"${file.name}" exceeds the 10 MB file size limit.`)
        continue
      }

      try {
        const dataUrl = await readFileAsDataUrl(file)
        const ok = await verifyImageLoadable(dataUrl)
        if (!ok) {
          errors.push(`"${file.name}" could not be decoded as a valid image.`)
          continue
        }
        nextPhotos.push({
          name: file.name,
          mimeType: file.type as AllowedPhotoMimeType,
          dataUrl,
        })
      } catch {
        errors.push(`Failed to read "${file.name}".`)
      }
    }

    setPhotos(nextPhotos)
    setValidationErrors(errors)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemovePhoto = (index: number) => {
    playPop()
    setPhotos((prev) => prev.filter((_, idx) => idx !== index))
    setValidationErrors([])
  }

  const handleAddSamplePhoto = () => {
    playPop()
    if (photos.length >= MAX_PHOTOS) {
      setValidationErrors([`Maximum of ${MAX_PHOTOS} photos allowed.`])
      return
    }
    const sample = makeSampleReferencePhotoDataUrl(species)
    setPhotos((prev) => [...prev, sample])
    setValidationErrors([])
  }

  const validateBeforeSubmit = (): boolean => {
    const errs: string[] = []
    if (!name.trim()) {
      errs.push('Please enter a name for your pet.')
    } else if (name.trim().length > 40) {
      errs.push('Pet name must be 40 characters or fewer.')
    }
    if (photos.length === 0) {
      errs.push('Please upload at least one JPG, PNG, or WebP photo of your pet.')
    }
    setValidationErrors(errs)
    return errs.length === 0
  }

  const runGeneration = async (pipeline: 'autosprite' | 'local-synth') => {
    if (!validateBeforeSubmit()) return
    playToggle()
    setGenerationError(null)
    setProgress({
      stage: 'preparing',
      message: 'Preparing reference photos…',
      percent: 10,
    })
    setView('progress')

    const res = await createCustomPetViaBridge({
      name: name.trim(),
      species,
      breed: breed.trim() || undefined,
      photos,
      pipeline,
    })

    if (!res.ok) {
      setGenerationError(res.error)
      setView('error')
      return
    }

    setCreatedPet(res.pet)
    onPetInstalled(res.pet, false)
    setView('preview')
  }

  const handleImportFixture = async () => {
    playToggle()
    setValidationErrors([])
    setGenerationError(null)
    setProgress({
      stage: 'preparing',
      message: 'Loading local fixture pet assets…',
      percent: 25,
    })
    setView('progress')

    const res = await importFixturePetViaBridge({
      name: name.trim() || 'Mochi',
      species: name.trim() ? species : 'cat',
      breed: breed.trim() || 'Calico',
    })

    if (!res.ok) {
      setGenerationError(res.error)
      setView('error')
      return
    }

    setCreatedPet(res.pet)
    onPetInstalled(res.pet, false)
    setView('preview')
  }

  const handleImportFolder = async () => {
    playToggle()
    setValidationErrors([])
    const res = await importCustomPetDirectoryViaBridge({
      name: name.trim() || undefined,
      species,
      breed: breed.trim() || undefined,
    })
    if (!res.ok) {
      if (res.error.includes('cancelled')) return
      setGenerationError(res.error)
      setView('error')
      return
    }
    setCreatedPet(res.pet)
    onPetInstalled(res.pet, false)
    setView('preview')
  }

  const currentStageIdx = PET_CREATION_STAGES.findIndex((s) => s.id === progress.stage)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-pet-modal-title"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />

      {/* Modal Panel */}
      <div className="relative z-10 w-full max-w-[352px] max-h-[580px] rounded-xl border bg-card text-card-foreground shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-1.5">
            <SparkleIcon className="size-4 text-primary shrink-0" />
            <div>
              <div className="flex items-center gap-1.5">
                <h2 id="create-pet-modal-title" className="text-sm font-semibold leading-none">
                  {view === 'preview' ? 'Pet Pack Ready!' : 'Create Your Own Pet'}
                </h2>
                <span className="rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide">
                  Experimental
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {view === 'form' && 'Upload pet photos to generate 64×64 pixel-art sprites'}
                {view === 'progress' && 'Processing custom pet sprite pack…'}
                {view === 'error' && 'Generation encountered an issue'}
                {view === 'preview' && 'Supports all 5 Wardrobe accessories (does not evolve)'}
              </p>
            </div>
          </div>
          {view !== 'progress' && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={handleClose}
              aria-label="Close modal"
            >
              <XIcon className="size-4" />
            </Button>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
          {/* ── FORM VIEW ───────────────────────────────────────────────── */}
          {view === 'form' && (
            <>
              {/* Pet Name */}
              <div className="space-y-1">
                <label htmlFor="pet-name-input" className="block text-xs font-medium text-foreground">
                  Pet Name <span className="text-destructive">*</span>
                </label>
                <input
                  id="pet-name-input"
                  type="text"
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Mochi, Barnaby, Pixel"
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Species Selector */}
              <div className="space-y-1">
                <span className="block text-xs font-medium text-foreground">
                  Species <span className="text-destructive">*</span>
                </span>
                <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Pet species">
                  {PET_SPECIES_OPTIONS.map((opt) => {
                    const selected = species === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => { playPop(); setSpecies(opt.value) }}
                        className={`flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-md border text-[11px] font-medium transition-colors ${
                          selected
                            ? 'border-primary bg-primary/10 text-foreground ring-1 ring-primary'
                            : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      >
                        <span className="text-sm leading-none" aria-hidden="true">{opt.emoji}</span>
                        <span>{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Optional Breed */}
              <div className="space-y-1">
                <label htmlFor="pet-breed-input" className="block text-xs font-medium text-foreground">
                  Breed / Markings <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <input
                  id="pet-breed-input"
                  type="text"
                  maxLength={40}
                  value={breed}
                  onChange={(e) => setBreed(e.target.value)}
                  placeholder="e.g. Shiba Inu, Calico, Lop-eared"
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Reference Photos Upload */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="pet-photos-input" className="text-xs font-medium text-foreground">
                    Reference Photos ({photos.length}/{MAX_PHOTOS}) <span className="text-destructive">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddSamplePhoto}
                    className="text-[11px] text-primary hover:underline font-medium"
                  >
                    + Add Sample Photo
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  id="pet-photos-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(e) => handleFilesSelected(e.target.files)}
                  className="sr-only"
                />

                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    disabled={photos.length >= MAX_PHOTOS}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload JPG / PNG / WebP Photos
                  </Button>
                </div>

                {/* Photo Previews */}
                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {photos.map((photo, index) => (
                      <div
                        key={`${photo.name}-${index}`}
                        className="relative group rounded-md border border-border bg-muted/40 p-1 flex flex-col items-center"
                      >
                        <img
                          src={photo.dataUrl}
                          alt={photo.name}
                          className="w-16 h-14 object-cover rounded"
                        />
                        <span className="mt-1 w-full truncate text-[10px] text-muted-foreground text-center">
                          {photo.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(index)}
                          aria-label={`Remove ${photo.name}`}
                          title="Remove photo"
                          className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-destructive text-white flex items-center justify-center text-[10px] font-bold shadow"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Validation Errors */}
              {validationErrors.length > 0 && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 space-y-1"
                >
                  {validationErrors.map((err, i) => (
                    <p key={i} className="text-[11px] font-medium text-destructive leading-snug">
                      • {err}
                    </p>
                  ))}
                </div>
              )}

              {/* Submit & Import Controls */}
              <div className="pt-1 flex flex-col gap-2">
                <Button
                  type="button"
                  onClick={() => runGeneration('autosprite')}
                  className="w-full text-xs font-semibold"
                >
                  Generate with AutoSprite MCP
                </Button>

                <div className="grid grid-cols-2 gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => runGeneration('local-synth')}
                    className="text-[11px] px-2"
                    title="Synthesize a 64×64 pixel-art pack locally using your reference photos"
                  >
                    Synthesize Locally
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleImportFixture}
                    className="text-[11px] px-2"
                    title="Install the bundled Mochi fixture pet pack"
                  >
                    Load Fixture Pack
                  </Button>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleImportFolder}
                  className="w-full text-[11px] text-muted-foreground hover:text-foreground h-7"
                >
                  Import Sprite Pack Folder from Disk…
                </Button>
              </div>
            </>
          )}

          {/* ── PROGRESS VIEW ───────────────────────────────────────────── */}
          {view === 'progress' && (
            <div className="py-3 space-y-4" aria-live="polite">
              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span>{progress.message}</span>
                  <span className="tabular-nums text-muted-foreground">{progress.percent}%</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(5, progress.percent))}%` }}
                  />
                </div>
              </div>

              {/* 5 Required Stages */}
              <ol className="space-y-2">
                {PET_CREATION_STAGES.map((stage, idx) => {
                  const isCompleted = idx < currentStageIdx || progress.percent >= 100
                  const isCurrent = idx === currentStageIdx && progress.percent < 100
                  return (
                    <li
                      key={stage.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs ${
                        isCurrent
                          ? 'border-primary bg-primary/10 text-foreground font-semibold'
                          : isCompleted
                          ? 'border-border bg-muted/40 text-foreground'
                          : 'border-border/50 bg-transparent text-muted-foreground'
                      }`}
                    >
                      <span
                        className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          isCompleted
                            ? 'bg-emerald-600 text-white'
                            : isCurrent
                            ? 'bg-primary text-primary-foreground animate-pulse'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {isCompleted ? '✓' : idx + 1}
                      </span>
                      <span>{stage.label}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {/* ── ERROR / RETRY VIEW ──────────────────────────────────────── */}
          {view === 'error' && (
            <div className="space-y-3 py-1" role="alert">
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-destructive">Generation Failed</p>
                <p className="text-[11px] text-foreground leading-relaxed">
                  {generationError}
                </p>
              </div>

              <p className="text-[11px] text-muted-foreground leading-relaxed">
                You can retry the AutoSprite MCP request, synthesize a custom pixel-art pack directly from your uploaded photos, or install the local fixture pack.
              </p>

              <div className="flex flex-col gap-2 pt-1">
                <Button
                  type="button"
                  onClick={() => runGeneration('autosprite')}
                  className="w-full text-xs"
                >
                  Retry AutoSprite Generation
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => runGeneration('local-synth')}
                  className="w-full text-xs"
                >
                  Build Pixel-Art Pack from Reference Photos
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleImportFixture}
                  className="w-full text-xs"
                >
                  Install Sample Fixture Pet
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setView('form')}
                  className="w-full text-xs"
                >
                  Back to Edit Details
                </Button>
              </div>
            </div>
          )}

          {/* ── RESULTS PREVIEW VIEW ────────────────────────────────────── */}
          {view === 'preview' && createdPet && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {createdPet.manifest.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground capitalize">
                    {createdPet.manifest.breed
                      ? `${createdPet.manifest.breed} · ${createdPet.manifest.species}`
                      : createdPet.manifest.species}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-semibold">
                  Validated 64×64 RGBA
                </span>
              </div>

              {/* Grid of all 6 generated animations */}
              <div className="grid grid-cols-3 gap-2">
                {ANIMATION_PREVIEW_ORDER.map(({ key, label }) => {
                  const spec = createdPet.manifest.animations[key]
                  const url = createdPet.spriteUrls[key]
                  if (!spec || !url) return null
                  return (
                    <div
                      key={key}
                      className="flex flex-col items-center rounded-lg border border-border bg-muted/30 p-2"
                    >
                      <div className="w-16 h-16 flex items-center justify-center overflow-hidden">
                        <div
                          className="sprite-base"
                          style={{
                            '--frame-size': `${spec.tileWidth}px`,
                            '--frames': `${spec.frames}`,
                            backgroundImage: `url("${url}")`,
                          } as React.CSSProperties}
                        />
                      </div>
                      <span className="mt-1 text-[11px] font-semibold text-foreground">
                        {label}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {spec.frames} frames · {spec.tileWidth}px
                      </span>
                    </div>
                  )
                })}
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <Button
                  type="button"
                  onClick={() => {
                    playPop()
                    onPetInstalled(createdPet, true)
                    resetForm()
                    onClose()
                  }}
                  className="w-full text-xs font-semibold"
                >
                  Use This Pet
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    playPop()
                    resetForm()
                    onClose()
                  }}
                  className="w-full text-xs"
                >
                  Done (Keep Current Pet)
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
