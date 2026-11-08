/**
 * Pure Node.js PNG decoder, encoder, normalizer, and pixel-art sprite synthesizer.
 * Uses only built-in `node:zlib` so no native C++ image binaries are required.
 */

import zlib from 'node:zlib'
import type { CustomAnimationKey, PetSpecies } from '../src/types/customPet'
import { NORMALIZED_ANIMATION_SPECS } from '../src/types/customPet'

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface DecodedPng {
  width: number
  height: number
  bitDepth: number
  colorType: number
  /** Raw 8-bit RGBA pixels (length = width * height * 4). */
  rgba: Uint8Array
}

// ── CRC32 Table for PNG chunk encoding ──────────────────────────────────────
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  CRC_TABLE[n] = c >>> 0
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/**
 * Decode a PNG buffer into raw 8-bit RGBA pixels.
 * Supports colorType 6 (RGBA), 2 (RGB), 3 (Indexed PLTE + tRNS), 4 (Grayscale+Alpha), 0 (Grayscale).
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature')
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idatChunks: Buffer[] = []
  let seenIhdr = false
  let seenIend = false

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buf.length) {
      throw new Error(`Truncated PNG chunk: ${type}`)
    }
    const chunkData = buf.subarray(dataStart, dataEnd)

    if (type === 'IHDR') {
      if (length < 13) throw new Error('Invalid IHDR chunk length')
      width = chunkData.readUInt32BE(0)
      height = chunkData.readUInt32BE(4)
      bitDepth = chunkData.readUInt8(8)
      colorType = chunkData.readUInt8(9)
      const compression = chunkData.readUInt8(10)
      const filter = chunkData.readUInt8(11)
      interlace = chunkData.readUInt8(12)
      if (compression !== 0 || filter !== 0) {
        throw new Error('Unsupported PNG compression or filter method')
      }
      if (interlace !== 0) {
        throw new Error('Interlaced PNGs are not supported; normalize to non-interlaced PNG')
      }
      seenIhdr = true
    } else if (type === 'PLTE') {
      palette = Buffer.from(chunkData)
    } else if (type === 'tRNS') {
      trns = Buffer.from(chunkData)
    } else if (type === 'IDAT') {
      idatChunks.push(chunkData)
    } else if (type === 'IEND') {
      seenIend = true
      break
    }

    offset = dataEnd + 4
  }

  if (!seenIhdr || !seenIend || width <= 0 || height <= 0 || idatChunks.length === 0) {
    throw new Error('Incomplete PNG structure (missing IHDR, IDAT, or IEND)')
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth: ${bitDepth} (expected 8-bit)`)
  }

  const channels =
    colorType === 6 ? 4 :
    colorType === 2 ? 3 :
    colorType === 4 ? 2 :
    colorType === 0 || colorType === 3 ? 1 : 0

  if (channels === 0) {
    throw new Error(`Unsupported PNG color type: ${colorType}`)
  }

  const compressed = Buffer.concat(idatChunks)
  const inflated = zlib.inflateSync(compressed)
  const stride = width * channels
  const expectedLength = height * (1 + stride)
  if (inflated.length < expectedLength) {
    throw new Error(`Decompressed PNG data too short (${inflated.length} < ${expectedLength})`)
  }

  const rawScanlines = new Uint8Array(width * height * channels)

  for (let y = 0; y < height; y++) {
    const filterType = inflated[y * (1 + stride)]
    const rowInOffset = y * (1 + stride) + 1
    const rowOutOffset = y * stride
    const prevRowOutOffset = (y - 1) * stride

    for (let x = 0; x < stride; x++) {
      const rawByte = inflated[rowInOffset + x]
      const a = x >= channels ? rawScanlines[rowOutOffset + x - channels] : 0
      const b = y > 0 ? rawScanlines[prevRowOutOffset + x] : 0
      const c = (x >= channels && y > 0) ? rawScanlines[prevRowOutOffset + x - channels] : 0

      let recon = rawByte
      if (filterType === 1) {
        recon = (rawByte + a) & 0xff
      } else if (filterType === 2) {
        recon = (rawByte + b) & 0xff
      } else if (filterType === 3) {
        recon = (rawByte + ((a + b) >> 1)) & 0xff
      } else if (filterType === 4) {
        recon = (rawByte + paethPredictor(a, b, c)) & 0xff
      } else if (filterType !== 0) {
        throw new Error(`Invalid PNG scanline filter type: ${filterType}`)
      }
      rawScanlines[rowOutOffset + x] = recon
    }
  }

  const rgba = new Uint8Array(width * height * 4)

  if (colorType === 6) {
    rgba.set(rawScanlines)
  } else if (colorType === 2) {
    const trnsR = trns && trns.length >= 6 ? trns.readUInt16BE(0) & 0xff : -1
    const trnsG = trns && trns.length >= 6 ? trns.readUInt16BE(2) & 0xff : -1
    const trnsB = trns && trns.length >= 6 ? trns.readUInt16BE(4) & 0xff : -1
    for (let i = 0; i < width * height; i++) {
      const r = rawScanlines[i * 3]
      const g = rawScanlines[i * 3 + 1]
      const b = rawScanlines[i * 3 + 2]
      rgba[i * 4] = r
      rgba[i * 4 + 1] = g
      rgba[i * 4 + 2] = b
      rgba[i * 4 + 3] = (r === trnsR && g === trnsG && b === trnsB) ? 0 : 255
    }
  } else if (colorType === 3) {
    if (!palette) throw new Error('Indexed PNG (colorType 3) missing PLTE chunk')
    for (let i = 0; i < width * height; i++) {
      const idx = rawScanlines[i]
      const pOffset = idx * 3
      rgba[i * 4] = pOffset < palette.length ? palette[pOffset] : 0
      rgba[i * 4 + 1] = pOffset + 1 < palette.length ? palette[pOffset + 1] : 0
      rgba[i * 4 + 2] = pOffset + 2 < palette.length ? palette[pOffset + 2] : 0
      rgba[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255
    }
  } else if (colorType === 4) {
    for (let i = 0; i < width * height; i++) {
      const v = rawScanlines[i * 2]
      const a = rawScanlines[i * 2 + 1]
      rgba[i * 4] = v
      rgba[i * 4 + 1] = v
      rgba[i * 4 + 2] = v
      rgba[i * 4 + 3] = a
    }
  } else if (colorType === 0) {
    for (let i = 0; i < width * height; i++) {
      const v = rawScanlines[i]
      rgba[i * 4] = v
      rgba[i * 4 + 1] = v
      rgba[i * 4 + 2] = v
      rgba[i * 4 + 3] = 255
    }
  }

  return { width, height, bitDepth, colorType, rgba }
}

function makeChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

/**
 * Encode raw 8-bit RGBA pixels into a standard RGBA PNG buffer (colorType = 6, bitDepth = 8).
 */
export function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`Invalid RGBA buffer length: expected ${width * height * 4}, got ${rgba.length}`)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.writeUInt8(8, 8)  // bitDepth = 8
  ihdr.writeUInt8(6, 9)  // colorType = 6 (RGBA)
  ihdr.writeUInt8(0, 10) // compression = 0
  ihdr.writeUInt8(0, 11) // filter = 0
  ihdr.writeUInt8(0, 12) // interlace = 0

  const stride = width * 4
  const rawData = Buffer.alloc(height * (1 + stride))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride)
    rawData[rowStart] = 0 // Filter type 0 (None)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(rawData, rowStart + 1)
  }

  const compressed = zlib.deflateSync(rawData, { level: 6 })

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ])
}

export interface FrameRect {
  x: number
  y: number
  w: number
  h: number
}

export interface BoundingBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
  opaqueCount: number
  centerX: number
  bottomY: number
}

/** Compute opaque bounding box and anchor statistics for a single tile inside an RGBA buffer. */
export function getTileBoundingBox(
  rgba: Uint8Array,
  sheetWidth: number,
  tileX: number,
  tileY: number,
  tileW: number,
  tileH: number,
): BoundingBox {
  let minX = tileW
  let minY = tileH
  let maxX = -1
  let maxY = -1
  let opaqueCount = 0
  let sumX = 0

  for (let y = 0; y < tileH; y++) {
    for (let x = 0; x < tileW; x++) {
      const idx = ((tileY + y) * sheetWidth + (tileX + x)) * 4
      const a = rgba[idx + 3]
      if (a >= 128) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        opaqueCount++
        sumX += x
      }
    }
  }

  if (opaqueCount === 0) {
    return { minX: 0, minY: 0, maxX: -1, maxY: -1, opaqueCount: 0, centerX: tileW / 2, bottomY: tileH - 1 }
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    opaqueCount,
    centerX: sumX / opaqueCount,
    bottomY: maxY,
  }
}

/**
 * Normalize any decoded sprite sheet (grid, strip, or custom resolution) into
 * PosturePet's canonical horizontal RGBA PNG strip:
 * - Single horizontal row of `targetFrames` equal-sized tiles (`tileSize × tileSize`, default 64×64)
 * - Nearest-neighbor scaling to preserve crisp pixel edges
 * - Alpha thresholding (hard pixel-art edges, no soft anti-aliased fringe)
 * - Background key removal if source image had an opaque solid corner background
 * - Consistent horizontal center and ground-line alignment across frames
 */
export function normalizeToHorizontalStrip(
  source: DecodedPng,
  targetFrames: number,
  tileSize: number = 64,
  atlasFrames?: FrameRect[],
): Buffer {
  const srcRgba = new Uint8Array(source.rgba)

  // Check if the image lacks transparency (e.g. solid background from a raw image)
  // and key out the top-left corner background color if needed.
  let transparentPixels = 0
  for (let i = 3; i < srcRgba.length; i += 4) {
    if (srcRgba[i] < 128) transparentPixels++
  }
  if (transparentPixels === 0 && srcRgba.length >= 4) {
    const bgR = srcRgba[0]
    const bgG = srcRgba[1]
    const bgB = srcRgba[2]
    for (let i = 0; i < srcRgba.length; i += 4) {
      const dr = Math.abs(srcRgba[i] - bgR)
      const dg = Math.abs(srcRgba[i + 1] - bgG)
      const db = Math.abs(srcRgba[i + 2] - bgB)
      if (dr + dg + db < 24) {
        srcRgba[i] = 0
        srcRgba[i + 1] = 0
        srcRgba[i + 2] = 0
        srcRgba[i + 3] = 0
      }
    }
  }

  // Determine source frame rectangles
  let rects: FrameRect[] = []
  if (atlasFrames && atlasFrames.length > 0) {
    rects = atlasFrames
  } else if (source.width >= source.height && source.width % source.height === 0) {
    // Horizontal strip of square tiles
    const count = Math.max(1, Math.round(source.width / source.height))
    const fw = Math.floor(source.width / count)
    const fh = source.height
    for (let i = 0; i < count; i++) {
      rects.push({ x: i * fw, y: 0, w: fw, h: fh })
    }
  } else if (source.width % targetFrames === 0 && source.height <= source.width) {
    const fw = Math.floor(source.width / targetFrames)
    for (let i = 0; i < targetFrames; i++) {
      rects.push({ x: i * fw, y: 0, w: fw, h: source.height })
    }
  } else {
    // Grid layout (e.g., AutoSprite 256x256 tiles in a multi-row grid)
    const cellSize = gcd(source.width, source.height) >= 32 ? gcd(source.width, source.height) : Math.min(source.width, source.height)
    const cols = Math.max(1, Math.floor(source.width / cellSize))
    const rows = Math.max(1, Math.floor(source.height / cellSize))
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        rects.push({ x: c * cellSize, y: r * cellSize, w: cellSize, h: cellSize })
      }
    }
  }

  // Filter out completely empty trailing cells in a grid
  const nonEmptyRects = rects.filter((rect) => {
    const box = getTileBoundingBox(srcRgba, source.width, rect.x, rect.y, rect.w, rect.h)
    return box.opaqueCount > 0
  })
  const usableRects = nonEmptyRects.length > 0 ? nonEmptyRects : rects

  // Sample `targetFrames` evenly from `usableRects`
  const selectedRects: FrameRect[] = []
  for (let i = 0; i < targetFrames; i++) {
    const idx = targetFrames === 1
      ? 0
      : Math.min(usableRects.length - 1, Math.floor((i * usableRects.length) / targetFrames))
    selectedRects.push(usableRects[idx])
  }

  // First pass: nearest-neighbor scale each frame into a tileSize x tileSize buffer
  // and harden pixel edges (alpha >= 128 -> 255, else 0)
  const scaledTiles: Uint8Array[] = selectedRects.map((rect) => {
    const tile = new Uint8Array(tileSize * tileSize * 4)
    for (let y = 0; y < tileSize; y++) {
      const srcY = Math.min(rect.h - 1, Math.floor((y * rect.h) / tileSize))
      for (let x = 0; x < tileSize; x++) {
        const srcX = Math.min(rect.w - 1, Math.floor((x * rect.w) / tileSize))
        const srcIdx = ((rect.y + srcY) * source.width + (rect.x + srcX)) * 4
        const dstIdx = (y * tileSize + x) * 4
        const a = srcRgba[srcIdx + 3]
        if (a >= 128) {
          tile[dstIdx] = srcRgba[srcIdx]
          tile[dstIdx + 1] = srcRgba[srcIdx + 1]
          tile[dstIdx + 2] = srcRgba[srcIdx + 2]
          tile[dstIdx + 3] = 255
        } else {
          tile[dstIdx] = 0
          tile[dstIdx + 1] = 0
          tile[dstIdx + 2] = 0
          tile[dstIdx + 3] = 0
        }
      }
    }
    return tile
  })

  // Second pass: stabilize character placement across frames.
  // Compute median centerX and median bottomY so every frame shares a stable ground plane and horizontal anchor.
  const boxes = scaledTiles.map((t) => getTileBoundingBox(t, tileSize, 0, 0, tileSize, tileSize))
  const validBoxes = boxes.filter((b) => b.opaqueCount > 0)
  const targetCenterX = validBoxes.length > 0
    ? Math.round(validBoxes.reduce((s, b) => s + b.centerX, 0) / validBoxes.length)
    : Math.floor(tileSize / 2)
  const targetBottomY = validBoxes.length > 0
    ? Math.round(validBoxes.reduce((s, b) => s + b.bottomY, 0) / validBoxes.length)
    : tileSize - 6

  const outWidth = targetFrames * tileSize
  const outHeight = tileSize
  const outRgba = new Uint8Array(outWidth * outHeight * 4)

  for (let f = 0; f < targetFrames; f++) {
    const tile = scaledTiles[f]
    const box = boxes[f]
    // Clamp stabilization shift so intentional subtle motion (like breathing or stepping) is preserved
    // while large frame-to-frame drift is corrected.
    const rawShiftX = Math.round(targetCenterX - box.centerX)
    const rawShiftY = Math.round(targetBottomY - box.bottomY)
    const shiftX = Math.abs(rawShiftX) > 4 ? rawShiftX : 0
    const shiftY = Math.abs(rawShiftY) > 4 ? rawShiftY : 0

    for (let y = 0; y < tileSize; y++) {
      for (let x = 0; x < tileSize; x++) {
        const dstX = x + shiftX
        const dstY = y + shiftY
        if (dstX < 0 || dstX >= tileSize || dstY < 0 || dstY >= tileSize) continue
        const srcIdx = (y * tileSize + x) * 4
        if (tile[srcIdx + 3] === 0) continue
        const outIdx = (dstY * outWidth + (f * tileSize + dstX)) * 4
        outRgba[outIdx] = tile[srcIdx]
        outRgba[outIdx + 1] = tile[srcIdx + 1]
        outRgba[outIdx + 2] = tile[srcIdx + 2]
        outRgba[outIdx + 3] = 255
      }
    }
  }

  return encodeRgbaToPng(outWidth, outHeight, outRgba)
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

// ── Reference Photo Palette Extraction & Pixel-Art Pet Synthesizer ──────────

export interface PetColorPalette {
  primary: [number, number, number]
  secondary: [number, number, number]
  belly: [number, number, number]
  outline: [number, number, number]
  eye: [number, number, number]
  accent: [number, number, number]
}

const DEFAULT_SPECIES_PALETTES: Record<PetSpecies, PetColorPalette> = {
  dog: {
    primary: [230, 168, 72],
    secondary: [184, 120, 40],
    belly: [250, 232, 196],
    outline: [52, 34, 20],
    eye: [32, 24, 20],
    accent: [224, 92, 92],
  },
  cat: {
    primary: [148, 156, 172],
    secondary: [102, 110, 128],
    belly: [238, 240, 245],
    outline: [38, 42, 54],
    eye: [72, 180, 108],
    accent: [236, 144, 164],
  },
  rabbit: {
    primary: [242, 236, 232],
    secondary: [212, 198, 192],
    belly: [255, 252, 250],
    outline: [72, 58, 56],
    eye: [188, 52, 76],
    accent: [244, 168, 184],
  },
  hamster: {
    primary: [238, 182, 108],
    secondary: [196, 136, 68],
    belly: [252, 244, 232],
    outline: [68, 44, 24],
    eye: [28, 22, 22],
    accent: [240, 152, 164],
  },
  bird: {
    primary: [76, 178, 232],
    secondary: [44, 128, 188],
    belly: [240, 248, 255],
    outline: [24, 48, 72],
    eye: [24, 24, 28],
    accent: [250, 188, 56],
  },
  fox: {
    primary: [232, 108, 44],
    secondary: [176, 68, 20],
    belly: [250, 242, 234],
    outline: [48, 24, 16],
    eye: [42, 32, 18],
    accent: [52, 44, 44],
  },
  other: {
    primary: [132, 198, 126],
    secondary: [86, 152, 84],
    belly: [228, 246, 224],
    outline: [32, 58, 34],
    eye: [28, 28, 36],
    accent: [244, 196, 78],
  },
}

/**
 * Extract a cohesive pixel-art color palette from raw BGRA/RGBA bitmap samples
 * of the user's uploaded pet photos (focusing on center pixels where the pet usually sits).
 */
export function extractPaletteFromRgbaSamples(
  samples: { width: number; height: number; rgba: Uint8Array }[],
  species: PetSpecies,
): PetColorPalette {
  const fallback = DEFAULT_SPECIES_PALETTES[species] ?? DEFAULT_SPECIES_PALETTES.dog
  if (samples.length === 0) return fallback

  // Bucket colors in 16-level RGB bins from the center 60% of each image
  const buckets = new Map<number, { count: number; r: number; g: number; b: number; lum: number }>()

  for (const sample of samples) {
    const { width, height, rgba } = sample
    if (width <= 0 || height <= 0) continue
    const startX = Math.floor(width * 0.2)
    const endX = Math.max(startX + 1, Math.floor(width * 0.8))
    const startY = Math.floor(height * 0.2)
    const endY = Math.max(startY + 1, Math.floor(height * 0.8))
    const stepX = Math.max(1, Math.floor((endX - startX) / 32))
    const stepY = Math.max(1, Math.floor((endY - startY) / 32))

    for (let y = startY; y < endY; y += stepY) {
      for (let x = startX; x < endX; x += stepX) {
        const idx = (y * width + x) * 4
        const r = rgba[idx]
        const g = rgba[idx + 1]
        const b = rgba[idx + 2]
        const a = rgba[idx + 3]
        if (a < 128) continue
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        // Ignore pure black/white background extremes
        if (lum < 18 || lum > 245) continue
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        const existing = buckets.get(key)
        if (existing) {
          existing.count++
          existing.r += r
          existing.g += g
          existing.b += b
        } else {
          buckets.set(key, { count: 1, r, g, b, lum })
        }
      }
    }
  }

  if (buckets.size === 0) return fallback

  const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count)
  const top = sorted[0]
  const primary: [number, number, number] = [
    Math.round(top.r / top.count),
    Math.round(top.g / top.count),
    Math.round(top.b / top.count),
  ]

  const secondary: [number, number, number] = [
    Math.max(0, Math.round(primary[0] * 0.76)),
    Math.max(0, Math.round(primary[1] * 0.76)),
    Math.max(0, Math.round(primary[2] * 0.76)),
  ]

  const belly: [number, number, number] = [
    Math.min(255, Math.round(primary[0] + (255 - primary[0]) * 0.62)),
    Math.min(255, Math.round(primary[1] + (255 - primary[1]) * 0.62)),
    Math.min(255, Math.round(primary[2] + (255 - primary[2]) * 0.62)),
  ]

  const outline: [number, number, number] = [
    Math.max(12, Math.round(primary[0] * 0.28)),
    Math.max(12, Math.round(primary[1] * 0.28)),
    Math.max(12, Math.round(primary[2] * 0.28)),
  ]

  return {
    primary,
    secondary,
    belly,
    outline,
    eye: fallback.eye,
    accent: fallback.accent,
  }
}

function setPixel(
  buf: Uint8Array,
  sheetWidth: number,
  tileOffsetX: number,
  x: number,
  y: number,
  color: [number, number, number],
) {
  if (x < 0 || x >= 64 || y < 0 || y >= 64) return
  const idx = (y * sheetWidth + (tileOffsetX + x)) * 4
  buf[idx] = color[0]
  buf[idx + 1] = color[1]
  buf[idx + 2] = color[2]
  buf[idx + 3] = 255
}

function fillRect(
  buf: Uint8Array,
  sheetWidth: number,
  tileOffsetX: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  color: [number, number, number],
) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(buf, sheetWidth, tileOffsetX, x0 + dx, y0 + dy, color)
    }
  }
}

function drawOutlinedBox(
  buf: Uint8Array,
  sheetWidth: number,
  tileOffsetX: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  fill: [number, number, number],
  outline: [number, number, number],
) {
  fillRect(buf, sheetWidth, tileOffsetX, x0, y0, w, h, outline)
  if (w > 2 && h > 2) {
    fillRect(buf, sheetWidth, tileOffsetX, x0 + 1, y0 + 1, w - 2, h - 2, fill)
  }
}

/**
 * Draw a single 64×64 pixel-art pet frame for the given species, animation, and frame index.
 * Anchored consistently with feet on ground line y = 54 and centered at x = 32.
 */
function drawPetFrame(
  buf: Uint8Array,
  sheetWidth: number,
  tileOffsetX: number,
  species: PetSpecies,
  palette: PetColorPalette,
  anim: CustomAnimationKey,
  frameIndex: number,
  totalFrames: number,
) {
  const isDeadFrame = anim === 'death' && frameIndex === totalFrames - 1
  const isDyingMid = anim === 'death' && frameIndex === 1
  const isHurt = anim === 'hurt'
  const isAttack = anim === 'attack'
  const isEvolve = anim === 'evolution'

  // Subtle vertical bob for idle/walk/attack/evolution
  const bobY =
    anim === 'idle' ? (frameIndex % 2 === 1 ? -1 : 0) :
    anim === 'walk' ? (frameIndex % 2 === 1 ? -2 : 0) :
    anim === 'hurt' ? (frameIndex % 2 === 1 ? 1 : -1) :
    anim === 'attack' ? (frameIndex === 1 || frameIndex === 2 ? -3 : 0) :
    anim === 'evolution' ? (frameIndex >= 2 && frameIndex <= 5 ? -3 : 0) :
    isDyingMid ? 3 :
    isDeadFrame ? 7 : 0

  const lungeX =
    anim === 'attack' ? (frameIndex === 1 ? 3 : frameIndex === 2 ? 4 : 0) :
    anim === 'hurt' ? (frameIndex === 0 ? -2 : 2) : 0

  const cx = 32 + lungeX
  const groundY = 54

  if (isDeadFrame) {
    // Lying flat pose anchored near groundY
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, cx - 15, groundY - 12, 30, 12, palette.primary, palette.outline)
    fillRect(buf, sheetWidth, tileOffsetX, cx - 10, groundY - 7, 18, 5, palette.belly)
    // Head resting on right side
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, cx + 6, groundY - 16, 14, 13, palette.primary, palette.outline)
    // X eyes
    setPixel(buf, sheetWidth, tileOffsetX, cx + 11, groundY - 11, palette.outline)
    setPixel(buf, sheetWidth, tileOffsetX, cx + 13, groundY - 9, palette.outline)
    setPixel(buf, sheetWidth, tileOffsetX, cx + 13, groundY - 11, palette.outline)
    setPixel(buf, sheetWidth, tileOffsetX, cx + 11, groundY - 9, palette.outline)
    // Tongue/accent
    fillRect(buf, sheetWidth, tileOffsetX, cx + 15, groundY - 6, 3, 3, palette.accent)
    return
  }

  // Body dimensions (centered around cx, sitting above legs)
  const bodyW = species === 'hamster' || species === 'bird' ? 22 : 24
  const bodyH = species === 'hamster' ? 18 : 16
  const bodyX = cx - Math.floor(bodyW / 2)
  const bodyY = groundY - 6 - bodyH + bobY

  // Tail (behind body on left)
  const tailWag = (frameIndex % 2 === 0) ? 0 : -2
  if (species === 'fox') {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, bodyX - 9, bodyY + 2 + tailWag, 10, 9, palette.primary, palette.outline)
    fillRect(buf, sheetWidth, tileOffsetX, bodyX - 8, bodyY + 3 + tailWag, 4, 4, palette.belly)
  } else if (species === 'rabbit' || species === 'hamster') {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, bodyX - 4, bodyY + 8, 5, 5, palette.belly, palette.outline)
  } else if (species === 'bird') {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, bodyX - 6, bodyY + 8 + tailWag, 7, 5, palette.secondary, palette.outline)
  } else {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, bodyX - 6, bodyY + 3 + tailWag, 7, 8, palette.secondary, palette.outline)
  }

  // Legs (4 legs for quadrupeds, 2 feet for bird/hamster)
  const walkStep = anim === 'walk' ? (frameIndex % 4) : 0
  const leftLegLift = (walkStep === 1) ? -2 : (walkStep === 3) ? 1 : 0
  const rightLegLift = (walkStep === 3) ? -2 : (walkStep === 1) ? 1 : 0

  drawOutlinedBox(
    buf,
    sheetWidth,
    tileOffsetX,
    bodyX + 3,
    groundY - 7 + Math.min(0, leftLegLift),
    5,
    7 - Math.min(0, leftLegLift),
    palette.secondary,
    palette.outline,
  )
  drawOutlinedBox(
    buf,
    sheetWidth,
    tileOffsetX,
    bodyX + bodyW - 8,
    groundY - 7 + Math.min(0, rightLegLift),
    5,
    7 - Math.min(0, rightLegLift),
    palette.secondary,
    palette.outline,
  )

  // Torso
  drawOutlinedBox(buf, sheetWidth, tileOffsetX, bodyX, bodyY, bodyW, bodyH, palette.primary, palette.outline)
  // Belly patch
  fillRect(buf, sheetWidth, tileOffsetX, bodyX + 4, bodyY + 4, bodyW - 8, bodyH - 6, palette.belly)
  // Collar / marking accent
  fillRect(buf, sheetWidth, tileOffsetX, bodyX + 3, bodyY + 1, bodyW - 6, 2, palette.accent)

  // Head
  const headW = 22
  const headH = 17
  const headX = cx - Math.floor(headW / 2) + (anim === 'walk' || isAttack ? 1 : 0)
  const headY = bodyY - headH + 4

  // Ears by species
  if (species === 'rabbit') {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + 3, headY - 10, 5, 11, palette.primary, palette.outline)
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + headW - 8, headY - 10, 5, 11, palette.primary, palette.outline)
    fillRect(buf, sheetWidth, tileOffsetX, headX + 5, headY - 8, 2, 7, palette.accent)
    fillRect(buf, sheetWidth, tileOffsetX, headX + headW - 6, headY - 8, 2, 7, palette.accent)
  } else if (species === 'cat' || species === 'fox') {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + 1, headY - 5, 6, 6, palette.secondary, palette.outline)
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + headW - 7, headY - 5, 6, 6, palette.secondary, palette.outline)
    fillRect(buf, sheetWidth, tileOffsetX, headX + 3, headY - 3, 2, 3, palette.accent)
    fillRect(buf, sheetWidth, tileOffsetX, headX + headW - 5, headY - 3, 2, 3, palette.accent)
  } else if (species === 'dog') {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX - 2, headY + 1, 5, 8, palette.secondary, palette.outline)
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + headW - 3, headY + 1, 5, 8, palette.secondary, palette.outline)
  } else if (species === 'hamster') {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + 1, headY - 3, 5, 5, palette.secondary, palette.outline)
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + headW - 6, headY - 3, 5, 5, palette.secondary, palette.outline)
  } else if (species === 'bird') {
    // Crest
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + 8, headY - 5, 6, 6, palette.secondary, palette.outline)
  } else {
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + 2, headY - 4, 5, 5, palette.secondary, palette.outline)
    drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX + headW - 7, headY - 4, 5, 5, palette.secondary, palette.outline)
  }

  // Head box
  drawOutlinedBox(buf, sheetWidth, tileOffsetX, headX, headY, headW, headH, palette.primary, palette.outline)
  // Lower muzzle/cheeks
  fillRect(buf, sheetWidth, tileOffsetX, headX + 4, headY + 9, headW - 8, 6, palette.belly)

  // Eyes
  if (isHurt || isDyingMid) {
    // Squinting > < eyes
    setPixel(buf, sheetWidth, tileOffsetX, headX + 5, headY + 6, palette.outline)
    setPixel(buf, sheetWidth, tileOffsetX, headX + 6, headY + 7, palette.outline)
    setPixel(buf, sheetWidth, tileOffsetX, headX + 5, headY + 8, palette.outline)
    setPixel(buf, sheetWidth, tileOffsetX, headX + headW - 6, headY + 6, palette.outline)
    setPixel(buf, sheetWidth, tileOffsetX, headX + headW - 7, headY + 7, palette.outline)
    setPixel(buf, sheetWidth, tileOffsetX, headX + headW - 6, headY + 8, palette.outline)
  } else {
    fillRect(buf, sheetWidth, tileOffsetX, headX + 5, headY + 6, 3, 3, palette.eye)
    fillRect(buf, sheetWidth, tileOffsetX, headX + headW - 8, headY + 6, 3, 3, palette.eye)
    // Eye shine
    setPixel(buf, sheetWidth, tileOffsetX, headX + 5, headY + 6, [255, 255, 255])
    setPixel(buf, sheetWidth, tileOffsetX, headX + headW - 8, headY + 6, [255, 255, 255])
  }

  // Nose / beak
  if (species === 'bird') {
    fillRect(buf, sheetWidth, tileOffsetX, headX + 9, headY + 9, 4, 3, palette.accent)
  } else {
    fillRect(buf, sheetWidth, tileOffsetX, headX + 10, headY + 9, 3, 2, palette.outline)
    if (isAttack || (anim === 'idle' && frameIndex === 2)) {
      fillRect(buf, sheetWidth, tileOffsetX, headX + 10, headY + 11, 3, 2, palette.accent)
    }
  }

  // Attack / Evolution pixel effects (kept close to character silhouette so placement remains stable)
  if (isAttack && (frameIndex === 1 || frameIndex === 2)) {
    const sparkColor: [number, number, number] = [255, 224, 92]
    fillRect(buf, sheetWidth, tileOffsetX, headX + headW + 2, headY + 2, 3, 3, sparkColor)
    fillRect(buf, sheetWidth, tileOffsetX, headX + headW + 4, headY + 8, 2, 2, palette.accent)
  }

  if (isEvolve) {
    // Evolution aura & crown/star burst on later frames
    const gold: [number, number, number] = [255, 218, 72]
    if (frameIndex >= 1 && frameIndex <= 6) {
      setPixel(buf, sheetWidth, tileOffsetX, headX - 3, headY + 3, gold)
      setPixel(buf, sheetWidth, tileOffsetX, headX + headW + 2, headY + 3, gold)
      setPixel(buf, sheetWidth, tileOffsetX, bodyX - 2, bodyY + 6, gold)
      setPixel(buf, sheetWidth, tileOffsetX, bodyX + bodyW + 1, bodyY + 6, gold)
    }
    if (frameIndex >= 4) {
      // Evolved star/gem emblem on forehead
      fillRect(buf, sheetWidth, tileOffsetX, headX + 9, headY + 2, 4, 3, gold)
    }
  }
}

/**
 * Synthesize a complete, normalized 6-animation pixel-art sprite pack for a pet
 * using the palette extracted from its reference photos.
 */
export function synthesizeAllAnimations(
  species: PetSpecies,
  palette: PetColorPalette,
): Record<CustomAnimationKey, Buffer> {
  const keys: CustomAnimationKey[] = ['idle', 'walk', 'hurt', 'death', 'attack', 'evolution']
  const result = {} as Record<CustomAnimationKey, Buffer>

  for (const key of keys) {
    const spec = NORMALIZED_ANIMATION_SPECS[key]
    const width = spec.frames * spec.tileWidth
    const height = spec.tileHeight
    const rgba = new Uint8Array(width * height * 4)

    for (let f = 0; f < spec.frames; f++) {
      drawPetFrame(rgba, width, f * spec.tileWidth, species, palette, key, f, spec.frames)
    }

    result[key] = encodeRgbaToPng(width, height, rgba)
  }

  return result
}
