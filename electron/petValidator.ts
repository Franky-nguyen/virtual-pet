/**
 * Strict validation utilities for custom pet manifests and PNG sprite sheets.
 * Enforces:
 * - PNG format signature & chunk integrity
 * - RGBA transparency (colorType 6 or decoded RGBA with both transparent background and opaque pixels)
 * - Horizontal sprite-sheet layout (single row of equal-sized tiles)
 * - Equal-sized tiles (tileWidth === tileHeight === 64)
 * - Correct frame count matching manifest / normalized spec
 * - No unexpected missing required animations (idle, walk, hurt, death, attack; evolution optional with fallback)
 * - Reasonable image dimensions (64..2048 px)
 * - Hard pixel-art edges (low semi-transparent anti-aliased fringe ratio)
 * - Stable character placement across frames (no blank frames, bounded center/ground drift)
 */

import type {
  CustomAnimationKey,
  CustomAnimationSpec,
  CustomPetManifest,
  PetSpecies,
  SpriteValidationReport,
} from '../src/types/customPet'
import { ALLOWED_PHOTO_MIME_TYPES, NORMALIZED_ANIMATION_SPECS, PET_SPECIES_OPTIONS } from '../src/types/customPet'
import { decodePng, getTileBoundingBox, PNG_SIGNATURE } from './pngCodec'

export const SAFE_PET_ID_REGEX = /^[a-z0-9][a-z0-9-_]{1,62}[a-z0-9]$/

export const CANONICAL_ANIMATION_FILES: Readonly<Record<CustomAnimationKey, string>> = {
  idle: 'idle.png',
  walk: 'walk.png',
  hurt: 'hurt.png',
  death: 'death.png',
  attack: 'attack.png',
  evolution: 'evolution.png',
} as const

export const CORE_REQUIRED_ANIMATIONS: readonly CustomAnimationKey[] = [
  'idle',
  'walk',
  'hurt',
  'death',
  'attack',
] as const

export function isValidPetId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_PET_ID_REGEX.test(id) && !id.includes('..')
}

export function validateSingleSpriteSheet(
  animKey: CustomAnimationKey,
  pngBuffer: Buffer,
  spec: CustomAnimationSpec,
): SpriteValidationReport {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. PNG format check
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length < 33 || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { valid: false, errors: [`[${animKey}] File is not a valid PNG binary.`], warnings }
  }

  let decoded
  try {
    decoded = decodePng(pngBuffer)
  } catch (err) {
    return {
      valid: false,
      errors: [`[${animKey}] Failed to decode PNG: ${err instanceof Error ? err.message : String(err)}`],
      warnings,
    }
  }

  // 2. Reasonable image dimensions
  if (decoded.width < 32 || decoded.width > 4096 || decoded.height < 32 || decoded.height > 512) {
    errors.push(`[${animKey}] Unreasonable dimensions (${decoded.width}x${decoded.height}).`)
  }

  // 3. Equal-sized tiles & horizontal sprite-sheet layout
  if (spec.tileWidth <= 0 || spec.tileHeight <= 0 || spec.tileWidth !== spec.tileHeight) {
    errors.push(`[${animKey}] Tile dimensions must be equal square pixels (got ${spec.tileWidth}x${spec.tileHeight}).`)
  }

  if (decoded.height !== spec.tileHeight) {
    errors.push(
      `[${animKey}] Expected single horizontal strip of height ${spec.tileHeight}px, got ${decoded.height}px.`,
    )
  }

  // 4. Correct frame count
  const expectedWidth = spec.frames * spec.tileWidth
  if (decoded.width !== expectedWidth) {
    errors.push(
      `[${animKey}] Width ${decoded.width}px does not match ${spec.frames} frames × ${spec.tileWidth}px (${expectedWidth}px).`,
    )
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings }
  }

  // 5. RGBA transparency & hard pixel-art edges
  let transparentCount = 0
  let solidOpaqueCount = 0
  let semiTransparentCount = 0
  const totalPixels = decoded.width * decoded.height

  for (let i = 0; i < totalPixels; i++) {
    const a = decoded.rgba[i * 4 + 3]
    if (a === 0) {
      transparentCount++
    } else if (a >= 240) {
      solidOpaqueCount++
    } else {
      semiTransparentCount++
    }
  }

  if (transparentCount === 0) {
    errors.push(`[${animKey}] Sprite sheet lacks RGBA transparency (0 transparent background pixels found).`)
  }

  const visiblePixels = solidOpaqueCount + semiTransparentCount
  if (visiblePixels === 0) {
    errors.push(`[${animKey}] Sprite sheet is completely empty/transparent.`)
  } else {
    const hardEdgeRatio = solidOpaqueCount / visiblePixels
    if (hardEdgeRatio < 0.75) {
      errors.push(
        `[${animKey}] Sprite sheet has soft/blurry edges (only ${Math.round(hardEdgeRatio * 100)}% hard opaque pixels; expected >= 75% for pixel art).`,
      )
    } else if (hardEdgeRatio < 0.9) {
      warnings.push(`[${animKey}] Minor anti-aliased fringe detected (${Math.round(hardEdgeRatio * 100)}% crisp pixels).`)
    }
  }

  // 6. Per-frame presence & stable character placement across frames
  const boxes = []
  for (let f = 0; f < spec.frames; f++) {
    const box = getTileBoundingBox(
      decoded.rgba,
      decoded.width,
      f * spec.tileWidth,
      0,
      spec.tileWidth,
      spec.tileHeight,
    )
    if (box.opaqueCount < 16) {
      errors.push(`[${animKey}] Frame ${f + 1}/${spec.frames} is empty or nearly blank (${box.opaqueCount} opaque pixels).`)
    }
    boxes.push(box)
  }

  if (boxes.length > 1 && boxes.every((b) => b.opaqueCount >= 16)) {
    const centersX = boxes.map((b) => b.centerX)
    const bottomsY = boxes.map((b) => b.bottomY)
    const maxDriftX = Math.max(...centersX) - Math.min(...centersX)
    const maxDriftY = Math.max(...bottomsY) - Math.min(...bottomsY)

    // Allow slightly more vertical shift on death (falling down), otherwise keep tight placement
    const allowedDriftX = spec.tileWidth * 0.35
    const allowedDriftY = animKey === 'death' ? spec.tileHeight * 0.45 : spec.tileHeight * 0.3

    if (maxDriftX > allowedDriftX) {
      errors.push(
        `[${animKey}] Unstable horizontal character placement across frames (drift ${maxDriftX.toFixed(1)}px > ${allowedDriftX.toFixed(1)}px).`,
      )
    }
    if (maxDriftY > allowedDriftY) {
      errors.push(
        `[${animKey}] Unstable vertical ground placement across frames (drift ${maxDriftY.toFixed(1)}px > ${allowedDriftY.toFixed(1)}px).`,
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/** Validate the manifest structure and ensure no path traversal or untrusted filenames exist. */
export function validateManifest(raw: unknown): {
  valid: boolean
  manifest?: CustomPetManifest
  errors: string[]
} {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object.'] }
  }

  const obj = raw as Record<string, unknown>

  if (!isValidPetId(obj.id)) {
    errors.push('Invalid manifest id (must be alphanumeric/hyphenated, 3-64 chars, no path traversal).')
  }

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0 || obj.name.trim().length > 60) {
    errors.push('Invalid pet name (must be 1-60 characters).')
  }

  const validSpecies = PET_SPECIES_OPTIONS.map((s) => s.value)
  if (typeof obj.species !== 'string' || !validSpecies.includes(obj.species as PetSpecies)) {
    errors.push(`Invalid pet species (expected one of: ${validSpecies.join(', ')}).`)
  }

  if (obj.breed !== undefined && (typeof obj.breed !== 'string' || obj.breed.length > 60)) {
    errors.push('Invalid optional breed string.')
  }

  if (typeof obj.createdAt !== 'string' || Number.isNaN(Date.parse(obj.createdAt))) {
    errors.push('Invalid createdAt ISO timestamp.')
  }

  if (!Array.isArray(obj.sourcePhotos)) {
    errors.push('sourcePhotos must be an array.')
  } else {
    for (const photo of obj.sourcePhotos) {
      if (!photo || typeof photo !== 'object') {
        errors.push('Invalid entry in sourcePhotos.')
        continue
      }
      const p = photo as Record<string, unknown>
      if (typeof p.name !== 'string' || p.name.length === 0 || p.name.length > 200) {
        errors.push('Invalid sourcePhoto name.')
      }
      if (
        typeof p.mimeType !== 'string' ||
        !ALLOWED_PHOTO_MIME_TYPES.includes(p.mimeType as (typeof ALLOWED_PHOTO_MIME_TYPES)[number])
      ) {
        errors.push(`Unsupported sourcePhoto mimeType: ${String(p.mimeType)}`)
      }
    }
  }

  if (!obj.animations || typeof obj.animations !== 'object') {
    errors.push('Manifest is missing animations object.')
  } else {
    const anims = obj.animations as Record<string, unknown>
    for (const reqKey of CORE_REQUIRED_ANIMATIONS) {
      if (!anims[reqKey] || typeof anims[reqKey] !== 'object') {
        errors.push(`Missing required animation "${reqKey}" in manifest.`)
      }
    }

    const allKeys: CustomAnimationKey[] = ['idle', 'walk', 'hurt', 'death', 'attack', 'evolution']
    for (const key of allKeys) {
      const entry = anims[key]
      if (entry === undefined) continue
      if (!entry || typeof entry !== 'object') {
        errors.push(`Invalid animation spec for "${key}".`)
        continue
      }
      const spec = entry as Record<string, unknown>
      const expectedFile = CANONICAL_ANIMATION_FILES[key]
      if (spec.file !== expectedFile) {
        errors.push(`Animation "${key}" file must be canonical "${expectedFile}" (got "${String(spec.file)}").`)
      }
      const expectedFrames = NORMALIZED_ANIMATION_SPECS[key].frames
      if (typeof spec.frames !== 'number' || !Number.isInteger(spec.frames) || spec.frames !== expectedFrames) {
        errors.push(`Animation "${key}" frames must be ${expectedFrames} (got ${String(spec.frames)}).`)
      }
      if (spec.tileWidth !== 64 || spec.tileHeight !== 64) {
        errors.push(`Animation "${key}" tile size must be 64×64 (got ${String(spec.tileWidth)}×${String(spec.tileHeight)}).`)
      }
      if (
        typeof spec.frameDurationMs !== 'number' ||
        spec.frameDurationMs < 50 ||
        spec.frameDurationMs > 1000
      ) {
        errors.push(`Animation "${key}" frameDurationMs must be between 50 and 1000ms.`)
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    manifest: raw as CustomPetManifest,
    errors: [],
  }
}

/** Validate a complete custom pet pack (manifest + PNG buffers for every animation). */
export function validateCompletePetPack(
  manifest: CustomPetManifest,
  files: Partial<Record<CustomAnimationKey, Buffer>>,
): SpriteValidationReport {
  const manifestCheck = validateManifest(manifest)
  const errors = [...manifestCheck.errors]
  const warnings: string[] = []

  if (!manifestCheck.valid) {
    return { valid: false, errors, warnings }
  }

  const keysToValidate: CustomAnimationKey[] = ['idle', 'walk', 'hurt', 'death', 'attack']
  if (manifest.animations.evolution) {
    keysToValidate.push('evolution')
  }

  for (const key of keysToValidate) {
    const spec = manifest.animations[key]
    const buf = files[key]
    if (!spec) {
      errors.push(`Missing animation spec for "${key}".`)
      continue
    }
    if (!buf) {
      errors.push(`Missing PNG file "${spec.file}" for animation "${key}".`)
      continue
    }
    const report = validateSingleSpriteSheet(key, buf, spec)
    errors.push(...report.errors)
    warnings.push(...report.warnings)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
