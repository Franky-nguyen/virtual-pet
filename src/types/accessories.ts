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
export type AnimationState = 'Idle' | 'Walk' | 'Hurt' | 'Death' | 'Attack' | 'Evolution'

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
    unlockedAtLevel: 2,
  },
  {
    id: 'partyhat',
    name: 'Party Hat',
    icon: '🎉',
    unlockedAtLevel: 4,
  },
  {
    id: 'crown',
    name: 'Crown',
    icon: '👑',
    unlockedAtLevel: 6,
  },
  {
    id: 'wizardhat',
    name: 'Wizard Hat',
    icon: '🧙',
    unlockedAtLevel: 8,
  },
  {
    id: 'bowtie',
    name: 'Bow Tie',
    icon: '🎀',
    unlockedAtLevel: 3,
  },
] as const

// ─────────────────────────────────────────────────────────────────────────────
// Lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the accessory metadata for a given id, or undefined if not found. */
export function getAccessory(id: AccessoryType): Accessory | undefined {
  return ACCESSORIES.find(a => a.id === id)
}

/** Returns true if the accessory is unlocked for the given pet level.
 *  Accessories unlock permanently once the pet reaches `accessory.unlockedAtLevel`:
 *   - Sunglasses: Level 2
 *   - Bow Tie: Level 3
 *   - Party Hat: Level 4
 *   - Crown: Level 6
 *   - Wizard Hat: Level 8
 */
export function isAccessoryUnlocked(id: AccessoryType, level: number, _isEvolved: boolean = false): boolean {
  if (id === 'none') return true
  const accessory = getAccessory(id)
  if (!accessory) return false
  return level >= accessory.unlockedAtLevel
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
export const ANIMATION_STATES: AnimationState[] = ['Idle', 'Walk', 'Hurt', 'Death', 'Attack', 'Evolution']

/**
 * Frame counts per animation (base dog sheets). Used to set CSS `--frames` custom property.
 * Note: Walk is special-cased in CSS (`.walk-sprite` renders its real 6 frames).
 */
export const ANIMATION_FRAMES: Record<AnimationState, number> = {
  Idle: 4,
  Walk: 4,
  Hurt: 2,
  Death: 4,
  Attack: 4,
  Evolution: 7,
} as const

/**
 * Frame counts per animation for the EVOLVED (Level 10) adult dog sheets in
 * `src/assets/pets/evolved/`.  All sheets (base AND accessorized) are uniform
 * 64×64px tiles on a 64px-high strip:
 *   - idle.png      384×64 → 6 frames
 *   - walk.png      512×64 → 8 frames
 *   - hurt.png      192×64 → 3 frames
 *   - attack.png    256×64 → 4 frames
 *   - death.png     384×64 → 6 frames
 *   - evolution.png 512×64 → 8 frames (plays all 8; 8th tile = settled pose)
 */
export const EVOLVED_ANIMATION_FRAMES: Record<AnimationState, number> = {
  Idle: 6,
  Walk: 8,
  Hurt: 3,
  Death: 6,
  Attack: 4,
  Evolution: 8,
} as const

/** Frame tile size in pixels for all EVOLVED adult dog sheets (64×64 px per tile). */
export const EVOLVED_TILE_PX = 64

// ─────────────────────────────────────────────────────────────────────────────
// Evolution (Level 10) configuration
// ─────────────────────────────────────────────────────────────────────────────

/** XP level at which the pet evolves into its permanent evolved form. */
export const EVOLUTION_LEVEL = 10

/** Milliseconds per sprite frame — must stay in sync with `.sprite-base` (0.15s). */
export const EVOLUTION_FRAME_MS = 150

/** Number of frames in the evolution animation (evolution.png = 8 frames). */
export const EVOLUTION_ANIMATION_FRAMES = EVOLVED_ANIMATION_FRAMES['Evolution']

/** Total duration of the one-time evolution animation (8 × 150ms = 1.2s).
 *  Must match `.evolution-sprite` in src/index.css. */
export const EVOLUTION_DURATION_MS = EVOLUTION_ANIMATION_FRAMES * EVOLUTION_FRAME_MS

/** Duration of the pre-evolution Pokémon-style blink flash (2.5s).
 *  Must match `.evolution-blink` in src/index.css. */
export const EVOLUTION_BLINK_MS = 2500
