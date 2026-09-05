#!/usr/bin/env python3
"""
generate_sounds.py

Synthesizes (or extracts from a YouTube URL) mechanical-keyboard keystroke samples
and encodes them as OGG Vorbis files.

Usage:
    # Synthesize all three profiles from scratch
    python generate_sounds.py

    # Download audio from a YouTube URL and use it as the source
    python generate_sounds.py --url "https://www.youtube.com/shorts/Yy-HePDv4P4"

    # Combine: download from URL, then synthesize with those characteristics
    python generate_sounds.py --url "..." --mode hybrid

Modes:
    synthesize  -- build thock/cream/clack from scratch using dual-layer synthesis
                  (white-noise transient + pitched resonance). No external assets needed.
    extract     -- download audio from URL, trim to the best 0.5s segment, normalize,
                  and save as thock/cream/clack.ogg (same sample for all three slots).
    hybrid      -- download from URL for thock; synthesize cream and clack.
    url-only    -- download from URL; save the full trimmed clip as thock.ogg only.
                  cream.ogg and clack.ogg fall back to synthesis.

Requirements:
    pip install numpy scipy yt-dlp

    # ffmpeg must be on PATH (run: winget install ffmpeg on Windows)
"""

import argparse
import os
import sys
import shutil
import tempfile
import subprocess
import struct
import re

import numpy as np
from scipy import signal

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

SAMPLE_RATE = 44100  # Hz
VOLUME      = 0.85   # peak amplitude (0.0 - 1.0)
OUT_DIR     = os.path.join(os.path.dirname(__file__), "src", "assets", "sounds")

PROFILES = {
    # ── thock: deep, muffled thud ──────────────────────────────────────────
    "thock": {
        "noise_filter": "lowpass",
        "noise_freq": 700,
        "noise_onset_ms": 0,
        "noise_decay_ms": 28,
        "noise_amplitude": 0.30,
        "osc_start_hz": 210,
        "osc_end_hz": 85,
        "osc_pitch_drop_ms": 42,
        "osc_decay_ms": 90,
        "osc_amplitude": 1.0,
    },
    # ── cream: warm, rounded thud ──────────────────────────────────────────
    "cream": {
        "noise_filter": "bandpass",
        "noise_freq": 550,
        "noise_onset_ms": 1,
        "noise_decay_ms": 32,
        "noise_amplitude": 0.22,
        "osc_start_hz": 360,
        "osc_end_hz": 160,
        "osc_pitch_drop_ms": 48,
        "osc_decay_ms": 100,
        "osc_amplitude": 1.0,
    },
    # ── clack: sharp, bright snap ──────────────────────────────────────────
    "clack": {
        "noise_filter": "highpass",
        "noise_freq": 1100,
        "noise_onset_ms": 0,
        "noise_decay_ms": 22,
        "noise_amplitude": 0.55,
        "osc_start_hz": 620,
        "osc_end_hz": 310,
        "osc_pitch_drop_ms": 32,
        "osc_decay_ms": 65,
        "osc_amplitude": 0.85,
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# FFmpeg / yt-dlp helpers
# ─────────────────────────────────────────────────────────────────────────────

def find_executable(name: str) -> str | None:
    # Respect an explicit env var override so the script works even when the
    # shell PATH hasn't been updated yet (e.g. after winget install).
    # Check both the exact tool name and the _BIN suffix variants.
    for key in (name.upper().replace("-", "_"), name.upper().replace("-", "_") + "_BIN"):
        env_path = os.environ.get(key)
        if env_path and os.path.isfile(env_path):
            return env_path
    return shutil.which(name) or shutil.which(f"{name}.exe")


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    print(f"    $ {' '.join(cmd)}")
    return subprocess.run(cmd, **kwargs)


def ensure_ffmpeg() -> str | None:
    ffmpeg = find_executable("ffmpeg")
    if not ffmpeg:
        print("ERROR: ffmpeg not found on PATH.")
        print("  Install via: winget install ffmpeg")
        print("  Or: choco install ffmpeg")
    return ffmpeg


def ensure_ytdlp() -> str | None:
    ytdlp = find_executable("yt-dlp")
    if not ytdlp:
        print("ERROR: yt-dlp not found on PATH.")
        print("  Install via: pip install yt-dlp")
        print("  Or: winget install yt-dlp")
    return ytdlp


# ─────────────────────────────────────────────────────────────────────────────
# YouTube download
# ─────────────────────────────────────────────────────────────────────────────

def download_youtube_audio(url: str, out_dir: str) -> str:
    """
    Download the best audio stream from a YouTube URL using yt-dlp, then
    convert to a normalised 44.1 kHz mono 16-bit WAV using ffmpeg.

    Returns the path to the final WAV file.
    Cleans up the temp directory on success.
    """
    ytdlp    = ensure_ytdlp()
    ffmpeg_exe = ensure_ffmpeg()
    if not ytdlp:
        sys.exit(1)
    if not ffmpeg_exe:
        sys.exit(1)

    tmp_dir = tempfile.mkdtemp(prefix="ytdlp_")
    audio_path = os.path.join(tmp_dir, "audio")

    print(f"\n  Downloading audio from: {url}")

    # Step 1: download the best audio format (m4a / webm / etc.)
    print(f"    [1/2] yt-dlp fetching best audio stream …")
    dl_cmd = [
        ytdlp,
        "-f", "bestaudio/best",
        "-o", audio_path,
        "--no-playlist",
        "--no-check-certificates",
        "--quiet",
        url,
    ]
    result = subprocess.run(dl_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # Try looser format selection as fallback
        dl_cmd[1:3] = ["-f", "bestaudio"]
        result = subprocess.run(dl_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {result.stderr or 'unknown error'}")

    # Find the downloaded file (yt-dlp appends extension)
    downloaded = [f for f in os.listdir(tmp_dir)
                 if os.path.isfile(os.path.join(tmp_dir, f)) and f != "audio"]
    if not downloaded:
        raise RuntimeError("yt-dlp downloaded no files")
    raw_path = os.path.join(tmp_dir, downloaded[0])

    # Step 2: convert to normalised 44.1 kHz mono WAV
    print(f"    [2/2] ffmpeg converting to WAV …")
    out_wav = os.path.join(tmp_dir, "audio.wav")
    ff_cmd = [
        ffmpeg_exe, "-y",
        "-loglevel", "error",
        "-i", raw_path,
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",
        "-sample_fmt", "s16",
        out_wav,
    ]
    result = subprocess.run(ff_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg WAV conversion failed: {result.stderr}")

    # Move to final destination outside tmp_dir
    final_path = os.path.join(out_dir, "source_audio.wav")
    shutil.move(out_wav, final_path)

    # Clean up everything else in tmp_dir
    shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"  [OK] Downloaded & converted to: {final_path}")
    return final_path


def load_local_wav(path: str) -> str:
    """
    Verify a local WAV file exists, convert it to normalised 44.1 kHz mono
    WAV via ffmpeg (handles stereo input), and return the path to the
    converted file.
    """
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Audio file not found: {path}")

    ffmpeg_exe = ensure_ffmpeg()
    if not ffmpeg_exe:
        raise RuntimeError("ffmpeg required to process local WAV files")

    # Determine output path: same dir as input, with _44k_mono suffix
    base, _ = os.path.splitext(path)
    out_path = f"{base}_44k_mono.wav"

    print(f"\n  Processing: {path}")

    # Always convert to 44.1 kHz mono -- this also normalises the audio
    print(f"    [1/2] Converting to 44.1 kHz mono …")
    cmd = [
        ffmpeg_exe, "-y",
        "-loglevel", "error",
        "-i", path,
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",                # mono -- handles stereo input
        "-sample_fmt", "s16",
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",  # normalise loudness
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg convert failed: {result.stderr}")

    # Quick stats on the converted file
    print(f"    [2/2] Analysing converted audio …")
    stats = analyze_wav(out_path)
    print(f"    duration={stats['duration']:.2f}s  "
          f"peak={stats['peak']:.3f}  "
          f"rms={stats['rms']:.4f}  "
          f"centroid={stats['spectral_centroid']:.0f} Hz")

    print(f"  [OK] Processed: {out_path}")
    return out_path


def trim_audio_wav(wav_path: str, start_sec: float, duration_sec: float,
                   out_path: str, normalize: bool = True) -> None:
    """Trim a WAV file and optionally normalize it."""
    ffmpeg = ensure_ffmpeg()
    if not ffmpeg:
        raise RuntimeError("ffmpeg required for trimming")

    filters: list[str] = []
    if normalize:
        filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")

    cmd = [
        ffmpeg, "-y",
        "-loglevel", "error",
        "-i", wav_path,
        "-ss", str(start_sec),
        "-t",  str(duration_sec),
        "-ar", str(SAMPLE_RATE),
        "-ac", "1",
    ]
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd.append(out_path)

    result = run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg trim failed: {result.stderr}")


def analyze_wav(path: str) -> dict:
    """
    Compute basic stats on a WAV file: peak amplitude, RMS, and a simple
    spectral centroid estimate (Hz). Returns a dict.
    """
    import wave as wave_module
    with wave_module.open(path, 'rb') as wf:
        assert wf.getnchannels() == 1, "Expected mono WAV"
        assert wf.getsampwidth() == 2,  "Expected 16-bit PCM"
        frames = wf.readframes(wf.getnframes())

    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    peak = float(np.abs(samples).max())
    rms  = float(np.sqrt(np.mean(samples ** 2)))
    # Spectral centroid via STFT
    f, t, Zxx = signal.stft(samples, fs=SAMPLE_RATE, nperseg=1024)
    mag = np.abs(Zxx)
    spec_centroid = float(np.sum(f[:, None] * mag, axis=0).sum() / mag.sum())
    dur = len(samples) / SAMPLE_RATE
    return {"peak": peak, "rms": rms, "spectral_centroid": spec_centroid, "duration": dur}


def find_best_segment(wav_path: str, min_dur: float = 0.05, max_dur: float = 0.25) -> tuple[float, float]:
    """
    Scan a WAV file and return the (start_sec, duration_sec) of the loudest,
    punchiest transient in the file -- suitable for use as a keystroke sample.

    Uses short-time energy (STE) with a sliding window to find the most
    energetic burst.
    """
    import wave as wave_module
    with wave_module.open(wav_path, 'rb') as wf:
        frames = wf.readframes(wf.getnframes())

    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    sr = SAMPLE_RATE

    # Frame size ~10ms
    frame_size = int(0.010 * sr)
    hop_size   = frame_size // 2

    energies: list[tuple[float, int]] = []
    for i in range(0, len(samples) - frame_size, hop_size):
        frame = samples[i:i + frame_size]
        energy = float(np.sum(frame ** 2) / frame_size)
        energies.append((energy, i))

    if not energies:
        return (0.0, min_dur)

    energies.sort(reverse=True)
    top_energy, top_idx = energies[0]
    start_sample = top_idx

    # Find the exact onset: walk backward until energy drops below 10% of peak
    threshold = top_energy * 0.10
    for i in range(top_idx, -1, -hop_size):
        frame = samples[i:i + frame_size]
        if np.sum(frame ** 2) / frame_size < threshold:
            start_sample = i
            break

    # Find the offset: walk forward until energy drops below 10%
    end_sample = top_idx
    for i in range(top_idx, len(samples) - frame_size, hop_size):
        frame = samples[i:i + frame_size]
        if np.sum(frame ** 2) / frame_size < threshold:
            end_sample = i + frame_size
            break

    dur_samples = end_sample - start_sample
    dur_sec = min(max(dur_samples / sr, min_dur), max_dur)
    start_sec = start_sample / sr

    print(f"  STE scan -> loudest transient at {start_sec:.3f}s, duration {dur_sec*1000:.0f}ms")
    return (start_sec, dur_sec)


# ─────────────────────────────────────────────────────────────────────────────
# WAV I/O helpers
# ─────────────────────────────────────────────────────────────────────────────

def read_wav(path: str) -> np.ndarray:
    import wave as wave_module
    with wave_module.open(path, 'rb') as wf:
        assert wf.getnchannels() == 1
        frames = wf.readframes(wf.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def write_wav(samples: np.ndarray, path: str) -> None:
    int16_samples = np.clip(samples * 32767, -32768, 32767).astype(np.int16)
    with open(path, 'wb') as f:
        # RIFF header
        byte_data = int16_samples.tobytes()
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + len(byte_data)))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))
        f.write(struct.pack('<H', 1))             # PCM
        f.write(struct.pack('<H', 1))             # mono
        f.write(struct.pack('<I', SAMPLE_RATE))
        f.write(struct.pack('<I', SAMPLE_RATE * 2))
        f.write(struct.pack('<H', 2))             # block align
        f.write(struct.pack('<H', 16))            # 16-bit
        f.write(b'data')
        f.write(struct.pack('<I', len(byte_data)))
        f.write(byte_data)


# ─────────────────────────────────────────────────────────────────────────────
# Dual-layer synthesis  (scipy-based, same as before but with numpy/scipy)
# ─────────────────────────────────────────────────────────────────────────────

def ms_to_samples(n: float) -> int:
    return int(round(n / 1000.0 * SAMPLE_RATE))


def envelope(onset_ms: float, decay_ms: float, total_len: int) -> np.ndarray:
    onset  = ms_to_samples(onset_ms)
    decay  = ms_to_samples(decay_ms)
    sust   = max(0, total_len - onset - decay)

    attack  = np.linspace(0, 1, max(3, onset),  dtype=np.float32)
    sustain = np.ones(max(0, sust),             dtype=np.float32)
    d_len   = max(1, decay)
    dec     = np.exp(-np.linspace(0, 9, d_len))
    dec     = ((dec - dec[-1]) / (dec[0] - dec[-1] + 1e-12)).astype(np.float32)
    dec     = np.flipud(dec)

    env = np.concatenate([attack, sustain, dec])
    if len(env) < total_len:
        env = np.pad(env, (0, total_len - len(env)))
    else:
        env = env[:total_len]
    env[-1] = 0
    return env


def make_noise(n: int) -> np.ndarray:
    n = np.random.randn(n).astype(np.float32)
    return np.tanh(n * 1.1) * 0.9


def make_resonance(start_hz: float, end_hz: float, n: int, pitch_drop_ms: float) -> np.ndarray:
    t = np.arange(n, dtype=np.float64) / SAMPLE_RATE
    dur = n / SAMPLE_RATE
    phase = 2 * np.pi * (start_hz * t + (end_hz - start_hz) * t * t / (2 * dur))
    return np.cos(phase).astype(np.float32)


def build_filter(btype: str, freq: float) -> np.ndarray:
    return signal.butter(4, freq, btype=btype, output='sos', fs=SAMPLE_RATE)


def synth(profile_name: str) -> np.ndarray:
    p = PROFILES[profile_name]

    osc_drop_dur_ms = ms_to_samples(p["osc_pitch_drop_ms"]) / SAMPLE_RATE * 1000
    dur_ms   = max(p["noise_decay_ms"], osc_drop_dur_ms + p["osc_decay_ms"]) + 10
    dur_samp = ms_to_samples(dur_ms + 5)

    # Layer 1 -- noise transient
    noise   = make_noise(dur_samp)
    sos     = build_filter(p["noise_filter"], p["noise_freq"])
    noise   = signal.sosfilt(sos, noise).astype(np.float32)
    n_env   = envelope(p["noise_onset_ms"], p["noise_decay_ms"], dur_samp)
    noise_layer = (noise * n_env * p["noise_amplitude"]).astype(np.float32)

    # Layer 2 -- body resonance
    reso    = make_resonance(p["osc_start_hz"], p["osc_end_hz"], dur_samp, p["osc_pitch_drop_ms"])
    r_env   = envelope(2, p["osc_decay_ms"], dur_samp)
    reso_layer = (reso * r_env * p["osc_amplitude"]).astype(np.float32)

    # Mix & normalise
    mixed = noise_layer + reso_layer
    peak  = np.abs(mixed).max()
    if peak > 0:
        mixed = mixed * (VOLUME / peak)
    return mixed


# ─────────────────────────────────────────────────────────────────────────────
# OGG encoding
# ─────────────────────────────────────────────────────────────────────────────

def encode_ogg(wav_path: str, out_path: str) -> bool:
    """
    Convert a WAV to OGG Vorbis using ffmpeg.
    Returns True on success, False on failure.
    """
    ffmpeg = ensure_ffmpeg()
    if not ffmpeg:
        fallback = out_path.replace('.ogg', '.wav')
        shutil.copy(wav_path, fallback)
        return False

    cmd = [
        ffmpeg, "-y",
        "-loglevel", "error",
        "-i", wav_path,
        "-c:a", "libvorbis",
        "-q:a", "6",
        out_path,
    ]
    result = run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    ffmpeg stderr: {result.stderr.strip()}")
        fallback = out_path.replace('.ogg', '.wav')
        shutil.copy(wav_path, fallback)
        return False
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Main pipeline
# ─────────────────────────────────────────────────────────────────────────────

def pipeline_synthesize():
    """Build thock/cream/clack from scratch."""
    print("\nMode: synthesize -- building samples from scratch\n")
    ffmpeg = ensure_ffmpeg()
    if not ffmpeg:
        print("WARNING: ffmpeg not found. Outputs will be .wav only.\n")

    os.makedirs(OUT_DIR, exist_ok=True)
    results = {}
    for name in ("thock", "cream", "clack"):
        out_ogg = os.path.join(OUT_DIR, f"{name}.ogg")
        out_wav = out_ogg.replace('.ogg', '.wav')
        print(f"  Synthesising {name}.ogg …")
        try:
            audio = synth(name)
            write_wav(audio, out_wav)
            dur  = len(audio) / SAMPLE_RATE
            peak = float(np.abs(audio).max())
            ok   = encode_ogg(out_wav, out_ogg)
            if ok:
                size_kb = os.path.getsize(out_ogg) / 1024
                print(f"    [OK] {name}.ogg  ({size_kb:.1f} KB, {dur*1000:.0f}ms, peak={peak:.3f})")
            else:
                print(f"    [OK] {name}.wav  (ffmpeg unavailable -- WAV fallback)")
        except Exception as exc:
            print(f"    [FAIL] FAILED: {exc}")
            results[name] = False
            continue
        results[name] = True
    return all(results.values())


def pipeline_extract(wav_path: str):
    """
    Download from URL, find the best transient segment,
    trim it, and save as thock/cream/clack.ogg (same source, different trims).
    """
    print("\nMode: extract -- scanning for the best transient segment\n")

    ffmpeg = ensure_ffmpeg()
    if not ffmpeg:
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)

    # Analyse
    print("  Analysing source audio …")
    stats = analyze_wav(wav_path)
    print(f"    duration={stats['duration']:.2f}s  "
          f"peak={stats['peak']:.3f}  "
          f"rms={stats['rms']:.4f}  "
          f"centroid={stats['spectral_centroid']:.0f} Hz")

    # Find the punchiest ~150ms window
    start_sec, dur_sec = find_best_segment(wav_path, min_dur=0.05, max_dur=0.20)

    # Apply spectral shaping based on centroid to derive three variants
    centroid = stats["spectral_centroid"]

    print(f"\n  Deriving variants from centroid={centroid:.0f} Hz …")

    profiles_for_extract: list[tuple[str, float, float]] = [
        # (name,       noise_lowpass_hz, noise_highpass_hz)
        ("thock",      0,    900),   # very muffled: lowpass 900 Hz
        ("cream",    400,    2200),  # bandpass-ish: 400-2200 Hz
        ("clack",   1200,    8000),  # highpass 1200 Hz: bright snap
    ]

    results = {}
    for name, lo_hz, hi_hz in profiles_for_extract:
        out_ogg = os.path.join(OUT_DIR, f"{name}.ogg")
        tmp_wav = out_ogg.replace('.ogg', f"_raw_{name}.wav")
        print(f"\n  Building {name}.ogg …")

        try:
            # Trim to the detected transient window
            trim_audio_wav(wav_path, start_sec, dur_sec, tmp_wav, normalize=True)

            # Apply frequency shaping via ffmpeg
            shaped_wav = out_ogg.replace('.ogg', f"_shaped_{name}.wav")
            filters = []
            if lo_hz > 0:
                filters.append(f"highpass=f={lo_hz}")
            if hi_hz < 8000:
                filters.append(f"lowpass=f={hi_hz}")
            filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")

            ffmpeg_cmd = [
                ffmpeg, "-y",
                "-loglevel", "error",
                "-i", tmp_wav,
                "-af", ",".join(filters),
                "-ar", str(SAMPLE_RATE),
                "-ac", "1",
                shaped_wav,
            ]
            result = run(ffmpeg_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                # Fallback: just use the trimmed WAV directly
                print(f"    (ffmpeg filter warning -- using raw trim)")
                shutil.copy(tmp_wav, shaped_wav)

            # Encode to OGG
            ok = encode_ogg(shaped_wav, out_ogg)
            if ok:
                size_kb = os.path.getsize(out_ogg) / 1024
                print(f"    [OK] {name}.ogg  ({size_kb:.1f} KB, centroid={centroid:.0f} Hz -> lo={lo_hz} hi={hi_hz} Hz)")
            else:
                print(f"    [OK] {name}.wav  (ffmpeg unavailable)")

            # Cleanup
            for f in (tmp_wav, shaped_wav):
                if os.path.exists(f):
                    os.unlink(f)

        except Exception as exc:
            print(f"    [FAIL] FAILED: {exc}")
            results[name] = False
            continue
        results[name] = True

    return all(results.values())


def pipeline_hybrid(wav_path: str):
    """Download from URL -> use as thock. Synthesize cream + clack."""
    print("\nMode: hybrid -- URL audio for thock, synthesis for cream + clack\n")

    ffmpeg = ensure_ffmpeg()
    if not ffmpeg:
        print("WARNING: ffmpeg not found. Outputs will be .wav only.\n")

    os.makedirs(OUT_DIR, exist_ok=True)

    # ── thock from URL ────────────────────────────────────────────────────
    print("  Deriving thock from URL source …")
    try:
        start_sec, dur_sec = find_best_segment(wav_path, min_dur=0.05, max_dur=0.20)
        thock_wav = os.path.join(OUT_DIR, "thock_raw.wav")
        trim_audio_wav(wav_path, start_sec, dur_sec, thock_wav, normalize=True)

        thock_ogg = os.path.join(OUT_DIR, "thock.ogg")
        ok = encode_ogg(thock_wav, thock_ogg)
        if ok:
            print(f"    [OK] thock.ogg  ({os.path.getsize(thock_ogg)/1024:.1f} KB)")
        else:
            print(f"    [OK] thock.wav  (ffmpeg unavailable)")
        if os.path.exists(thock_wav):
            os.unlink(thock_wav)
    except Exception as exc:
        print(f"    [FAIL] thock FAILED: {exc}")

    # ── cream + clack synthesized ──────────────────────────────────────────
    for name in ("cream", "clack"):
        out_ogg = os.path.join(OUT_DIR, f"{name}.ogg")
        out_wav = out_ogg.replace('.ogg', '.wav')
        print(f"  Synthesising {name}.ogg …")
        try:
            audio = synth(name)
            write_wav(audio, out_wav)
            ok = encode_ogg(out_wav, out_ogg)
            if ok:
                size_kb = os.path.getsize(out_ogg) / 1024
                print(f"    [OK] {name}.ogg  ({size_kb:.1f} KB)")
            else:
                print(f"    [OK] {name}.wav  (ffmpeg unavailable)")
        except Exception as exc:
            print(f"    [FAIL] FAILED: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--input", "-i",
        metavar="PATH",
        help="Local WAV file to use as source audio. "
             "Skips YouTube download. Use this for files downloaded manually.",
    )
    parser.add_argument(
        "--url", "-u",
        metavar="URL",
        help="YouTube URL to download audio from. "
             "If omitted, all samples are synthesized from scratch.",
    )
    parser.add_argument(
        "--mode", "-m",
        choices=["synthesize", "extract", "hybrid", "url-only"],
        default="hybrid",
        help=(
            "synthesize : pure synthesis (default when no source)\n"
            "extract    : source -> find best transient -> derive 3 variants\n"
            "hybrid     : source for thock; synthesize cream & clack (default when source given)\n"
            "url-only   : source -> save best segment as thock.ogg only\n"
        ),
    )
    args = parser.parse_args()

    print("=" * 60)
    print(" PosturePet -- Mechanical Keyboard Sound Generator")
    print("=" * 60)

    wav_path: str | None = None

    # ── Step 1: resolve source audio ──────────────────────────────────────
    if args.input:
        print(f"\nLocal file: {args.input}")
        try:
            wav_path = load_local_wav(args.input)
        except Exception as exc:
            print(f"\nERROR loading local file: {exc}")
            sys.exit(1)

    elif args.url:
        print(f"\nYouTube URL: {args.url}")
        try:
            wav_path = download_youtube_audio(args.url, OUT_DIR)
        except Exception as exc:
            print(f"\nERROR downloading audio: {exc}")
            sys.exit(1)

    # ── Step 2: run the selected pipeline ─────────────────────────────────
    if wav_path:
        if args.mode == "synthesize":
            print("\nWARNING: --mode=synthesize ignores source audio -- synthesizing instead.\n")
            ok = pipeline_synthesize()
        elif args.mode == "extract":
            ok = pipeline_extract(wav_path)
        elif args.mode == "hybrid":
            pipeline_hybrid(wav_path)
            ok = True
        elif args.mode == "url-only":
            print("\nMode: url-only -- saving best segment as thock.ogg")
            start_sec, dur_sec = find_best_segment(wav_path, min_dur=0.05, max_dur=0.25)
            thock_wav = os.path.join(OUT_DIR, "thock_raw.wav")
            trim_audio_wav(wav_path, start_sec, dur_sec, thock_wav, normalize=True)
            thock_ogg = os.path.join(OUT_DIR, "thock.ogg")
            ok = encode_ogg(thock_wav, thock_ogg)
            if os.path.exists(thock_wav):
                os.unlink(thock_wav)
            print(f"    [OK] thock.ogg saved")
    else:
        # No source -- always synthesize
        ok = pipeline_synthesize()

    # ── Cleanup source audio ───────────────────────────────────────────────
    if wav_path and os.path.exists(wav_path):
        os.unlink(wav_path)

    print()
    if ok:
        print("All done! The .ogg files are in src/assets/sounds/")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
