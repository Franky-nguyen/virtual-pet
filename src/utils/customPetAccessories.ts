/**
 * Pixel-art accessory compositor for Custom Pets.
 *
 * Allows any custom pet (64×64 RGBA horizontal sprite strips) to equip all 5
 * Wardrobe accessories (`sunglasses`, `partyhat`, `crown`, `wizardhat`, `bowtie`)
 * across all animations (`idle`, `walk`, `hurt`, `death`, `attack`).
 *
 * For each frame in a custom pet's animation strip, we inspect the opaque pixel
 * silhouette to locate the head crown, eye line, and collar/neck anchor, then
 * stamp a crisp pixel-art accessory directly onto that frame.
 */

import type { AccessoryType } from '../types/accessories'
import type { CustomAnimationKey, RuntimeCustomPet } from '../types/customPet'

interface PixelPattern {
  width: number
  height: number
  /** Anchor mode relative to the detected pet silhouette in each frame. */
  anchor: 'hat' | 'eyes' | 'neck'
  /** Vertical offset in pixels from the anchor row. */
  offsetY: number
  /** Rows of character keys mapped by `palette` ('.' = transparent). */
  rows: readonly string[]
  palette: Readonly<Record<string, readonly [number, number, number, number]>>
}

const ACCESSORY_PATTERNS: Readonly<Record<Exclude<AccessoryType, 'none'>, PixelPattern>> = {
  crown: {
    width: 14,
    height: 9,
    anchor: 'hat',
    offsetY: -6,
    rows: [
      '.K....KK....K.',
      '.KY..KYYK..YK.',
      '.KYY.KYYK.YYK.',
      '.KYYYKKKKYYYK.',
      '.KYYYYYYYYYYK.',
      '.KYBYYRRYYGYK.',
      '.KYYYYYYYYYYK.',
      '.KDDDDDDDDDDK.',
      '.KKKKKKKKKKKK.',
    ],
    palette: {
      K: [74, 46, 0, 255],
      Y: [255, 215, 0, 255],
      D: [217, 155, 0, 255],
      R: [239, 68, 68, 255],
      B: [56, 189, 248, 255],
      G: [34, 197, 94, 255],
    },
  },
  partyhat: {
    width: 12,
    height: 12,
    anchor: 'hat',
    offsetY: -9,
    rows: [
      '....KKKK....',
      '...KYYYYK...',
      '....KKKK....',
      '....KPPK....',
      '...KPCCPK...',
      '...KPPPPK...',
      '..KPMMMMPK..',
      '..KPPPPPPK..',
      '.KPCCCCCCPK.',
      '.KPPPPPPPPK.',
      '.KMMMMMMMMK.',
      '.KKKKKKKKKK.',
    ],
    palette: {
      K: [45, 27, 78, 255],
      Y: [253, 224, 71, 255],
      P: [168, 85, 247, 255],
      M: [236, 72, 153, 255],
      C: [56, 189, 248, 255],
    },
  },
  wizardhat: {
    width: 18,
    height: 13,
    anchor: 'hat',
    offsetY: -9,
    rows: [
      '........KKK.......',
      '.......KBBBK......',
      '......KBBBBK......',
      '.....KBBBBBK......',
      '.....KBBYBBK......',
      '....KBBYYBBBK.....',
      '....KBBBBBBBK.....',
      '...KBBBBBYBBBK....',
      '...KBBBBBBBBBK....',
      '..KYYYYYYYYYYYK...',
      'KKKKKKKKKKKKKKKKKK',
      'KDDDDDDDDDDDDDDDDK',
      '.KKKKKKKKKKKKKKKK.',
    ],
    palette: {
      K: [23, 21, 59, 255],
      B: [67, 56, 202, 255],
      D: [49, 46, 129, 255],
      Y: [250, 204, 21, 255],
    },
  },
  sunglasses: {
    width: 16,
    height: 6,
    anchor: 'eyes',
    offsetY: -2,
    rows: [
      'KKKKKKKKKKKKKKKK',
      'KGGGGKKKKKKGGGGK',
      'KGLLLKK..KKGLLLK',
      'KLLLLK....KLLLLK',
      '.KKKK......KKKK.',
      '................',
    ],
    palette: {
      K: [17, 24, 39, 255],
      L: [30, 27, 75, 255],
      G: [147, 197, 253, 255],
    },
  },
  bowtie: {
    width: 12,
    height: 7,
    anchor: 'neck',
    offsetY: -3,
    rows: [
      'KKK......KKK',
      'KRRK.KK.KRRK',
      'KRHRKDDKRHRK',
      'KRRRRDDRRRRK',
      'KRRK.KK.KRRK',
      'KKK......KKK',
      '............',
    ],
    palette: {
      K: [127, 29, 29, 255],
      R: [239, 68, 68, 255],
      H: [252, 165, 165, 255],
      D: [185, 28, 28, 255],
    },
  },
}

interface FrameAnchors {
  headCenterX: number
  headTopY: number
  eyeCenterX: number
  eyeY: number
  neckCenterX: number
  neckY: number
}

/**
 * Inspect the opaque pixels of a single frame `[frameIndex * tileW .. (frameIndex + 1) * tileW)`
 * to locate the head crown, eye line, and collar/neck anchors.
 */
function detectFrameAnchors(
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  frameIndex: number,
  tileW: number,
  tileH: number,
): FrameAnchors {
  const startX = frameIndex * tileW
  let minX = tileW
  let maxX = -1
  let minY = tileH
  let maxY = -1

  const rowMinX = new Int16Array(tileH).fill(tileW)
  const rowMaxX = new Int16Array(tileH).fill(-1)
  const rowCount = new Int16Array(tileH).fill(0)

  for (let y = 0; y < tileH; y++) {
    for (let x = 0; x < tileW; x++) {
      const idx = (y * sheetWidth + (startX + x)) * 4
      if (rgba[idx + 3] >= 128) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        if (x < rowMinX[y]) rowMinX[y] = x
        if (x > rowMaxX[y]) rowMaxX[y] = x
        rowCount[y]++
      }
    }
  }

  // Fallback for an empty frame
  if (maxY < minY || maxX < minX) {
    const cx = Math.floor(tileW / 2)
    return {
      headCenterX: cx,
      headTopY: Math.floor(tileH * 0.25),
      eyeCenterX: cx,
      eyeY: Math.floor(tileH * 0.36),
      neckCenterX: cx,
      neckY: Math.floor(tileH * 0.52),
    }
  }

  const spriteW = maxX - minX + 1
  const spriteH = maxY - minY + 1

  // Find where the cranium widens below the ear tips
  let headTopY = minY
  const craniumThreshold = Math.max(8, Math.floor(spriteW * 0.42))
  const maxEarSearchY = Math.min(maxY, minY + Math.min(9, Math.floor(spriteH * 0.3)))
  for (let y = minY; y <= maxEarSearchY; y++) {
    const w = rowMaxX[y] >= rowMinX[y] ? rowMaxX[y] - rowMinX[y] + 1 : 0
    if (w >= craniumThreshold) {
      headTopY = y
      break
    }
  }

  // Average the horizontal midpoint across the upper head band
  let centerSum = 0
  let centerRows = 0
  const headBandEnd = Math.min(maxY, headTopY + Math.max(6, Math.floor(spriteH * 0.28)))
  for (let y = headTopY; y <= headBandEnd; y++) {
    if (rowMaxX[y] >= rowMinX[y]) {
      centerSum += (rowMinX[y] + rowMaxX[y]) / 2
      centerRows++
    }
  }
  const headCenterX = centerRows > 0 ? Math.round(centerSum / centerRows) : Math.round((minX + maxX) / 2)

  // Eye line is roughly 22% down the sprite from headTopY (clamped sensibly)
  const eyeY = Math.min(maxY - 4, headTopY + Math.max(5, Math.round(spriteH * 0.22)))
  const eyeCenterX =
    rowMaxX[eyeY] >= rowMinX[eyeY]
      ? Math.round((rowMinX[eyeY] + rowMaxX[eyeY]) / 2)
      : headCenterX

  // Neck / collar line is roughly 48% down the sprite from headTopY
  const neckY = Math.min(maxY - 3, headTopY + Math.max(10, Math.round(spriteH * 0.48)))
  const neckCenterX =
    rowMaxX[neckY] >= rowMinX[neckY]
      ? Math.round((rowMinX[neckY] + rowMaxX[neckY]) / 2)
      : headCenterX

  return {
    headCenterX,
    headTopY,
    eyeCenterX,
    eyeY,
    neckCenterX,
    neckY,
  }
}

/** Stamp a pixel-art accessory pattern onto a single frame of an RGBA buffer. */
function stampAccessoryOnFrame(
  rgba: Uint8ClampedArray,
  sheetWidth: number,
  frameIndex: number,
  tileW: number,
  tileH: number,
  pattern: PixelPattern,
  anchors: FrameAnchors,
): void {
  const frameStartX = frameIndex * tileW
  const centerX =
    pattern.anchor === 'hat'
      ? anchors.headCenterX
      : pattern.anchor === 'eyes'
        ? anchors.eyeCenterX
        : anchors.neckCenterX
  const baseY =
    pattern.anchor === 'hat'
      ? anchors.headTopY
      : pattern.anchor === 'eyes'
        ? anchors.eyeY
        : anchors.neckY

  const drawX = Math.max(0, Math.min(tileW - pattern.width, Math.round(centerX - pattern.width / 2)))
  const drawY = Math.max(0, Math.min(tileH - pattern.height, Math.round(baseY + pattern.offsetY)))

  for (let py = 0; py < pattern.height; py++) {
    const row = pattern.rows[py]
    if (!row) continue
    const ty = drawY + py
    if (ty < 0 || ty >= tileH) continue

    for (let px = 0; px < pattern.width; px++) {
      const ch = row[px]
      if (!ch || ch === '.') continue
      const color = pattern.palette[ch]
      if (!color) continue
      const tx = drawX + px
      if (tx < 0 || tx >= tileW) continue

      const idx = (ty * sheetWidth + (frameStartX + tx)) * 4
      rgba[idx] = color[0]
      rgba[idx + 1] = color[1]
      rgba[idx + 2] = color[2]
      rgba[idx + 3] = color[3]
    }
  }
}

// Module-level cache: key = `${petId}:${animKey}:${accessory}` -> composited data URL
const compositeCache = new Map<string, string>()
const pendingJobs = new Map<string, Promise<string>>()

/**
 * Generate a composited sprite sheet data URL for a custom pet animation and accessory.
 * Resolves from the in-memory cache immediately if already computed.
 */
export function getCachedCustomAccessoryUrl(
  petId: string,
  animKey: CustomAnimationKey,
  accessory: AccessoryType,
): string | null {
  if (accessory === 'none') return null
  return compositeCache.get(`${petId}:${animKey}:${accessory}`) ?? null
}

/**
 * Asynchronously composite `accessory` onto every frame of a custom pet's
 * animation strip and store the result in `compositeCache`.
 */
export function compositeCustomPetSheet(
  pet: RuntimeCustomPet,
  animKey: CustomAnimationKey,
  accessory: Exclude<AccessoryType, 'none'>,
): Promise<string> {
  const cacheKey = `${pet.manifest.id}:${animKey}:${accessory}`
  const cached = compositeCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)

  const inflight = pendingJobs.get(cacheKey)
  if (inflight) return inflight

  const baseDataUrl = pet.spriteUrls[animKey] ?? pet.spriteUrls.idle
  const spec = pet.manifest.animations[animKey] ?? pet.manifest.animations.idle
  const pattern = ACCESSORY_PATTERNS[accessory]

  const job = new Promise<string>((resolve) => {
    if (typeof document === 'undefined' || !baseDataUrl || !pattern) {
      resolve(baseDataUrl)
      return
    }

    const img = new Image()
    img.onload = () => {
      try {
        const frames = Math.max(1, spec.frames || 4)
        const tileW = spec.tileWidth || 64
        const tileH = spec.tileHeight || 64
        const width = img.naturalWidth || frames * tileW
        const height = img.naturalHeight || tileH

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(baseDataUrl)
          return
        }
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0)

        const imageData = ctx.getImageData(0, 0, width, height)
        for (let f = 0; f < frames; f++) {
          const anchors = detectFrameAnchors(imageData.data, width, f, tileW, tileH)
          stampAccessoryOnFrame(imageData.data, width, f, tileW, tileH, pattern, anchors)
        }
        ctx.putImageData(imageData, 0, 0)

        const outUrl = canvas.toDataURL('image/png')
        compositeCache.set(cacheKey, outUrl)
        resolve(outUrl)
      } catch {
        resolve(baseDataUrl)
      } finally {
        pendingJobs.delete(cacheKey)
      }
    }
    img.onerror = () => {
      pendingJobs.delete(cacheKey)
      resolve(baseDataUrl)
    }
    img.src = baseDataUrl
  })

  pendingJobs.set(cacheKey, job)
  return job
}

/**
 * Precompute accessorized sheets for all active animations of a custom pet
 * for a given accessory (or all 5 accessories).
 */
export async function ensureCustomPetAccessorySheets(
  pet: RuntimeCustomPet,
  accessory: AccessoryType,
): Promise<void> {
  if (accessory === 'none') return
  const keys: CustomAnimationKey[] = ['idle', 'walk', 'hurt', 'death', 'attack']
  await Promise.all(keys.map((k) => compositeCustomPetSheet(pet, k, accessory)))
}
