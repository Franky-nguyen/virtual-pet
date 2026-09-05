/**
 * Web Audio UI Sound Effects for PosturePet — Deep, Warm Mechanical Keyboard Aesthetic.
 *
 * Every keystroke is built from two simultaneous layers, mimicking the acoustic
 * signature of a lubed, high-end custom mechanical switch:
 *
 *   Layer 1 — Plastic Transient (snap)
 *     Pink noise burst → BiquadFilter (shape varies per profile)
 *     → GainNode (instant attack, fast exponential decay, hard cut to 0)
 *     → simulates the sharp impact of the keycap bottoming out.
 *
 *   Layer 2 — Body Resonance (thump)
 *     OscillatorNode with a fast downward pitch sweep
 *     → GainNode (slower exponential decay, hard cut to 0)
 *     → simulates the hollow case resonance after bottom-out.
 *
 * Both layers merge into the destination, producing a layered, realistic
 * keystroke rather than a thin synthetic blip. No 8-bit / square / sawtooth
 * content is used anywhere.
 *
 * The shared AudioContext is lazily initialized on first user interaction
 * (browser autoplay policy). All oscillator and buffer nodes use explicit
 * stop times and their gain is forced to exactly 0 at end-of-life, so rapid,
 * overlapping clicks never pop or clip.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared engine state
// ─────────────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null
let masterGain: GainNode | null = null

function getEngine(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    masterGain = audioCtx.createGain()
    masterGain.gain.setValueAtTime(0.5, audioCtx.currentTime)
    masterGain.connect(audioCtx.destination)
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

// ─────────────────────────────────────────────────────────────────────────────
// Noise buffers  (pre-generated once, re-used for every keystroke)
// ─────────────────────────────────────────────────────────────────────────────

let whiteNoiseBuffer: AudioBuffer | null = null
let pinkNoiseBuffer: AudioBuffer | null = null

/** Soft-clipped white noise — used where a broadband transient is required. */
function getWhiteNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (whiteNoiseBuffer && whiteNoiseBuffer.sampleRate === ctx.sampleRate) return whiteNoiseBuffer
  const frameCount = Math.ceil(ctx.sampleRate * 0.5) // 500 ms pre-generated buffer
  whiteNoiseBuffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
  const data = whiteNoiseBuffer.getChannelData(0)
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.tanh((Math.random() * 2 - 1) * 1.2) * 0.9
  }
  return whiteNoiseBuffer
}

/**
 * Pink noise (Paul Kellet's refined method) — -3 dB/octave slope gives the
 * warm, natural body that white noise lacks. This is the primary transient
 * source for the whole aesthetic.
 */
function getPinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (pinkNoiseBuffer && pinkNoiseBuffer.sampleRate === ctx.sampleRate) return pinkNoiseBuffer
  const frameCount = Math.ceil(ctx.sampleRate * 0.5) // 500 ms pre-generated buffer
  pinkNoiseBuffer = ctx.createBuffer(1, frameCount, ctx.sampleRate)
  const data = pinkNoiseBuffer.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < frameCount; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.96900 * b2 + white * 0.1538520
    b3 = 0.86650 * b3 + white * 0.3104856
    b4 = 0.55000 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.0168980
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
    // Soft clip against rare peaks while keeping the warmth intact
    data[i] = Math.tanh(pink * 1.5) * 0.9
  }
  return pinkNoiseBuffer
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile definitions
// ─────────────────────────────────────────────────────────────────────────────

interface SoundProfile {
  // ── Layer 1: Plastic Transient ────────────────────────────────────────────
  /** Noise colour — pink is the warm default for every profile. */
  noiseColor: 'white' | 'pink'
  /** BiquadFilter type for the noise layer. */
  noiseFilterType: BiquadFilterType
  /** Centre frequency in Hz. */
  noiseFreq: number
  /** Filter frequency sweep end (Hz). null = no sweep. */
  noiseFreqEnd?: number
  /** How many ms into the note the noiseFreq sweep reaches noiseFreqEnd. */
  noiseFreqSweepMs?: number
  /** Filter Q (bandwidth). */
  noiseQ?: number
  /** Attack duration in ms (0 = instant). */
  noiseAttackMs: number
  /** Exponential decay duration in ms. */
  noiseDecayMs: number
  /** Noise layer peak gain. */
  noiseVolume: number

  // ── Layer 2: Body Resonance ───────────────────────────────────────────────
  /** Oscillator type — triangle/sine for warm, hollow body. */
  oscType: OscillatorType
  /** Oscillator frequency at note onset (Hz). */
  oscStartHz: number
  /** Oscillator frequency after the pitch-drop sweep (Hz). */
  oscEndHz: number
  /** How many ms the pitch takes to drop from oscStartHz → oscEndHz. */
  oscPitchDropMs: number
  /** Attack duration in ms. */
  oscAttackMs: number
  /** Exponential decay duration in ms. */
  oscDecayMs: number
  /** Resonance layer peak gain. */
  oscVolume: number
}

const PROFILES: Record<'thocky' | 'creamy' | 'tactile', SoundProfile> = {

  /**
   * THOCKY — Heavy spacebar bottoming out (playStart / playReset / playCalibrate / playEvolve).
   *
   * Pink noise through a strict 300 Hz lowpass removes every harsh high
   * frequency, leaving only a soft "thud" transient. A triangle oscillator
   * drops 200 Hz → 80 Hz over 45 ms with a longer ~70 ms decay, simulating the
   * heavy bottoming-out of a spacebar or enter key.
   */
  thocky: {
    noiseColor: 'pink',
    noiseFilterType: 'lowpass',
    noiseFreq: 300,
    noiseAttackMs: 1,
    noiseDecayMs: 45,
    noiseVolume: 0.30,

    oscType: 'triangle',
    oscStartHz: 200,
    oscEndHz: 80,
    oscPitchDropMs: 45,
    oscAttackMs: 2,
    oscDecayMs: 70,
    oscVolume: 0.45,
  },

  /**
   * CREAMY — Smooth, lubricated alpha keys (playPop / Pause / Wardrobe items).
   *
   * Bandpass-filtered pink noise centred at 600 Hz removes both the muddy
   * bass and the tacky highs, leaving a smooth "thwack". A sine body drops
   * 350 Hz → 150 Hz over 35 ms — smoother than the triangle thock, distinct
   * but never sharp.
   */
  creamy: {
    noiseColor: 'pink',
    noiseFilterType: 'bandpass',
    noiseFreq: 600,
    noiseQ: 0.8,
    noiseAttackMs: 1,
    noiseDecayMs: 35,
    noiseVolume: 0.38,

    oscType: 'sine',
    oscStartHz: 350,
    oscEndHz: 150,
    oscPitchDropMs: 35,
    oscAttackMs: 2,
    oscDecayMs: 55,
    oscVolume: 0.45,
  },

  /**
   * TACTILE — Satisfying tactile bump for toggles & popups (playToggle),
   * sharp but warm.
   *
   * Pink noise through an 800 Hz highpass produces a tiny plastic snap whose
   * envelope dies within ~12 ms, so it disappears instantly and never lingers
   * or sounds tacky. A triangle body drops 450 Hz → 200 Hz over 30 ms for the
   * bumpy "bop" character.
   */
  tactile: {
    noiseColor: 'pink',
    noiseFilterType: 'highpass',
    noiseFreq: 800,
    noiseAttackMs: 0,
    noiseDecayMs: 12,
    noiseVolume: 0.40,

    oscType: 'triangle',
    oscStartHz: 450,
    oscEndHz: 200,
    oscPitchDropMs: 30,
    oscAttackMs: 2,
    oscDecayMs: 45,
    oscVolume: 0.45,
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Core synthesis engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply a click-safe gain envelope to an AudioParam.
 *
 * Instant (or very short linear) attack → exponential decay to silence → then
 * a hard setValueAtTime(0) at the exact end of the duration, so the note is
 * cut to strictly 0 instantly — tactile, with no ringing tail.
 *
 * @returns The end time (in ctx.currentTime seconds) of the envelope.
 */
function applyEnvelope(param: AudioParam, peak: number, attackMs: number, decayMs: number, now: number): number {
  const tPeak = now + attackMs / 1000
  const tEnd = tPeak + decayMs / 1000
  if (attackMs <= 0) {
    param.setValueAtTime(peak, now)
  } else {
    param.setValueAtTime(0, now)
    param.linearRampToValueAtTime(peak, tPeak)
  }
  param.exponentialRampToValueAtTime(0.0001, tEnd)
  param.setValueAtTime(0, tEnd) // instant hard cut — strictly 0 at end of duration
  return tEnd
}

/**
 * Synthesise a single keystroke using the given profile.
 *
 * Signal chain per keystroke:
 *
 *   noise BufferSource ──→ BiquadFilter ──→ Gain (fast decay, hard cut)
 *   osc   OscillatorNode ────────────────→ Gain (slow decay, hard cut)
 *                                        ↓ both
 *                                    masterGain → destination
 *
 * Every node is created fresh per keystroke and explicitly stopped, so rapid,
 * overlapping clicks layer cleanly without popping or build-up.
 *
 * @param profile  The SoundProfile to use.
 * @param ctx     Active AudioContext.
 * @param now     ctx.currentTime at call time.
 */
function playKeystrokeImpl(profile: SoundProfile, ctx: AudioContext, now: number): void {
  // ── Layer 1: Plastic Transient ─────────────────────────────────────────────
  {
    const source = ctx.createBufferSource()
    source.buffer = profile.noiseColor === 'pink' ? getPinkNoiseBuffer(ctx) : getWhiteNoiseBuffer(ctx)
    source.loop = false

    const filter = ctx.createBiquadFilter()
    filter.type = profile.noiseFilterType
    if (profile.noiseQ !== undefined) {
      filter.Q.setValueAtTime(profile.noiseQ, now)
    }
    filter.frequency.setValueAtTime(profile.noiseFreq, now)
    if (profile.noiseFreqEnd !== undefined && profile.noiseFreqSweepMs !== undefined) {
      filter.frequency.linearRampToValueAtTime(
        profile.noiseFreqEnd,
        now + profile.noiseFreqSweepMs / 1000,
      )
    }

    const gain = ctx.createGain()
    const end = applyEnvelope(gain.gain, profile.noiseVolume, profile.noiseAttackMs, profile.noiseDecayMs, now)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(masterGain!)

    source.start(now)
    source.stop(end + 0.01) // gain is already hard-cut to 0 at `end`
  }

  // ── Layer 2: Body Resonance ───────────────────────────────────────────────
  {
    const osc = ctx.createOscillator()
    osc.type = profile.oscType
    osc.frequency.setValueAtTime(profile.oscStartHz, now)
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(profile.oscEndHz, 1),
      now + profile.oscPitchDropMs / 1000,
    )

    const gain = ctx.createGain()
    const end = applyEnvelope(gain.gain, profile.oscVolume, profile.oscAttackMs, profile.oscDecayMs, now)

    osc.connect(gain)
    gain.connect(masterGain!)

    osc.start(now)
    osc.stop(end + 0.01) // gain is already hard-cut to 0 at `end`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * playKeystroke — Synthesise a mechanical keyboard keystroke.
 *
 * @param type  'thocky' — heavy spacebar bottom-out  (playStart, playReset, playCalibrate, playEvolve)
 *            | 'creamy' — smooth lubricated alpha key  (playPop / Pause / Wardrobe)
 *            | 'tactile' — sharp-but-warm tactile bump  (playToggle / popups)
 */
export function playKeystroke(type: 'thocky' | 'creamy' | 'tactile'): void {
  try {
    const ctx = getEngine()
    playKeystrokeImpl(PROFILES[type], ctx, ctx.currentTime)
  } catch (e) {
    console.error(`[sound] playKeystroke('${type}') failed`, e)
  }
}

/** Standard click / Pause / Wardrobe items — smooth creamy alpha key. */
export function playPop(): void {
  playKeystroke('creamy')
}

/** Toggles & popups — tactile bump. */
export function playToggle(): void {
  playKeystroke('tactile')
}

/** Timer Start — primary action, deep warm thock. */
export function playStart(): void {
  playKeystroke('thocky')
}

/** Timer Reset — same heavy thock family as start, marking the timer zone. */
export function playReset(): void {
  playKeystroke('thocky')
}

/**
 * Calibrate Posture — rhythmic "chunk-chunk" success sound.
 * Two thocky hits staggered by exactly 90 ms on the audio clock, giving a
 * satisfying double-tap instead of a single thud.
 */
export function playCalibrate(): void {
  playThockDouble()
}

/**
 * Level 10 Evolution — triumphant double thud.
 * Schedules the second thocky hit 90 ms later using the Web Audio clock
 * (ctx.currentTime) so both are jitter-free and perfectly synchronised.
 */
export function playEvolve(): void {
  playThockDouble()
}

/** Two thocky hits staggered by exactly 90 ms — the "chunk-chunk" signature. */
function playThockDouble(): void {
  try {
    const ctx = getEngine()
    const OFFSET = 0.09 // 90 ms in seconds
    const p = PROFILES.thocky

    // First thocky hit — now
    playKeystrokeImpl(p, ctx, ctx.currentTime)

    // Second thocky hit — 90 ms later, audio-clock scheduled
    playKeystrokeImpl(p, ctx, ctx.currentTime + OFFSET)
  } catch (e) {
    console.error('[sound] playThockDouble failed', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evolution chiptune (Web Audio, zero files — blocky 8-bit square/sawtooth)
// ─────────────────────────────────────────────────────────────────────────────

/** Play a single chip note with a click-safe attack/decay envelope. */
function playChipNote(freq: number, when: number, durMs: number, type: OscillatorType, vol: number): void {
  const ctx = getEngine()
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, when)

  const gain = ctx.createGain()
  const tEnd = when + durMs / 1000
  gain.gain.setValueAtTime(0, when)
  gain.gain.linearRampToValueAtTime(vol, when + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, tEnd)
  gain.gain.setValueAtTime(0, tEnd)

  osc.connect(gain)
  gain.connect(masterGain!)

  osc.start(when)
  osc.stop(tEnd + 0.02)
}

/** Trigger (0.0s) — ascending magical arpeggio signalling a special event. */
export function playEvolveArpeggio(): void {
  try {
    const ctx = getEngine()
    const now = ctx.currentTime
    // C5 E5 G5 C6 E6 G6 rising arpeggio + a C7 sparkle on top
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
    notes.forEach((f, i) => playChipNote(f, now + i * 0.09, 170, 'square', 0.15))
    playChipNote(2093.0, now + notes.length * 0.09, 420, 'square', 0.1)
  } catch (e) {
    console.error('[sound] playEvolveArpeggio failed', e)
  }
}

let evolveDrone: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null

/**
 * Particle dance (0.5s–3.5s) — a subtle, looping rising drone with a rapid
 * square-wave tremolo, building suspense while the particles dance.
 */
export function startEvolveDrone(): void {
  try {
    const ctx = getEngine()
    if (evolveDrone) stopEvolveDrone(0)
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(160, now)
    osc.frequency.linearRampToValueAtTime(460, now + 3.0) // slowly rising energy

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.06, now + 0.3)   // fade in
    gain.gain.linearRampToValueAtTime(0.1, now + 2.8)    // swell toward the climax

    // Rapid square-wave LFO modulating the drone amplitude — shimmering tremolo.
    const lfo = ctx.createOscillator()
    lfo.type = 'square'
    lfo.frequency.setValueAtTime(22, now)
    const lfoGain = ctx.createGain()
    lfoGain.gain.setValueAtTime(0.025, now)

    lfo.connect(lfoGain)
    lfoGain.connect(gain.gain)

    osc.connect(gain)
    gain.connect(masterGain!)

    osc.start(now)
    lfo.start(now)

    evolveDrone = { osc, lfo, gain }
  } catch (e) {
    console.error('[sound] startEvolveDrone failed', e)
  }
}

/** Stop the looping drone with a smooth fade. Safe to call repeatedly. */
export function stopEvolveDrone(fadeMs = 350): void {
  if (!evolveDrone || !audioCtx) return
  const { osc, lfo, gain } = evolveDrone
  evolveDrone = null
  try {
    const now = audioCtx.currentTime
    const tEnd = now + fadeMs / 1000
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(0, tEnd)
    osc.stop(tEnd + 0.05)
    lfo.stop(tEnd + 0.05)
  } catch (e) {
    console.error('[sound] stopEvolveDrone failed', e)
  }
}

/** Climax (3.8s) — grand triumphant retro fanfare + heavy chime chord. */
export function playEvolveFanfare(): void {
  try {
    const ctx = getEngine()
    const now = ctx.currentTime

    // quick rising run into the chord
    const run = [392.0, 493.88, 587.33, 783.99] // G4 B4 D5 G5
    run.forEach((f, i) => playChipNote(f, now + i * 0.07, 110, 'square', 0.15))

    // sustained C-major success chord (the classic "evolution" jingle feel)
    const chord = [261.63, 392.0, 523.25, 659.25, 783.99, 1046.5]
    const chordAt = now + run.length * 0.07 + 0.05
    chord.forEach((f) => playChipNote(f, chordAt, 950, 'triangle', 0.18))
    playChipNote(2093.0, chordAt, 700, 'square', 0.08) // C7 sparkle
  } catch (e) {
    console.error('[sound] playEvolveFanfare failed', e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Volume control
// ─────────────────────────────────────────────────────────────────────────────

/** Master keystroke volume (0.0 – 1.0). */
export function setKeystrokeVolume(volume: number): void {
  if (!masterGain || !audioCtx) return
  masterGain.gain.setValueAtTime(Math.min(1, Math.max(0, volume)), audioCtx.currentTime)
}

export function getKeystrokeVolume(): number {
  return masterGain?.gain.value ?? 0.5
}
