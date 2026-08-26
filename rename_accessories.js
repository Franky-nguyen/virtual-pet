/**
 * rename_accessories.js
 *
 * Renames accessory sprite sheet files to a standardized naming convention:
 *   [Animation]_[accessory].png
 *
 * Examples:
 *   - idle-crown.png            → Idle_crown.png
 *   - death-party hat.png       → Death_partyhat.png
 *   - hurt-wizard hat(not acurate).png → Hurt_wizardhat.png
 *
 * Accessory name mapping (compact, no underscores):
 *   - partyhat  (from "party hat", "party_hat", etc.)
 *   - wizardhat  (from "wizard hat", "wizard_hat", etc.)
 *   - bowtie     (from "bow tie", "bow_tie", etc.)
 *   - sunglasses (stays the same)
 *   - crown      (stays the same)
 */

import fs from 'node:fs'
import path from 'node:path'

const ACCESSORY_DIR = path.join(import.meta.dirname, 'accessory')

// Accessory name normalization: maps raw names → standardized names
const ACCESSORY_MAP = {
  'partyhat': 'partyhat',
  'party hat': 'partyhat',
  'party_hat': 'partyhat',
  'wizardhat': 'wizardhat',
  'wizard hat': 'wizardhat',
  'wizard_hat': 'wizardhat',
  'bowtie': 'bowtie',
  'bow tie': 'bowtie',
  'bow_tie': 'bowtie',
  'sunglasses': 'sunglasses',
  'crown': 'crown',
}

// Animation normalization: maps raw names → standardized names
const ANIMATION_MAP = {
  'idle': 'Idle',
  'walk': 'Walk',
  'hurt': 'Hurt',
  'death': 'Death',
}

/**
 * Normalize an accessory name by stripping spaces, underscores, parentheses,
 * notes, and converting to lowercase, then mapping to a standard name.
 */
function normalizeAccessoryName(raw) {
  // Strip parentheses and their contents
  let cleaned = raw.replace(/\([^)]*\)/g, '')
  // Strip spaces and underscores
  cleaned = cleaned.replace(/[\s_]+/g, '').toLowerCase()
  // Look up in map
  return ACCESSORY_MAP[cleaned] ?? cleaned
}

/**
 * Normalize an animation name.
 */
function normalizeAnimationName(raw) {
  return ANIMATION_MAP[raw.toLowerCase()] ?? raw
}

/**
 * Parse a filename to extract animation and accessory parts.
 * Assumes format: [animation]-[accessory].png or [animation]_[accessory].png
 */
function parseFilename(filename) {
  const base = filename.replace(/\.png$/i, '')
  const separatorMatch = base.match(/^(.+?)[-_](.+)$/)

  if (!separatorMatch) {
    // No separator found - this is a base animation (e.g., "Idle.png")
    return { animation: null, accessory: null, isBaseAnimation: true }
  }

  const [, rawAnimation, rawAccessory] = separatorMatch

  return {
    animation: normalizeAnimationName(rawAnimation),
    accessory: normalizeAccessoryName(rawAccessory),
    isBaseAnimation: false,
  }
}

/**
 * Build the new filename from parsed parts.
 */
function buildNewFilename(animation, accessory) {
  return `${animation}_${accessory}.png`
}

// Verify directory exists
if (!fs.existsSync(ACCESSORY_DIR)) {
  console.error(`Error: Directory not found: ${ACCESSORY_DIR}`)
  process.exit(1)
}

// Read all files in the accessory directory
const files = fs.readdirSync(ACCESSORY_DIR)
const pngFiles = files.filter(f => /\.png$/i.test(f))

console.log('=== Accessory Sprite Renaming Script ===\n')
console.log(`Found ${pngFiles.length} PNG files in ${ACCESSORY_DIR}\n`)

const renames = []
const errors = []

for (const filename of pngFiles) {
  const parsed = parseFilename(filename)

  if (parsed.isBaseAnimation) {
    console.log(`  ⏭️  Skipping base animation: ${filename}`)
    continue
  }

  if (!parsed.animation || !parsed.accessory) {
    errors.push({ old: filename, reason: 'Could not parse animation or accessory name' })
    continue
  }

  const newFilename = buildNewFilename(parsed.animation, parsed.accessory)
  const oldPath = path.join(ACCESSORY_DIR, filename)
  const newPath = path.join(ACCESSORY_DIR, newFilename)

  // Check if file already exists with the target name
  if (fs.existsSync(newPath)) {
    console.log(`  ⚠️  Already exists: ${filename} → ${newFilename} (skipping)`)
    continue
  }

  // Check if it's actually a rename (different name)
  if (filename === newFilename) {
    console.log(`  ✓  Already correctly named: ${filename}`)
    continue
  }

  renames.push({ old: filename, new: newFilename, oldPath, newPath })
}

// Perform renames
console.log('\n--- Planned Renames ---\n')
if (renames.length === 0) {
  console.log('  No files need to be renamed.')
} else {
  for (const { old, new: newName } of renames) {
    console.log(`  ${old.padEnd(45)} → ${newName}`)
  }

  console.log(`\n--- Executing ${renames.length} rename(s)... ---\n`)

  for (const { oldPath, newPath, old, new: newName } of renames) {
    try {
      fs.renameSync(oldPath, newPath)
      console.log(`  ✅ ${old} → ${newName}`)
    } catch (err) {
      errors.push({ old, reason: err.message })
      console.error(`  ❌ Failed to rename ${old}: ${err.message}`)
    }
  }
}

// Report errors
if (errors.length > 0) {
  console.log('\n--- Errors ---\n')
  for (const { old, reason } of errors) {
    console.error(`  ❌ ${old}: ${reason}`)
  }
}

console.log('\n=== Done ===')
console.log(`Renamed: ${renames.length}, Errors: ${errors.length}`)
