/**
 * Safe bridge for Custom Pet operations:
 * - In Electron: delegates strictly to the main process via `window.electronAPI`.
 * - In browser-only dev mode (`vite`): provides a local Canvas fallback so UI development
 *   and previews work without crashing when `window.electronAPI` is absent.
 */

import type {
  CreateCustomPetRequest,
  CreateCustomPetResult,
  CustomAnimationKey,
  CustomPetManifest,
  PetCreationProgress,
  PetSpecies,
  RuntimeCustomPet,
} from '../types/customPet'
import { NORMALIZED_ANIMATION_SPECS } from '../types/customPet'

const BROWSER_FALLBACK_STORAGE_KEY = 'posturepet-browser-custom-pets'

export async function listInstalledCustomPets(): Promise<RuntimeCustomPet[]> {
  if (window.electronAPI?.listCustomPets) {
    return window.electronAPI.listCustomPets()
  }
  try {
    const raw = localStorage.getItem(BROWSER_FALLBACK_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RuntimeCustomPet[]) : []
  } catch {
    return []
  }
}

export async function deleteInstalledCustomPet(petId: string): Promise<{ ok: boolean }> {
  if (window.electronAPI?.deleteCustomPet) {
    return window.electronAPI.deleteCustomPet(petId)
  }
  try {
    const existing = await listInstalledCustomPets()
    const filtered = existing.filter((p) => p.manifest.id !== petId)
    localStorage.setItem(BROWSER_FALLBACK_STORAGE_KEY, JSON.stringify(filtered))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function subscribeCustomPetProgress(
  callback: (progress: PetCreationProgress) => void,
): () => void {
  if (window.electronAPI?.onCustomPetProgress) {
    return window.electronAPI.onCustomPetProgress(callback)
  }
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<PetCreationProgress>).detail
    if (detail) callback(detail)
  }
  window.addEventListener('custom-pets:browser-progress', handler)
  return () => window.removeEventListener('custom-pets:browser-progress', handler)
}

function emitBrowserProgress(progress: PetCreationProgress) {
  window.dispatchEvent(new CustomEvent('custom-pets:browser-progress', { detail: progress }))
}

function renderBrowserFallbackSheet(
  species: PetSpecies,
  _anim: CustomAnimationKey,
  frames: number,
): string {
  const canvas = document.createElement('canvas')
  canvas.width = frames * 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.imageSmoothingEnabled = false

  const primary =
    species === 'cat' ? '#949cac' :
    species === 'rabbit' ? '#f2ece8' :
    species === 'fox' ? '#e86c2c' :
    species === 'bird' ? '#4cb2e8' :
    species === 'hamster' ? '#eeb66c' : '#e6a848'

  for (let f = 0; f < frames; f++) {
    const ox = f * 64
    const bob = f % 2 === 1 ? -2 : 0
    ctx.fillStyle = '#2d1e14'
    ctx.fillRect(ox + 20, 22 + bob, 24, 30)
    ctx.fillStyle = primary
    ctx.fillRect(ox + 21, 23 + bob, 22, 28)
    ctx.fillStyle = '#fff8ee'
    ctx.fillRect(ox + 25, 34 + bob, 14, 12)
    ctx.fillStyle = '#1e1612'
    ctx.fillRect(ox + 25, 28 + bob, 3, 3)
    ctx.fillRect(ox + 36, 28 + bob, 3, 3)
  }
  return canvas.toDataURL('image/png')
}

export async function createCustomPetViaBridge(
  request: CreateCustomPetRequest,
): Promise<CreateCustomPetResult> {
  if (window.electronAPI?.createCustomPet) {
    return window.electronAPI.createCustomPet(request)
  }

  if ((request.pipeline ?? 'autosprite') === 'autosprite') {
    emitBrowserProgress({ stage: 'preparing', message: 'Preparing photos…', percent: 15 })
    await new Promise((r) => setTimeout(r, 200))
    emitBrowserProgress({ stage: 'sending', message: 'Connecting to AutoSprite MCP…', percent: 35 })
    await new Promise((r) => setTimeout(r, 200))
    return {
      ok: false,
      code: 'MCP_UNAVAILABLE',
      error: 'AutoSprite MCP requires the Electron desktop runtime or local synthesizer fallback.',
    }
  }

  emitBrowserProgress({ stage: 'preparing', message: 'Preparing photos…', percent: 20 })
  await new Promise((r) => setTimeout(r, 150))
  emitBrowserProgress({ stage: 'generating', message: 'Synthesizing sprite sheets…', percent: 60 })
  await new Promise((r) => setTimeout(r, 150))
  emitBrowserProgress({ stage: 'validating', message: 'Validating assets…', percent: 85 })
  await new Promise((r) => setTimeout(r, 100))

  const id = `pet-${Date.now().toString(36)}`
  const manifest: CustomPetManifest = {
    id,
    name: request.name.trim() || 'Custom Pet',
    species: request.species,
    ...(request.breed ? { breed: request.breed } : {}),
    createdAt: new Date().toISOString(),
    sourcePhotos: request.photos.map((p) => ({ name: p.name, mimeType: p.mimeType })),
    animations: {
      idle: { ...NORMALIZED_ANIMATION_SPECS.idle },
      walk: { ...NORMALIZED_ANIMATION_SPECS.walk },
      hurt: { ...NORMALIZED_ANIMATION_SPECS.hurt },
      death: { ...NORMALIZED_ANIMATION_SPECS.death },
      attack: { ...NORMALIZED_ANIMATION_SPECS.attack },
      evolution: { ...NORMALIZED_ANIMATION_SPECS.evolution },
    },
  }

  const pet: RuntimeCustomPet = {
    manifest,
    spriteUrls: {
      idle: renderBrowserFallbackSheet(request.species, 'idle', 4),
      walk: renderBrowserFallbackSheet(request.species, 'walk', 6),
      hurt: renderBrowserFallbackSheet(request.species, 'hurt', 2),
      death: renderBrowserFallbackSheet(request.species, 'death', 3),
      attack: renderBrowserFallbackSheet(request.species, 'attack', 4),
      evolution: renderBrowserFallbackSheet(request.species, 'evolution', 8),
    },
  }

  const existing = await listInstalledCustomPets()
  localStorage.setItem(BROWSER_FALLBACK_STORAGE_KEY, JSON.stringify([pet, ...existing]))
  emitBrowserProgress({ stage: 'installing', message: 'Installed!', percent: 100 })

  return {
    ok: true,
    pet,
    validation: { valid: true, errors: [], warnings: [] },
    source: request.pipeline === 'fixture' ? 'fixture' : 'local-synth',
  }
}

export async function importCustomPetDirectoryViaBridge(meta?: {
  name?: string
  species?: PetSpecies
  breed?: string
}): Promise<CreateCustomPetResult> {
  if (window.electronAPI?.importCustomPetDirectory) {
    return window.electronAPI.importCustomPetDirectory(meta)
  }
  return {
    ok: false,
    code: 'MCP_UNAVAILABLE',
    error: 'Folder import requires the Electron desktop runtime.',
  }
}

export async function importFixturePetViaBridge(meta?: {
  name?: string
  species?: PetSpecies
  breed?: string
}): Promise<CreateCustomPetResult> {
  if (window.electronAPI?.importFixturePet) {
    return window.electronAPI.importFixturePet(meta)
  }
  return createCustomPetViaBridge({
    name: meta?.name || 'Mochi',
    species: meta?.species || 'cat',
    breed: meta?.breed || 'Calico',
    photos: [{ name: 'fixture.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    pipeline: 'fixture',
  })
}
