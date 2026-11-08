/**
 * AutoSprite MCP Client (runs strictly in the Electron main process).
 *
 * Discovered AutoSprite MCP Interface (`https://www.autosprite.io/api/mcp`):
 * - Transport: Streamable HTTP JSON-RPC 2.0 (`POST`, `Accept: application/json, text/event-stream`),
 *   session tracked via `mcp-session-id` response header.
 * - Tools used:
 *   1. `upload_character`: `{ name, imageUrl?, uploadKey?, isHumanoid?: boolean, characterDescription?: string }`
 *   2. `request_upload_url`: `{ fileName, contentType }` -> `{ uploadUrl, uploadKey }`
 *   3. `save_pose`: `{ character_id, upload_key, name }` -> `{ id }`
 *   4. `set_reference_view`: `{ character_id, view: "front"|"back"|"left"|"right", pose_id }`
 *   5. `generate_spritesheet`: `{ characterId, animations: [{ kind, name?, prompt?, loop?, raw_prompt? }], spritesheet: { frameCount, frameSize }, videoTier: "turbo", turboMode: "reference", removeBg: "default", withSound: false }`
 *   6. `get_job_status`: `{ jobId }` (requires >= 30s polling interval)
 *   7. `list_spritesheets`: `{ characterId, latestOnly: true }`
 *   8. `get_spritesheet`: `{ spritesheetId }` -> `{ downloadUrl / sheetUrl, atlasUrl, ... }`
 *
 * Security:
 * - Never logs authorization headers or bearer tokens.
 * - Never exposes credentials to the renderer process.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type {
  CustomAnimationKey,
  PetCreationProgress,
  PetSpecies,
  UploadedPetPhoto,
} from '../src/types/customPet'
import { AUTOSPRITE_PET_PROMPT, NORMALIZED_ANIMATION_SPECS } from '../src/types/customPet'
import { decodePng, type FrameRect, normalizeToHorizontalStrip } from './pngCodec'

interface AutoSpriteConnectionConfig {
  serverUrl: string
  authHeader: string
}

/**
 * Resolve AutoSprite MCP connection config from environment variables,
 * or (in local un-packaged development only) from `~/.gemini/antigravity/mcp_config.json`.
 * Never logs or returns the token to renderer callers.
 */
export function resolveAutoSpriteConfig(isPackaged: boolean): AutoSpriteConnectionConfig | null {
  const envUrl = process.env.AUTOSPRITE_MCP_URL || 'https://www.autosprite.io/api/mcp'
  const envKey = process.env.AUTOSPRITE_API_KEY?.trim()

  if (envKey && envKey !== 'vspk_your_api_key_here') {
    const authHeader = envKey.startsWith('Bearer ') ? envKey : `Bearer ${envKey}`
    return { serverUrl: envUrl, authHeader }
  }

  // Development-only fallback: read developer's local MCP config if available
  if (!isPackaged) {
    try {
      const mcpConfigPath = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json')
      if (fs.existsSync(mcpConfigPath)) {
        const raw = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'))
        const server = raw?.mcpServers?.autosprite
        const url = typeof server?.serverUrl === 'string'
          ? server.serverUrl
          : typeof server?.url === 'string'
            ? server.url
            : envUrl
        const auth = server?.headers?.Authorization
        if (typeof auth === 'string' && auth.trim().length > 0) {
          return { serverUrl: url, authHeader: auth.trim() }
        }
      }
    } catch {
      // Ignore missing or unreadable local MCP config
    }
  }

  return null
}

interface McpToolCallResult {
  isError?: boolean
  text: string
  structured?: Record<string, unknown>
}

function parseSseOrJsonRpc(bodyText: string): Record<string, unknown> {
  const trimmed = bodyText.trim()
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed)
  }
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6).trim())
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(dataLines[i])
    } catch {
      // try previous data line
    }
  }
  throw new Error('Unexpected response format from AutoSprite MCP server')
}

class AutoSpriteMcpSession {
  private sessionId: string | null = null
  private rpcId = 1

  constructor(private readonly config: AutoSpriteConnectionConfig) {}

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': this.config.authHeader,
    }
    if (this.sessionId) {
      headers['mcp-session-id'] = this.sessionId
    }
    return headers
  }

  async initialize(): Promise<void> {
    const res = await fetch(this.config.serverUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.rpcId++,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'posture-pet-desktop', version: '0.1.0' },
        },
      }),
    })

    if (!res.ok) {
      throw new Error(`AutoSprite MCP initialization failed (HTTP ${res.status})`)
    }

    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid
    await res.text()
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const res = await fetch(this.config.serverUrl, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.rpcId++,
        method: 'tools/call',
        params: {
          name,
          arguments: args,
        },
      }),
    })

    if (!res.ok) {
      throw new Error(`AutoSprite MCP tool "${name}" failed (HTTP ${res.status})`)
    }

    const rawText = await res.text()
    const payload = parseSseOrJsonRpc(rawText)

    if (payload.error && typeof payload.error === 'object') {
      const errMsg = (payload.error as { message?: string }).message || 'MCP RPC error'
      return { isError: true, text: errMsg }
    }

    const result = (payload.result ?? {}) as {
      isError?: boolean
      content?: Array<{ type?: string; text?: string }>
      structuredContent?: Record<string, unknown>
    }

    const contentText = Array.isArray(result.content)
      ? result.content
          .map((c) => (typeof c?.text === 'string' ? c.text : ''))
          .filter(Boolean)
          .join('\n')
      : ''

    let structured = result.structuredContent
    if (!structured && contentText.startsWith('{')) {
      try {
        structured = JSON.parse(contentText.split('\n\n')[0])
      } catch {
        // Not pure JSON
      }
    }

    return {
      isError: !!result.isError,
      text: contentText,
      structured,
    }
  }
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const commaIdx = dataUrl.indexOf(',')
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl
  return Buffer.from(base64, 'base64')
}

function parseAtlasRects(atlasJson: unknown): FrameRect[] | undefined {
  if (!atlasJson || typeof atlasJson !== 'object') return undefined
  const framesObj = (atlasJson as { frames?: Record<string, unknown> }).frames
  if (!framesObj || typeof framesObj !== 'object') return undefined

  const keys = Object.keys(framesObj).sort((a, b) => Number(a) - Number(b))
  const rects: FrameRect[] = []
  for (const k of keys) {
    const entry = framesObj[k] as { x?: number; y?: number; w?: number; h?: number; frame?: FrameRect }
    const cell = entry?.frame ?? entry
    if (
      cell &&
      typeof cell.x === 'number' &&
      typeof cell.y === 'number' &&
      typeof cell.w === 'number' &&
      typeof cell.h === 'number'
    ) {
      rects.push({ x: cell.x, y: cell.y, w: cell.w, h: cell.h })
    }
  }
  return rects.length > 0 ? rects : undefined
}

/**
 * Call AutoSprite MCP to create a pet character from reference photos, generate
 * the 6 required animations, download the resulting PNG sprite sheets, and
 * normalize them into 64×64 horizontal RGBA strips.
 */
export async function generateSpritesViaAutoSpriteMcp(options: {
  name: string
  species: PetSpecies
  breed?: string
  photos: UploadedPetPhoto[]
  isPackaged: boolean
  onProgress: (progress: PetCreationProgress) => void
}): Promise<Record<CustomAnimationKey, Buffer>> {
  const { name, species, breed, photos, isPackaged, onProgress } = options

  const config = resolveAutoSpriteConfig(isPackaged)
  if (!config) {
    const err = new Error(
      'AutoSprite MCP is not configured. Set AUTOSPRITE_API_KEY in your environment or use the local pixel-art synthesizer / pack importer.',
    )
    ;(err as Error & { code?: string }).code = 'MCP_UNAVAILABLE'
    throw err
  }

  onProgress({
    stage: 'sending',
    message: 'Connecting to AutoSprite MCP and uploading reference photos…',
    percent: 22,
  })

  const session = new AutoSpriteMcpSession(config)
  await session.initialize()

  const speciesDesc = breed ? `${breed} ${species}` : species
  const fullDescription = `${AUTOSPRITE_PET_PROMPT} Pet details: ${name}, a ${speciesDesc}.`.slice(0, 1000)

  // Step 1: Upload primary character photo via `upload_character`
  const primaryPhoto = photos[0]
  const uploadRes = await session.callTool('upload_character', {
    name: name.slice(0, 100),
    imageUrl: primaryPhoto.dataUrl,
    isHumanoid: false,
    characterDescription: fullDescription,
  })

  if (uploadRes.isError) {
    const err = new Error(uploadRes.text || 'AutoSprite character upload failed.')
    ;(err as Error & { code?: string }).code = uploadRes.text.toLowerCase().includes('subscription')
      ? 'MCP_SUBSCRIPTION_REQUIRED'
      : 'MCP_UNAVAILABLE'
    throw err
  }

  const characterId =
    (uploadRes.structured?.id as string | undefined) ||
    ((uploadRes.structured?.character as { id?: string } | undefined)?.id)
  if (!characterId) {
    throw new Error('AutoSprite upload_character did not return a characterId.')
  }

  // Step 2: If additional photos were supplied (up to 3 extra reference views),
  // attach them via request_upload_url -> PUT -> save_pose -> set_reference_view.
  const extraViews: Array<'left' | 'right' | 'back'> = ['left', 'right', 'back']
  for (let i = 1; i < Math.min(photos.length, 4); i++) {
    const photo = photos[i]
    const view = extraViews[i - 1]
    try {
      const urlRes = await session.callTool('request_upload_url', {
        fileName: `ref_${view}.png`,
        contentType: photo.mimeType,
      })
      const uploadUrl = urlRes.structured?.uploadUrl as string | undefined
      const uploadKey = urlRes.structured?.uploadKey as string | undefined
      if (uploadUrl && uploadKey) {
        const binary = dataUrlToBuffer(photo.dataUrl)
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': photo.mimeType },
          body: new Uint8Array(binary),
        })
        if (putRes.ok) {
          const poseRes = await session.callTool('save_pose', {
            character_id: characterId,
            upload_key: uploadKey,
            name: `Ref ${view}`,
          })
          const poseId =
            (poseRes.structured?.id as string | undefined) ||
            ((poseRes.structured?.pose as { id?: string } | undefined)?.id)
          if (poseId) {
            await session.callTool('set_reference_view', {
              character_id: characterId,
              view,
              pose_id: poseId,
            })
          }
        }
      }
    } catch {
      // Non-fatal if an optional reference view fails to attach
    }
  }

  // Step 3: Trigger `generate_spritesheet` for idle, walk, hurt, death, attack, and evolution
  onProgress({
    stage: 'generating',
    message: 'Requesting idle, walk, hurt, death, attack, and evolution animations from AutoSprite…',
    percent: 40,
  })

  const genRes = await session.callTool('generate_spritesheet', {
    characterId,
    animations: [
      { kind: 'idle', loop: true },
      { kind: 'walk', loop: true },
      { kind: 'hurt' },
      { kind: 'death' },
      { kind: 'attack' },
      {
        kind: 'custom',
        name: 'evolution',
        raw_prompt: true,
        prompt: `${AUTOSPRITE_PET_PROMPT} Animation: evolution transformation with a brief pixel energy glow settling into an evolved idle pose.`,
      },
    ],
    spritesheet: {
      frameSize: 64,
      frameCount: 8,
    },
    videoTier: 'turbo',
    turboMode: 'reference',
    removeBg: 'default',
    withSound: false,
  })

  if (genRes.isError) {
    const err = new Error(genRes.text || 'AutoSprite generate_spritesheet failed.')
    ;(err as Error & { code?: string }).code = genRes.text.toLowerCase().includes('subscription')
      ? 'MCP_SUBSCRIPTION_REQUIRED'
      : 'MCP_UNAVAILABLE'
    throw err
  }

  const jobId =
    (genRes.structured?.jobId as string | undefined) ||
    (Array.isArray(genRes.structured?.jobIds) ? (genRes.structured?.jobIds[0] as string) : undefined)

  // Step 4: Poll `get_job_status` waiting at least 30s between checks as required by AutoSprite MCP
  if (jobId) {
    const maxAttempts = 12
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      onProgress({
        stage: 'generating',
        message: `AutoSprite rendering sprite sheets (check ${attempt}/${maxAttempts})…`,
        percent: Math.min(72, 42 + attempt * 3),
      })
      await new Promise((r) => setTimeout(r, 31000))
      const statusRes = await session.callTool('get_job_status', { jobId })
      if (statusRes.isError) {
        throw new Error(statusRes.text || 'Failed while polling AutoSprite job status.')
      }
      const status = (statusRes.structured?.status as string | undefined)?.toLowerCase()
      if (status === 'succeeded' || status === 'completed') {
        break
      }
      if (status === 'failed' || status === 'error') {
        const reason = (statusRes.structured?.error as string | undefined) || 'AutoSprite generation job failed.'
        throw new Error(reason)
      }
    }
  }

  // Step 5: Retrieve spritesheets for the character and normalize each animation
  onProgress({
    stage: 'validating',
    message: 'Downloading and normalizing sprite sheets…',
    percent: 76,
  })

  const listRes = await session.callTool('list_spritesheets', {
    characterId,
    latestOnly: true,
  })
  if (listRes.isError) {
    throw new Error(listRes.text || 'Failed to list generated AutoSprite sheets.')
  }

  const items = (listRes.structured?.items ?? listRes.structured?.spritesheets ?? []) as Array<{
    id?: string
    spritesheetId?: string
    kind?: string
    name?: string
    sheetUrl?: string
    downloadUrl?: string
    atlasUrl?: string
  }>

  const downloadedByAnim: Partial<Record<CustomAnimationKey, Buffer>> = {}

  for (const item of items) {
    const rawKind = (item.kind || item.name || '').toLowerCase()
    const animKey: CustomAnimationKey | null =
      rawKind.includes('idle') ? 'idle' :
      rawKind.includes('walk') ? 'walk' :
      rawKind.includes('hurt') || rawKind.includes('hit') ? 'hurt' :
      rawKind.includes('death') ? 'death' :
      rawKind.includes('attack') ? 'attack' :
      rawKind.includes('evol') ? 'evolution' : null

    if (!animKey || downloadedByAnim[animKey]) continue

    let sheetUrl = item.sheetUrl || item.downloadUrl
    let atlasUrl = item.atlasUrl
    const sheetId = item.spritesheetId || item.id

    if (!sheetUrl && sheetId) {
      const detail = await session.callTool('get_spritesheet', { spritesheetId: sheetId })
      sheetUrl =
        (detail.structured?.sheetUrl as string | undefined) ||
        (detail.structured?.downloadUrl as string | undefined)
      atlasUrl = detail.structured?.atlasUrl as string | undefined
    }

    if (!sheetUrl) continue

    const imgRes = await fetch(sheetUrl)
    if (!imgRes.ok) continue
    const pngBuf = Buffer.from(await imgRes.arrayBuffer())

    let atlasRects: FrameRect[] | undefined
    if (atlasUrl) {
      try {
        const atlasRes = await fetch(atlasUrl)
        if (atlasRes.ok) {
          atlasRects = parseAtlasRects(await atlasRes.json())
        }
      } catch {
        // Optional atlas fetch
      }
    }

    const decoded = decodePng(pngBuf)
    const spec = NORMALIZED_ANIMATION_SPECS[animKey]
    downloadedByAnim[animKey] = normalizeToHorizontalStrip(decoded, spec.frames, spec.tileWidth, atlasRects)
  }

  if (!downloadedByAnim.idle) {
    throw new Error('AutoSprite did not return a usable idle sprite sheet.')
  }

  // If any secondary animation was omitted by AutoSprite, derive a normalized sheet from idle
  const allKeys: CustomAnimationKey[] = ['idle', 'walk', 'hurt', 'death', 'attack', 'evolution']
  const idleDecoded = decodePng(downloadedByAnim.idle)
  for (const key of allKeys) {
    if (!downloadedByAnim[key]) {
      const spec = NORMALIZED_ANIMATION_SPECS[key]
      downloadedByAnim[key] = normalizeToHorizontalStrip(idleDecoded, spec.frames, spec.tileWidth)
    }
  }

  return downloadedByAnim as Record<CustomAnimationKey, Buffer>
}
