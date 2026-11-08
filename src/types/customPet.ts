/**
 * Types and constants for the manifest-driven Custom Pet system.
 */

import type { AnimationState } from './accessories'

/** ID reserved for the original built-in dog pet. */
export const BUILTIN_PET_ID = 'builtin'
export const BUILTIN_DOG_ID = BUILTIN_PET_ID

/** ID reserved for the built-in Pixel Cat pet. */
export const BUILTIN_CAT_ID = 'builtin-cat'

/** Built-in pet model identifiers. */
export type BuiltinPetModel = 'dog' | 'cat'

/** Returns the built-in model ('dog' | 'cat') if `petId` is a built-in pet, or null for custom pets. */
export function isBuiltinPetId(petId: string): boolean {
  return petId === BUILTIN_DOG_ID || petId === BUILTIN_CAT_ID
}

export function getBuiltinPetModel(petId: string): BuiltinPetModel | null {
  if (petId === BUILTIN_DOG_ID) return 'dog'
  if (petId === BUILTIN_CAT_ID) return 'cat'
  return null
}

/** Supported animation keys in a custom pet manifest. */
export type CustomAnimationKey = 'idle' | 'walk' | 'hurt' | 'death' | 'attack' | 'evolution'

/** Supported pet species in the Create Your Own Pet workflow. */
export type PetSpecies = 'dog' | 'cat' | 'rabbit' | 'hamster' | 'bird' | 'fox' | 'other'

export const PET_SPECIES_OPTIONS: readonly { value: PetSpecies; label: string; emoji: string }[] = [
  { value: 'dog',     label: 'Dog',     emoji: '🐶' },
  { value: 'cat',     label: 'Cat',     emoji: '🐱' },
  { value: 'rabbit',  label: 'Rabbit',  emoji: '🐰' },
  { value: 'hamster', label: 'Hamster', emoji: '🐹' },
  { value: 'bird',    label: 'Bird',    emoji: '🐦' },
  { value: 'fox',     label: 'Fox',     emoji: '🦊' },
  { value: 'other',   label: 'Other',   emoji: '🐾' },
] as const

/** Allowed source photo MIME types. */
export type AllowedPhotoMimeType = 'image/jpeg' | 'image/png' | 'image/webp'

export const ALLOWED_PHOTO_MIME_TYPES: readonly AllowedPhotoMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

/** Metadata for a single animation strip inside a custom pet pack. */
export interface CustomAnimationSpec {
  file: string
  frames: number
  tileWidth: number
  tileHeight: number
  frameDurationMs: number
}

/** Source photo metadata recorded in the manifest (original photo bytes are not retained). */
export interface SourcePhotoMetadata {
  name: string
  mimeType: AllowedPhotoMimeType
}

/** Normalized on-disk manifest for an installed custom pet pack. */
export interface CustomPetManifest {
  id: string
  name: string
  species: PetSpecies
  breed?: string
  createdAt: string
  sourcePhotos: SourcePhotoMetadata[]
  animations: {
    idle: CustomAnimationSpec
    walk: CustomAnimationSpec
    hurt: CustomAnimationSpec
    death: CustomAnimationSpec
    attack: CustomAnimationSpec
    evolution?: CustomAnimationSpec
  }
}

/** Runtime custom pet loaded by the Electron main process with validated data URLs. */
export interface RuntimeCustomPet {
  manifest: CustomPetManifest
  /** Safe data URLs (`data:image/png;base64,...`) keyed by animation name. */
  spriteUrls: {
    idle: string
    walk: string
    hurt: string
    death: string
    attack: string
    evolution?: string
  }
}

/** Canonical normalized animation defaults for PosturePet custom pets. */
export const NORMALIZED_ANIMATION_SPECS: Readonly<Record<CustomAnimationKey, CustomAnimationSpec>> = {
  idle: {
    file: 'idle.png',
    frames: 4,
    tileWidth: 64,
    tileHeight: 64,
    frameDurationMs: 150,
  },
  walk: {
    file: 'walk.png',
    frames: 6,
    tileWidth: 64,
    tileHeight: 64,
    frameDurationMs: 150,
  },
  hurt: {
    file: 'hurt.png',
    frames: 2,
    tileWidth: 64,
    tileHeight: 64,
    frameDurationMs: 150,
  },
  death: {
    file: 'death.png',
    frames: 3,
    tileWidth: 64,
    tileHeight: 64,
    frameDurationMs: 150,
  },
  attack: {
    file: 'attack.png',
    frames: 4,
    tileWidth: 64,
    tileHeight: 64,
    frameDurationMs: 150,
  },
  evolution: {
    file: 'evolution.png',
    frames: 8,
    tileWidth: 64,
    tileHeight: 64,
    frameDurationMs: 150,
  },
} as const

/** Map PetDisplay's PascalCase AnimationState to manifest lowercase key. */
export const ANIMATION_STATE_TO_CUSTOM_KEY: Readonly<Record<AnimationState, CustomAnimationKey>> = {
  Idle: 'idle',
  Walk: 'walk',
  Hurt: 'hurt',
  Death: 'death',
  Attack: 'attack',
  Evolution: 'evolution',
} as const

/** Required AutoSprite prompt template for consistent 2D pixel-art pet sprite generation. */
export const AUTOSPRITE_PET_PROMPT =
  'Create a consistent 2D pixel-art sprite pack from the supplied pet reference photos. Preserve the pet’s species, body shape, face, fur colors, markings, ears, tail, eye color, and distinctive accessories. Use a transparent background, crisp nearest-neighbor pixel edges, and a consistent camera angle, scale, ground position, and silhouette across every frame. Produce separate horizontal sprite sheets for idle, walk, hurt, death, attack, and evolution. Each frame must use the same tile size and alignment. Do not add text, borders, scenery, shadows, or unrelated objects. The pet must remain recognizable as the same individual in every animation.'

/** Progress stages shown during pet creation/import. */
export type PetCreationStage =
  | 'preparing'
  | 'sending'
  | 'generating'
  | 'validating'
  | 'installing'

export const PET_CREATION_STAGES: readonly { id: PetCreationStage; label: string }[] = [
  { id: 'preparing',  label: 'Preparing photos' },
  { id: 'sending',    label: 'Sending to AutoSprite' },
  { id: 'generating', label: 'Generating sprite sheets' },
  { id: 'validating', label: 'Validating assets' },
  { id: 'installing', label: 'Installing pet' },
] as const

export interface PetCreationProgress {
  stage: PetCreationStage
  message: string
  percent: number
}

/** Uploaded photo payload passed from the renderer to the main process during generation. */
export interface UploadedPetPhoto {
  name: string
  mimeType: AllowedPhotoMimeType
  dataUrl: string
}

/** Generation request sent via IPC to the Electron main process. */
export interface CreateCustomPetRequest {
  name: string
  species: PetSpecies
  breed?: string
  photos: UploadedPetPhoto[]
  /**
   * Pipeline mode:
   * - 'autosprite': Call the configured AutoSprite MCP server (default).
   * - 'local-synth': Synthesize a pixel-art pack from the reference photos locally (development/offline fallback).
   * - 'fixture': Install from local fixture assets.
   */
  pipeline?: 'autosprite' | 'local-synth' | 'fixture'
}

export interface SpriteValidationReport {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export type CreateCustomPetResult =
  | {
      ok: true
      pet: RuntimeCustomPet
      validation: SpriteValidationReport
      source: 'autosprite' | 'local-synth' | 'fixture' | 'import'
    }
  | {
      ok: false
      error: string
      code?: 'MCP_SUBSCRIPTION_REQUIRED' | 'MCP_UNAVAILABLE' | 'VALIDATION_FAILED' | 'INVALID_INPUT' | 'IO_ERROR'
      details?: string[]
    }
