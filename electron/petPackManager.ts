/**
 * Custom Pet Pack Manager (Electron Main Process).
 *
 * Responsibilities:
 * - Store generated/imported pet packs under `<userData>/custom-pets/<id>/`
 * - Enforce strict path traversal protection and canonical filenames
 * - Validate every manifest and PNG sprite sheet before saving and before loading
 * - Never persist original uploaded reference photos after generation completes or fails
 * - Serve validated PNGs as `data:image/png;base64,...` URLs so assets work identically
 *   in development and packaged Electron builds without exposing filesystem access.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { app, nativeImage } from 'electron'
import type {
  AllowedPhotoMimeType,
  CreateCustomPetRequest,
  CreateCustomPetResult,
  CustomAnimationKey,
  CustomPetManifest,
  PetCreationProgress,
  PetSpecies,
  RuntimeCustomPet,
  SourcePhotoMetadata,
} from '../src/types/customPet'
import {
  ALLOWED_PHOTO_MIME_TYPES,
  NORMALIZED_ANIMATION_SPECS,
  PET_SPECIES_OPTIONS,
} from '../src/types/customPet'
import {
  decodePng,
  extractPaletteFromRgbaSamples,
  normalizeToHorizontalStrip,
  synthesizeAllAnimations,
} from './pngCodec'
import {
  CANONICAL_ANIMATION_FILES,
  isValidPetId,
  validateCompletePetPack,
  validateManifest,
  validateSingleSpriteSheet,
} from './petValidator'
import { generateSpritesViaAutoSpriteMcp } from './autospriteClient'

export function getCustomPetsRootDir(): string {
  const dir = path.join(app.getPath('userData'), 'custom-pets')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Resolve a pet directory strictly within `<userData>/custom-pets/`.
 * Throws if `petId` is malformed or attempts path traversal.
 */
export function resolveSafePetDir(petId: string): string {
  if (!isValidPetId(petId)) {
    throw new Error('Invalid pet ID format.')
  }
  const root = path.resolve(getCustomPetsRootDir())
  const target = path.resolve(root, petId)
  if (!target.startsWith(root + path.sep) || path.dirname(target) !== root) {
    throw new Error('Path traversal blocked.')
  }
  return target
}

function generatePetId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'custom-pet'
  const rand = crypto.randomBytes(4).toString('hex')
  return `${slug}-${rand}`
}

/**
 * Read and validate a single installed pet pack from `<userData>/custom-pets/<petId>`.
 * Returns null if missing or invalid.
 */
export function loadInstalledPet(petId: string): RuntimeCustomPet | null {
  try {
    const petDir = resolveSafePetDir(petId)
    const manifestPath = path.join(petDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) return null

    const rawJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const manifestCheck = validateManifest(rawJson)
    if (!manifestCheck.valid || !manifestCheck.manifest) {
      console.warn(`[petPackManager] Invalid manifest for ${petId}:`, manifestCheck.errors)
      return null
    }

    const manifest = manifestCheck.manifest
    if (manifest.id !== petId) {
      console.warn(`[petPackManager] Manifest id mismatch (${manifest.id} !== ${petId})`)
      return null
    }

    const keysToLoad: CustomAnimationKey[] = ['idle', 'walk', 'hurt', 'death', 'attack']
    if (manifest.animations.evolution) {
      keysToLoad.push('evolution')
    }

    const spriteUrls: Partial<Record<CustomAnimationKey, string>> = {}

    for (const key of keysToLoad) {
      const spec = manifest.animations[key]
      if (!spec) continue
      const canonicalFile = CANONICAL_ANIMATION_FILES[key]
      const filePath = path.resolve(petDir, canonicalFile)
      if (path.dirname(filePath) !== petDir || !fs.existsSync(filePath)) {
        console.warn(`[petPackManager] Missing sprite sheet ${canonicalFile} in ${petId}`)
        return null
      }

      const buf = fs.readFileSync(filePath)
      const check = validateSingleSpriteSheet(key, buf, spec)
      if (!check.valid) {
        console.warn(`[petPackManager] Invalid sprite sheet ${canonicalFile} in ${petId}:`, check.errors)
        return null
      }
      spriteUrls[key] = `data:image/png;base64,${buf.toString('base64')}`
    }

    return {
      manifest,
      spriteUrls: spriteUrls as RuntimeCustomPet['spriteUrls'],
    }
  } catch (err) {
    console.warn(`[petPackManager] Failed to load pet ${petId}:`, err)
    return null
  }
}

/** List all valid installed custom pet packs sorted newest-first. */
export function listInstalledPets(): RuntimeCustomPet[] {
  const root = getCustomPetsRootDir()
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  const pets: RuntimeCustomPet[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!isValidPetId(entry.name)) continue
    const loaded = loadInstalledPet(entry.name)
    if (loaded) pets.push(loaded)
  }

  pets.sort((a, b) => Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt))
  return pets
}

/** Delete an installed custom pet pack safely. */
export function deleteInstalledPet(petId: string): boolean {
  const petDir = resolveSafePetDir(petId)
  if (!fs.existsSync(petDir)) return false
  fs.rmSync(petDir, { recursive: true, force: true })
  return true
}

/**
 * Validate and atomically install a custom pet pack into `<userData>/custom-pets/<id>/`.
 */
export function installValidatedPetPack(
  manifest: CustomPetManifest,
  files: Record<CustomAnimationKey, Buffer>,
): { pet: RuntimeCustomPet; warnings: string[] } {
  const validation = validateCompletePetPack(manifest, files)
  if (!validation.valid) {
    const err = new Error(`Sprite validation failed: ${validation.errors.join(' ')}`)
    ;(err as Error & { code?: string; details?: string[] }).code = 'VALIDATION_FAILED'
    ;(err as Error & { code?: string; details?: string[] }).details = validation.errors
    throw err
  }

  const targetDir = resolveSafePetDir(manifest.id)
  const tempDir = `${targetDir}.tmp-${Date.now()}`

  try {
    fs.mkdirSync(tempDir, { recursive: true })
    fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

    const allKeys: CustomAnimationKey[] = ['idle', 'walk', 'hurt', 'death', 'attack', 'evolution']
    for (const key of allKeys) {
      const spec = manifest.animations[key]
      const buf = files[key]
      if (spec && buf) {
        const safeFilename = CANONICAL_ANIMATION_FILES[key]
        fs.writeFileSync(path.join(tempDir, safeFilename), buf)
      }
    }

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    fs.renameSync(tempDir, targetDir)
  } finally {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup error
      }
    }
  }

  const installed = loadInstalledPet(manifest.id)
  if (!installed) {
    throw new Error('Failed to load newly installed pet pack.')
  }
  return { pet: installed, warnings: validation.warnings }
}

/**
 * Decode uploaded photo data URLs in memory using Electron's `nativeImage`
 * (or PNG decoder fallback) to verify image integrity and extract RGBA pixel samples.
 */
function inspectAndSamplePhotos(photos: CreateCustomPetRequest['photos']): {
  sourceMeta: SourcePhotoMetadata[]
  samples: { width: number; height: number; rgba: Uint8Array }[]
} {
  if (!Array.isArray(photos) || photos.length === 0) {
    throw new Error('Please upload at least one reference photo of your pet.')
  }
  if (photos.length > 6) {
    throw new Error('Maximum of 6 reference photos allowed.')
  }

  const sourceMeta: SourcePhotoMetadata[] = []
  const samples: { width: number; height: number; rgba: Uint8Array }[] = []

  for (const photo of photos) {
    if (!photo || typeof photo.name !== 'string' || typeof photo.dataUrl !== 'string') {
      throw new Error('Invalid photo upload payload.')
    }
    if (!ALLOWED_PHOTO_MIME_TYPES.includes(photo.mimeType as AllowedPhotoMimeType)) {
      throw new Error(`Unsupported file type "${photo.mimeType}" for "${photo.name}". Use JPG, PNG, or WebP.`)
    }
    if (!photo.dataUrl.startsWith(`data:${photo.mimeType};base64,`)) {
      throw new Error(`Photo "${photo.name}" has an invalid data URL header.`)
    }
    const base64Part = photo.dataUrl.slice(photo.dataUrl.indexOf(',') + 1)
    const byteLen = Buffer.byteLength(base64Part, 'base64')
    if (byteLen < 64) {
      throw new Error(`Photo "${photo.name}" is empty or corrupt.`)
    }
    if (byteLen > 10 * 1024 * 1024) {
      throw new Error(`Photo "${photo.name}" exceeds the 10 MB size limit.`)
    }

    // Decode with Electron nativeImage to verify readability and extract RGBA pixels
    const img = nativeImage.createFromDataURL(photo.dataUrl)
    const size = img.getSize()
    if (!img.isEmpty() && size.width > 0 && size.height > 0) {
      const pngBuf = img.resize({ width: Math.min(64, size.width), height: Math.min(64, size.height) }).toPNG()
      const decoded = decodePng(pngBuf)
      samples.push({ width: decoded.width, height: decoded.height, rgba: decoded.rgba })
    } else if (photo.mimeType === 'image/png') {
      const decoded = decodePng(Buffer.from(base64Part, 'base64'))
      samples.push({ width: decoded.width, height: decoded.height, rgba: decoded.rgba })
    } else {
      throw new Error(`Could not decode image "${photo.name}". Please upload a valid JPG, PNG, or WebP photo.`)
    }

    sourceMeta.push({
      name: path.basename(photo.name).slice(0, 120),
      mimeType: photo.mimeType,
    })
  }

  return { sourceMeta, samples }
}

/**
 * Full "Create Your Own Pet" pipeline in the Electron main process:
 * 1. Preparing photos
 * 2. Sending to AutoSprite
 * 3. Generating sprite sheets
 * 4. Validating assets
 * 5. Installing pet
 */
export async function createCustomPetPack(
  req: CreateCustomPetRequest,
  onProgress: (progress: PetCreationProgress) => void,
): Promise<CreateCustomPetResult> {
  try {
    const trimmedName = (req.name ?? '').trim()
    if (!trimmedName || trimmedName.length > 40) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        error: 'Please enter a pet name between 1 and 40 characters.',
      }
    }

    const validSpecies = PET_SPECIES_OPTIONS.map((s) => s.value)
    const species: PetSpecies = validSpecies.includes(req.species) ? req.species : 'dog'
    const breed = req.breed?.trim() ? req.breed.trim().slice(0, 40) : undefined
    const pipeline = req.pipeline ?? 'autosprite'

    // Stage 1: Preparing photos
    onProgress({
      stage: 'preparing',
      message: 'Validating and preparing reference photos…',
      percent: 12,
    })

    let sourceMeta: SourcePhotoMetadata[] = []
    let samples: { width: number; height: number; rgba: Uint8Array }[] = []

    if (pipeline === 'fixture' && (!req.photos || req.photos.length === 0)) {
      sourceMeta = [{ name: 'fixture_reference.png', mimeType: 'image/png' }]
    } else {
      const inspected = inspectAndSamplePhotos(req.photos)
      sourceMeta = inspected.sourceMeta
      samples = inspected.samples
    }

    let generatedFiles: Record<CustomAnimationKey, Buffer>
    let usedSource: 'autosprite' | 'local-synth' | 'fixture' = 'autosprite'

    if (pipeline === 'autosprite') {
      generatedFiles = await generateSpritesViaAutoSpriteMcp({
        name: trimmedName,
        species,
        breed,
        photos: req.photos,
        isPackaged: app.isPackaged,
        onProgress,
      })
      usedSource = 'autosprite'
    } else {
      // Stage 2 & 3 for local-synth / fixture pipeline
      onProgress({
        stage: 'sending',
        message: 'Analyzing reference photo color palette and markings…',
        percent: 32,
      })
      await new Promise((r) => setTimeout(r, 220))

      onProgress({
        stage: 'generating',
        message: 'Synthesizing 64×64 pixel-art sprite sheets (idle, walk, hurt, death, attack, evolution)…',
        percent: 58,
      })
      await new Promise((r) => setTimeout(r, 260))

      const palette = extractPaletteFromRgbaSamples(samples, species)
      generatedFiles = synthesizeAllAnimations(species, palette)
      usedSource = pipeline === 'fixture' ? 'fixture' : 'local-synth'
    }

    // Stage 4: Validating assets
    onProgress({
      stage: 'validating',
      message: 'Validating PNG format, RGBA transparency, tile geometry, and frame stability…',
      percent: 82,
    })

    const manifest: CustomPetManifest = {
      id: generatePetId(trimmedName),
      name: trimmedName,
      species,
      ...(breed ? { breed } : {}),
      createdAt: new Date().toISOString(),
      sourcePhotos: sourceMeta,
      animations: {
        idle: { ...NORMALIZED_ANIMATION_SPECS.idle },
        walk: { ...NORMALIZED_ANIMATION_SPECS.walk },
        hurt: { ...NORMALIZED_ANIMATION_SPECS.hurt },
        death: { ...NORMALIZED_ANIMATION_SPECS.death },
        attack: { ...NORMALIZED_ANIMATION_SPECS.attack },
        evolution: { ...NORMALIZED_ANIMATION_SPECS.evolution },
      },
    }

    const validation = validateCompletePetPack(manifest, generatedFiles)
    if (!validation.valid) {
      return {
        ok: false,
        code: 'VALIDATION_FAILED',
        error: `Generated assets failed validation: ${validation.errors[0]}`,
        details: validation.errors,
      }
    }

    // Stage 5: Installing pet
    onProgress({
      stage: 'installing',
      message: 'Installing validated sprite pack to application data…',
      percent: 95,
    })

    const { pet } = installValidatedPetPack(manifest, generatedFiles)

    onProgress({
      stage: 'installing',
      message: 'Pet installed!',
      percent: 100,
    })

    return {
      ok: true,
      pet,
      validation,
      source: usedSource,
    }
  } catch (err) {
    const errorObj = err as Error & { code?: CreateCustomPetResult extends { ok: false; code?: infer C } ? C : string; details?: string[] }
    return {
      ok: false,
      code: (errorObj.code as 'MCP_SUBSCRIPTION_REQUIRED' | 'MCP_UNAVAILABLE' | 'VALIDATION_FAILED' | 'INVALID_INPUT' | 'IO_ERROR') || 'MCP_UNAVAILABLE',
      error: errorObj.message || 'Failed to generate custom pet pack.',
      details: errorObj.details,
    }
  }
}

/**
 * Normalize, validate, and install a custom pet pack from a local directory on disk
 * (e.g., downloaded AutoSprite sheets or local fixture folder).
 */
export function importPetPackFromDirectory(
  sourceDir: string,
  fallbackMeta?: { name?: string; species?: PetSpecies; breed?: string },
): CreateCustomPetResult {
  try {
    const resolvedDir = path.resolve(sourceDir)
    if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
      return { ok: false, code: 'IO_ERROR', error: 'Selected directory does not exist.' }
    }

    // Check if a manifest.json exists in the folder
    let name = fallbackMeta?.name?.trim() || path.basename(resolvedDir)
    let species: PetSpecies = fallbackMeta?.species || 'dog'
    let breed = fallbackMeta?.breed?.trim()
    let sourcePhotos: SourcePhotoMetadata[] = [{ name: 'imported_pack.png', mimeType: 'image/png' }]

    const manifestFile = path.join(resolvedDir, 'manifest.json')
    if (fs.existsSync(manifestFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
        if (typeof raw?.name === 'string' && raw.name.trim()) name = raw.name.trim().slice(0, 40)
        const validSpecies = PET_SPECIES_OPTIONS.map((s) => s.value)
        if (typeof raw?.species === 'string' && validSpecies.includes(raw.species)) {
          species = raw.species
        }
        if (typeof raw?.breed === 'string' && raw.breed.trim()) {
          breed = raw.breed.trim().slice(0, 40)
        }
        if (Array.isArray(raw?.sourcePhotos) && raw.sourcePhotos.length > 0) {
          sourcePhotos = raw.sourcePhotos
        }
      } catch {
        // Ignore malformed optional manifest and normalize from PNGs
      }
    }

    const dirFiles = fs.readdirSync(resolvedDir)
    const findSheetFile = (key: CustomAnimationKey): string | null => {
      const exact = dirFiles.find((f) => f.toLowerCase() === `${key}.png`)
      if (exact) return path.join(resolvedDir, exact)
      const partial = dirFiles.find((f) => f.toLowerCase().endsWith('.png') && f.toLowerCase().includes(key))
      if (partial) return path.join(resolvedDir, partial)
      return null
    }

    const idlePath = findSheetFile('idle')
    if (!idlePath) {
      return {
        ok: false,
        code: 'VALIDATION_FAILED',
        error: 'Directory does not contain an idle.png sprite sheet.',
      }
    }

    const normalizedFiles = {} as Record<CustomAnimationKey, Buffer>
    const allKeys: CustomAnimationKey[] = ['idle', 'walk', 'hurt', 'death', 'attack', 'evolution']

    for (const key of allKeys) {
      const filePath = findSheetFile(key) ?? idlePath
      const rawBuf = fs.readFileSync(filePath)
      const decoded = decodePng(rawBuf)
      const spec = NORMALIZED_ANIMATION_SPECS[key]

      // If the PNG already matches exact normalized geometry and passes validation, keep it;
      // otherwise normalize it to a 64x64 horizontal strip.
      const preCheck = validateSingleSpriteSheet(key, rawBuf, spec)
      if (preCheck.valid && filePath !== idlePath) {
        normalizedFiles[key] = rawBuf
      } else {
        normalizedFiles[key] = normalizeToHorizontalStrip(decoded, spec.frames, spec.tileWidth)
      }
    }

    const manifest: CustomPetManifest = {
      id: generatePetId(name),
      name,
      species,
      ...(breed ? { breed } : {}),
      createdAt: new Date().toISOString(),
      sourcePhotos,
      animations: {
        idle: { ...NORMALIZED_ANIMATION_SPECS.idle },
        walk: { ...NORMALIZED_ANIMATION_SPECS.walk },
        hurt: { ...NORMALIZED_ANIMATION_SPECS.hurt },
        death: { ...NORMALIZED_ANIMATION_SPECS.death },
        attack: { ...NORMALIZED_ANIMATION_SPECS.attack },
        evolution: { ...NORMALIZED_ANIMATION_SPECS.evolution },
      },
    }

    const validation = validateCompletePetPack(manifest, normalizedFiles)
    if (!validation.valid) {
      return {
        ok: false,
        code: 'VALIDATION_FAILED',
        error: `Imported sprite sheets failed validation: ${validation.errors[0]}`,
        details: validation.errors,
      }
    }

    const { pet } = installValidatedPetPack(manifest, normalizedFiles)
    return {
      ok: true,
      pet,
      validation,
      source: 'import',
    }
  } catch (err) {
    return {
      ok: false,
      code: 'IO_ERROR',
      error: err instanceof Error ? err.message : 'Failed to import pet pack directory.',
    }
  }
}
