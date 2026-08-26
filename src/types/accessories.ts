/**
 * Accessory and animation types for the baked sprite sheet system.
 *
 * Naming convention for sprite sheets:
 *   - Base animations:    `src/assets/pets/{AnimationState}.png`  (e.g., Idle.png, Hurt.png)
 *   - Accessorized:      `src/assets/pets/{AnimationState}_{AccessoryType}.png` (e.g., Idle_partyhat.png)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Accessory types
// ─────────────────────────────────────────────────────────────────────────────

/** All possible accessory types the pet can equip. 'none' = no accessory. */
export type AccessoryType = 'none' | 'crown' | 'partyhat' | 'wizardhat' | 'sunglasses' | 'bowtie'

/** Legacy alias for backwards compatibility with existing code. */
export type AccessoryId = AccessoryType

// ─────────────────────────────────────────────────────────────────────────────
// Animation state types
// ─────────────────────────────────────────────────────────────────────────────

/** All possible animation states for the pet sprite. */
export type AnimationState = 'Idle' | 'Walk' | 'Hurt' | 'Death'

// ─────────────────────────────────────────────────────────────────────────────
// Accessory metadata (for wardrobe / UI)
// ─────────────────────────────────────────────────────────────────────────────

export interface Accessory {
  id: AccessoryType
  name: string
  icon: string
  unlockedAtLevel: number
}

export const ACCESSORIES: readonly Accessory[] = [
  {
    id: 'sunglasses',
    name: 'Sunglasses',
    icon: '🕶️',
    unlockedAtLevel: 1,
  },
  {
    id: 'partyhat',
    name: 'Party Hat',
    icon: '🎉',
    unlockedAtLevel: 2,
  },
  {
    id: 'crown',
    name: 'Crown',
    icon: '👑',
    unlockedAtLevel: 3,
  },
  {
    id: 'wizardhat',
    name: 'Wizard Hat',
    icon: '🧙',
    unlockedAtLevel: 5,
  },
  {
    id: 'bowtie',
    name: 'Bow Tie',
    icon: '🎀',
    unlockedAtLevel: 1,
  },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the accessory metadata for a given id, or undefined if not found. */
export function getAccessory(id: AccessoryType): Accessory | undefined {
  return ACCESSORIES.find(a => a.id === id)
}

/** Returns true if the accessory is unlocked for the given pet level. */
export function isAccessoryUnlocked(id: AccessoryType, level: number): boolean {
  const accessory = getAccessory(id)
  return accessory ? level >= accessory.unlockedAtLevel : false
}

/** Returns the display name for an accessory. */
export function getAccessoryName(id: AccessoryType): string {
  return getAccessory(id)?.name ?? id
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprite path resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps an AccessoryType (e.g., 'partyhat') to the filename suffix
 * used in the sprite sheet naming convention.
 */
export const ACCESSORY_FILENAME_MAP: Record<AccessoryType, string> = {
  none: '',
  crown: 'crown',
  partyhat: 'partyhat',
  wizardhat: 'wizardhat',
  sunglasses: 'sunglasses',
  bowtie: 'bowtie',
} as const

/**
 * All valid animation states in display order.
 */
export const ANIMATION_STATES: AnimationState[] = ['Idle', 'Walk', 'Hurt', 'Death']

/**
 * Frame counts per animation. Used to set CSS `--frames` custom property.
 */
export const ANIMATION_FRAMES: Record<AnimationState, number> = {
  Idle: 4,
  Walk: 4,
  Hurt: 2,
  Death: 4,
} as const
