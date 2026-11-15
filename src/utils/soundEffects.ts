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
// Pokémon-Style Evolution Chiptune (Web Audio, zero external files — 8-bit GB/GBA)
// ─────────────────────────────────────────────────────────────────────────────

/** Play a single chip note with a click-safe attack/decay envelope routed to `dest`. */
function playChipNote(
  freq: number,
  when: number,
  durMs: number,
  type: OscillatorType,
  vol: number,
  dest?: AudioNode,
): OscillatorNode {
  const ctx = getEngine()
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, when)

  const gain = ctx.createGain()
  const tEnd = when + durMs / 1000
  gain.gain.setValueAtTime(0, when)
  gain.gain.linearRampToValueAtTime(vol, when + 0.006)
  gain.gain.setValueAtTime(vol * 0.85, Math.max(when + 0.007, tEnd - 0.025))
  gain.gain.exponentialRampToValueAtTime(0.0001, tEnd)
  gain.gain.setValueAtTime(0, tEnd)

  osc.connect(gain)
  gain.connect(dest ?? masterGain!)

  osc.start(when)
  osc.stop(tEnd + 0.02)
  return osc
}

/**
 * Trigger (0.0s) — Classic Pokémon "What? PET is evolving!" start SFX:
 * Rapid energy-absorption sparkle sweep followed by the iconic two-hit evolution call.
 */
export function playEvolveArpeggio(): void {
  try {
    const ctx = getEngine()
    const now = ctx.currentTime

    // 1. Energy absorption / silhouette transformation sweep (rapid 8-bit wave)
    const sweepNotes = [1046.5, 880.0, 783.99, 659.25, 523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
    sweepNotes.forEach((f, i) => {
      playChipNote(f, now + i * 0.032, 45, 'square', 0.14)
    })

    // 2. Classic two-note dramatic Pokémon evolution start sting ("dun-DUN!")
    const stingStart = now + sweepNotes.length * 0.032 + 0.03
    playChipNote(392.0, stingStart, 90, 'square', 0.18)          // G4
    playChipNote(196.0, stingStart, 90, 'triangle', 0.22)        // G3 bass
    playChipNote(587.33, stingStart + 0.1, 220, 'square', 0.18)  // D5
    playChipNote(293.66, stingStart + 0.1, 220, 'triangle', 0.22)// D4 bass
  } catch (e) {
    console.error('[sound] playEvolveArpeggio failed', e)
  }
}

let evolveDrone: { oscs: OscillatorNode[]; gain: GainNode } | null = null

/**
 * Pokémon Evolution BGM & Morph Pulses (0.5s–5.3s) —
 * Plays the iconic 8-bit alternating 16th-note ostinato (D5-G4-D5-G4 / C5-F4-C5-F4)
 * with pulsing Game Boy triangle bass and accelerating silhouette-swap chime pulses.
 */
export function startEvolveDrone(): void {
  try {
    const ctx = getEngine()
    if (evolveDrone) stopEvolveDrone(0)
    const now = ctx.currentTime

    const droneGain = ctx.createGain()
    droneGain.gain.setValueAtTime(0, now)
    droneGain.gain.linearRampToValueAtTime(1.0, now + 0.08)
    droneGain.connect(masterGain!)

    const oscs: OscillatorNode[] = []
    const stepSec = 0.095 // ~158 BPM 16th notes (iconic Pokémon evolution tempo)

    // 4 measures × 16 sixteenth-note steps = 64 steps (~6.08 seconds)
    // Measure 0: Gm/G5 ostinato (D5 ↔ G4)
    // Measure 1: F ostinato     (C5 ↔ F4)
    // Measure 2: Gm/G5 ostinato (D5 ↔ G4) + upper harmony
    // Measure 3: A/Asus ostinato (E5 ↔ A4) building tension into the climax
    const measurePatterns: Array<{ hi: number; lo: number; bass: number; harmHi?: number; harmLo?: number }> = [
      { hi: 587.33, lo: 392.00, bass: 196.00 },                                     // D5 ↔ G4, bass G3
      { hi: 523.25, lo: 349.23, bass: 174.61 },                                     // C5 ↔ F4, bass F3
      { hi: 587.33, lo: 392.00, bass: 196.00, harmHi: 783.99, harmLo: 587.33 },     // D5 ↔ G4 + G5 ↔ D5
      { hi: 659.25, lo: 440.00, bass: 220.00, harmHi: 880.00, harmLo: 659.25 },     // E5 ↔ A4 + A5 ↔ E5
    ]

    for (let m = 0; m < measurePatterns.length; m++) {
      const pat = measurePatterns[m]
      for (let s = 0; s < 16; s++) {
        const stepIdx = m * 16 + s
        const t = now + stepIdx * stepSec
        const noteFreq = s % 2 === 0 ? pat.hi : pat.lo

        // Lead 8-bit square wave ostinato
        oscs.push(playChipNote(noteFreq, t, stepSec * 820, 'square', 0.13, droneGain))

        // Upper harmony layer in second half as the silhouette morph speeds up
        if (pat.harmHi && pat.harmLo) {
          const harmFreq = s % 2 === 0 ? pat.harmHi : pat.harmLo
          oscs.push(playChipNote(harmFreq, t, stepSec * 750, 'square', 0.06, droneGain))
        }

        // Pulsing Game Boy triangle bass on every beat (every 4 steps) + offbeat octave
        if (s % 4 === 0) {
          oscs.push(playChipNote(pat.bass, t, stepSec * 240, 'triangle', 0.22, droneGain))
        } else if (s % 4 === 2) {
          oscs.push(playChipNote(pat.bass * 1.5, t, stepSec * 180, 'triangle', 0.15, droneGain))
        }
      }
    }

    // Accelerating silhouette-morph whoosh/ping pulses matching the visual swap cadence
    const morphTimesSec = [0.25, 0.85, 1.38, 1.84, 2.24, 2.58, 2.86, 3.10, 3.30, 3.48, 3.64, 3.78, 3.90, 4.02, 4.14, 4.25, 4.35, 4.45, 4.55]
    morphTimesSec.forEach((offsetSec, idx) => {
      const t = now + offsetSec
      const baseHz = 620 + idx * 32
      oscs.push(playChipNote(baseHz, t, 55, 'sine', 0.09, droneGain))
    })

    evolveDrone = { oscs, gain: droneGain }
  } catch (e) {
    console.error('[sound] startEvolveDrone failed', e)
  }
}

/** Stop the looping Pokémon evolution BGM with a smooth fade. Safe to call repeatedly. */
export function stopEvolveDrone(fadeMs = 350): void {
  if (!evolveDrone || !audioCtx) return
  const { oscs, gain } = evolveDrone
  evolveDrone = null
  try {
    const now = audioCtx.currentTime
    const tEnd = now + fadeMs / 1000
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.linearRampToValueAtTime(0, tEnd)
    for (const osc of oscs) {
      try {
        osc.stop(tEnd + 0.04)
      } catch {
        // oscillator may have already finished
      }
    }
  } catch (e) {
    console.error('[sound] stopEvolveDrone failed', e)
  }
}

/**
 * Climax (5.8s) — Classic Pokémon "Congratulations! Your PET evolved!" Fanfare:
 * Bright flash sparkle burst followed by the iconic 8-bit victory fanfare
 * (G5-G5-G5-G5 — Eb5 — F5 — G5-F5-G5!).
 */
export function playEvolveFanfare(): void {
  try {
    const ctx = getEngine()
    const now = ctx.currentTime

    // 1. Quick flash burst shimmer as the silhouette breaks into full color
    const flashNotes = [1046.5, 1318.5, 1567.98, 2093.0]
    flashNotes.forEach((f, i) => playChipNote(f, now + i * 0.025, 70, 'square', 0.1))

    // 2. Iconic Pokémon Evolution Complete Fanfare
    // Lead melody + harmony + triangle bass
    const t0 = now + 0.12
    const fanfareSteps: Array<{
      at: number
      dur: number
      lead: number
      harm: number
      bass: number
    }> = [
      // Three triplet pickups + held downbeat: "Da-da-da DAAA!"
      { at: 0.00, dur: 95,  lead: 783.99, harm: 587.33, bass: 196.00 }, // G5 + D5
      { at: 0.11, dur: 95,  lead: 783.99, harm: 587.33, bass: 196.00 }, // G5 + D5
      { at: 0.22, dur: 95,  lead: 783.99, harm: 587.33, bass: 196.00 }, // G5 + D5
      { at: 0.33, dur: 290, lead: 783.99, harm: 493.88, bass: 196.00 }, // G5 + B4 (G major)
      // "Da — da —" (bVI - bVII)
      { at: 0.65, dur: 260, lead: 622.25, harm: 466.16, bass: 155.56 }, // Eb5 + Bb4 (Eb major)
      { at: 0.94, dur: 260, lead: 698.46, harm: 523.25, bass: 174.61 }, // F5 + C5  (F major)
      // "Da-da DAAAA!" (I - bVII - I)
      { at: 1.23, dur: 160, lead: 783.99, harm: 587.33, bass: 196.00 }, // G5 + D5
      { at: 1.42, dur: 110, lead: 698.46, harm: 523.25, bass: 174.61 }, // F5 + C5
      { at: 1.55, dur: 680, lead: 783.99, harm: 493.88, bass: 196.00 }, // G5 + B4 (sustained resolution)
    ]

    for (const s of fanfareSteps) {
      const when = t0 + s.at
      playChipNote(s.lead, when, s.dur, 'square', 0.16)
      playChipNote(s.harm, when, s.dur, 'square', 0.10)
      playChipNote(s.bass, when, s.dur, 'triangle', 0.22)
    }

    // Add a warm fifth (D5) and high sparkle (G6) on the final triumphant chord
    playChipNote(587.33, t0 + 1.55, 680, 'triangle', 0.16)
    playChipNote(1567.98, t0 + 1.55, 500, 'square', 0.07)
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

// ─────────────────────────────────────────────────────────────────────────────
// Pet Alert Audio (Dog Bark & Cat Meow) — Separate Volume Control
// ─────────────────────────────────────────────────────────────────────────────

const PET_VOLUME_STORAGE_KEY = 'pet-alert-volume'

let petAlertVolume: number = (() => {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(PET_VOLUME_STORAGE_KEY) : null
    if (saved !== null) {
      const parsed = parseFloat(saved)
      if (!isNaN(parsed)) return Math.min(1, Math.max(0, parsed))
    }
  } catch {}
  return 0.7
})()

export function setPetAlertVolume(volume: number): void {
  petAlertVolume = Math.min(1, Math.max(0, volume))
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PET_VOLUME_STORAGE_KEY, petAlertVolume.toString())
    }
  } catch {}
}

export function getPetAlertVolume(): number {
  return petAlertVolume
}

/**
 * Synthesise a single dog bark burst ("arf!") at `startTime` using a vocal
 * formant bandpass + downward pitch sweep and breathy chest noise transient.
 */
function playBarkBurst(ctx: AudioContext, startTime: number, pitchScale: number, gainScale: number): void {
  const vol = petAlertVolume * gainScale
  if (vol <= 0.001) return

  const outGain = ctx.createGain()
  outGain.gain.setValueAtTime(vol, startTime)
  outGain.connect(ctx.destination)

  // Vocal cords (sawtooth through resonant vocal-tract bandpass filter)
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(220 * pitchScale, startTime)
  osc.frequency.exponentialRampToValueAtTime(380 * pitchScale, startTime + 0.035)
  osc.frequency.exponentialRampToValueAtTime(135 * pitchScale, startTime + 0.16)

  const formant = ctx.createBiquadFilter()
  formant.type = 'bandpass'
  formant.Q.setValueAtTime(2.5, startTime)
  formant.frequency.setValueAtTime(550 * pitchScale, startTime)
  formant.frequency.exponentialRampToValueAtTime(950 * pitchScale, startTime + 0.04)
  formant.frequency.exponentialRampToValueAtTime(420 * pitchScale, startTime + 0.16)

  const voxGain = ctx.createGain()
  applyEnvelope(voxGain.gain, 0.7, 8, 155, startTime)

  osc.connect(formant)
  formant.connect(voxGain)
  voxGain.connect(outGain)

  osc.start(startTime)
  osc.stop(startTime + 0.18)

  // Breathy chest transient ("woof" air burst)
  const noise = ctx.createBufferSource()
  noise.buffer = getPinkNoiseBuffer(ctx)

  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = 'bandpass'
  noiseFilter.Q.setValueAtTime(1.4, startTime)
  noiseFilter.frequency.setValueAtTime(600 * pitchScale, startTime)
  noiseFilter.frequency.exponentialRampToValueAtTime(300 * pitchScale, startTime + 0.12)

  const noiseGain = ctx.createGain()
  applyEnvelope(noiseGain.gain, 0.45, 4, 110, startTime)

  noise.connect(noiseFilter)
  noiseFilter.connect(noiseGain)
  noiseGain.connect(outGain)

  noise.start(startTime)
  noise.stop(startTime + 0.14)
}

/**
 * Play a friendly double dog bark ("arf-arf!") to alert the user when the pet
 * is losing too much HP continuously.
 */
export function playDogBark(): void {
  if (petAlertVolume <= 0.001) return
  try {
    const ctx = getEngine()
    const now = ctx.currentTime
    playBarkBurst(ctx, now, 1.0, 0.9)
    playBarkBurst(ctx, now + 0.21, 1.12, 1.0)
  } catch (e) {
    console.error('[sound] playDogBark failed', e)
  }
}

/**
 * Play a melodic cat meow ("me-ow!") with a smooth vowel formant sweep
 * ("ee" → "ah" → "oo") to alert the user when the cat is losing too much HP.
 */
export function playCatMeow(): void {
  if (petAlertVolume <= 0.001) return
  try {
    const ctx = getEngine()
    const now = ctx.currentTime
    const dur = 0.46

    const outGain = ctx.createGain()
    outGain.gain.setValueAtTime(petAlertVolume, now)
    outGain.connect(ctx.destination)

    // Fundamental voice contour: rise into "me-" then glide down into "-ow"
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(460, now)
    osc.frequency.exponentialRampToValueAtTime(720, now + 0.14)
    osc.frequency.exponentialRampToValueAtTime(650, now + 0.26)
    osc.frequency.exponentialRampToValueAtTime(390, now + dur)

    // Subtle second harmonic for warm feline nasal timbre
    const osc2 = ctx.createOscillator()
    osc2.type = 'sawtooth'
    osc2.frequency.setValueAtTime(920, now)
    osc2.frequency.exponentialRampToValueAtTime(1440, now + 0.14)
    osc2.frequency.exponentialRampToValueAtTime(1300, now + 0.26)
    osc2.frequency.exponentialRampToValueAtTime(780, now + dur)

    const harmGain = ctx.createGain()
    harmGain.gain.setValueAtTime(0.28, now)

    // Formant filter sweeping mouth opening
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.setValueAtTime(2.2, now)
    filter.frequency.setValueAtTime(1100, now)
    filter.frequency.exponentialRampToValueAtTime(1750, now + 0.15)
    filter.frequency.exponentialRampToValueAtTime(850, now + dur)

    const envGain = ctx.createGain()
    envGain.gain.setValueAtTime(0, now)
    envGain.gain.linearRampToValueAtTime(0.65, now + 0.05)
    envGain.gain.setValueAtTime(0.65, now + 0.22)
    envGain.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    envGain.gain.setValueAtTime(0, now + dur)

    osc.connect(filter)
    osc2.connect(harmGain)
    harmGain.connect(filter)
    filter.connect(envGain)
    envGain.connect(outGain)

    osc.start(now)
    osc2.start(now)
    osc.stop(now + dur + 0.02)
    osc2.stop(now + dur + 0.02)
  } catch (e) {
    console.error('[sound] playCatMeow failed', e)
  }
}

/**
 * Play the appropriate animal alert sound ('dog' → bark, 'cat' → meow).
 */
export function playPetAlertSound(species: 'dog' | 'cat'): void {
  if (species === 'cat') {
    playCatMeow()
  } else {
    playDogBark()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Graveyard Gloomy Waltz ("Fallen Down" Pixel RPG Arrangement)
// ─────────────────────────────────────────────────────────────────────────────

let graveyardBgm: {
  oscs: OscillatorNode[]
  gain: GainNode
  filter: BiquadFilterNode
  loopTimer: ReturnType<typeof setTimeout> | null
} | null = null

function playGraveNote(
  ctx: AudioContext,
  freq: number,
  when: number,
  durMs: number,
  type: OscillatorType,
  peakVol: number,
  dest: AudioNode,
  detuneCents = 0,
): OscillatorNode {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, when)
  if (detuneCents !== 0) {
    osc.detune.setValueAtTime(detuneCents, when)
  }

  const env = ctx.createGain()
  const tEnd = when + durMs / 1000
  env.gain.setValueAtTime(0, when)
  env.gain.linearRampToValueAtTime(peakVol, when + 0.015)
  env.gain.setValueAtTime(peakVol * 0.72, Math.max(when + 0.02, tEnd - 0.06))
  env.gain.exponentialRampToValueAtTime(0.0001, tEnd)
  env.gain.setValueAtTime(0, tEnd)

  osc.connect(env)
  env.connect(dest)
  osc.start(when)
  osc.stop(tEnd + 0.03)
  return osc
}

/**
 * Play a gloomy, lo-fi dusk pixel-game 3/4 waltz arrangement of "Fallen Down"
 * while the Digital Pet Graveyard is open.
 */
export function startGraveyardBGM(volumeScale = 0.5): void {
  try {
    if (graveyardBgm) stopGraveyardBGM(0)
    if (!Number.isFinite(volumeScale) || volumeScale <= 0.001) return

    const ctx = getEngine()
    const now = ctx.currentTime
    const targetVol = Math.min(1, Math.max(0.05, volumeScale)) * 0.75

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(1350, now)
    filter.Q.setValueAtTime(1.1, now)
    filter.connect(ctx.destination)

    const graveGain = ctx.createGain()
    graveGain.gain.setValueAtTime(0, now)
    graveGain.gain.linearRampToValueAtTime(targetVol, now + 0.35)
    graveGain.connect(filter)

    const state = {
      oscs: [] as OscillatorNode[],
      gain: graveGain,
      filter,
      loopTimer: null as ReturnType<typeof setTimeout> | null,
    }
    graveyardBgm = state

    const stepSec = 0.33
    const barSteps = 6
    const melodyBars: readonly (readonly number[])[] = [
      // Bar 1 (CMaj7)
      [659.25, 493.88, 659.25, 493.88, 659.25, 493.88],
      // Bar 2 (Bm7 / E7)
      [698.46, 659.25, 587.33, 523.25, 493.88, 0],
      // Bar 3 (Am7)
      [587.33, 440.00, 587.33, 440.00, 587.33, 440.00],
      // Bar 4 (G6 / C)
      [659.25, 587.33, 523.25, 493.88, 440.00, 493.88],
      // Bar 5 (Fmaj7 / Dm)
      [440.00, 329.63, 440.00, 329.63, 523.25, 493.88],
      // Bar 6 (Dm7 / G)
      [440.00, 392.00, 349.23, 329.63, 293.66, 329.63],
      // Bar 7 (Am / F)
      [349.23, 440.00, 523.25, 659.25, 587.33, 523.25],
      // Bar 8 (E7sus4 -> E7 gloomy cadence)
      [493.88, 0, 440.00, 415.30, 0, 329.63],
    ]
    const bassRoots = [130.81, 123.47, 110.00, 98.00, 87.31, 73.42, 87.31, 82.41]
    const waltzFifths = [196.00, 185.00, 164.81, 146.83, 130.81, 110.00, 130.81, 123.47]
    const loopDurationSec = melodyBars.length * barSteps * stepSec

    const scheduleIteration = (loopStartTime: number) => {
      if (graveyardBgm !== state) return
      // Discard finished oscillators before scheduling the next 15.84s cycle.
      if (state.oscs.length > 240) {
        state.oscs = state.oscs.slice(-120)
      }

      for (let m = 0; m < melodyBars.length; m++) {
        const barStart = loopStartTime + m * barSteps * stepSec
        const notes = melodyBars[m]

        // 3/4 waltz bass root on beat 1 and warm fifth/third on beats 2 & 3
        state.oscs.push(
          playGraveNote(ctx, bassRoots[m], barStart, stepSec * 520, 'triangle', 0.2, graveGain),
        )
        state.oscs.push(
          playGraveNote(ctx, waltzFifths[m], barStart + 2 * stepSec, stepSec * 360, 'triangle', 0.11, graveGain),
        )
        state.oscs.push(
          playGraveNote(ctx, waltzFifths[m], barStart + 4 * stepSec, stepSec * 360, 'triangle', 0.11, graveGain),
        )

        for (let s = 0; s < notes.length; s++) {
          const freq = notes[s]
          if (freq <= 0) continue
          const when = barStart + s * stepSec
          state.oscs.push(
            playGraveNote(ctx, freq, when, stepSec * 880, 'triangle', 0.18, graveGain),
          )
          state.oscs.push(
            playGraveNote(ctx, freq, when, stepSec * 720, 'square', 0.045, graveGain, -8),
          )
          state.oscs.push(
            playGraveNote(ctx, freq, when + 0.22, stepSec * 700, 'sine', 0.055, graveGain),
          )
        }
      }

      const nextLoopTime = loopStartTime + loopDurationSec
      const delayMs = Math.max(100, (nextLoopTime - ctx.currentTime - 0.15) * 1000)
      state.loopTimer = setTimeout(() => scheduleIteration(nextLoopTime), delayMs)
    }

    scheduleIteration(now + 0.05)
  } catch (e) {
    console.error('[sound] startGraveyardBGM failed', e)
  }
}

/** Stop the Graveyard waltz BGM with a gentle fade. Safe to call repeatedly. */
export function stopGraveyardBGM(fadeMs = 300): void {
  if (!graveyardBgm || !audioCtx) return
  const state = graveyardBgm
  graveyardBgm = null

  if (state.loopTimer !== null) {
    clearTimeout(state.loopTimer)
    state.loopTimer = null
  }

  try {
    const now = audioCtx.currentTime
    const fadeSec = Math.max(0, fadeMs) / 1000
    const tEnd = now + fadeSec
    state.gain.gain.cancelScheduledValues(now)
    state.gain.gain.setValueAtTime(state.gain.gain.value, now)
    if (fadeSec > 0) {
      state.gain.gain.linearRampToValueAtTime(0, tEnd)
    } else {
      state.gain.gain.setValueAtTime(0, now)
    }
    for (const osc of state.oscs) {
      try {
        osc.stop(tEnd + 0.04)
      } catch {
        // oscillator may have already ended
      }
    }
    setTimeout(() => {
      try {
        state.gain.disconnect()
        state.filter.disconnect()
      } catch {
        // already disconnected
      }
    }, fadeMs + 80)
  } catch (e) {
    console.error('[sound] stopGraveyardBGM failed', e)
  }
}
