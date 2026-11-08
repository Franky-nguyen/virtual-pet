import asyncio
import base64
import json
import math
import os
import sys
import time
import types
import urllib.request
from collections import deque
from typing import Optional

# MediaPipe's vision.drawing_utils unconditionally imports matplotlib.pyplot at
# top-level even when drawing utilities are unused. Provide a lightweight stub if
# matplotlib is not bundled so `import mediapipe` never raises ModuleNotFoundError.
try:
    import matplotlib.pyplot as _plt  # noqa: F401
except ModuleNotFoundError:
    _mpl = types.ModuleType("matplotlib")
    _plt_mod = types.ModuleType("matplotlib.pyplot")
    _mpl.pyplot = _plt_mod
    sys.modules.setdefault("matplotlib", _mpl)
    sys.modules.setdefault("matplotlib.pyplot", _plt_mod)

import cv2
import mediapipe as mp
import websockets


# ---------------------------------------------------------------------------
# Model auto-download
# ---------------------------------------------------------------------------
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "pose_landmarker/pose_landmarker_heavy/float16/1/"
    "pose_landmarker_heavy.task"
)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "pose_landmarker_heavy.task")

if not os.path.exists(MODEL_PATH):
    print(f"Model not found. Downloading from:\n  {MODEL_URL}")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print(f"Model saved to: {MODEL_PATH}")


# ---------------------------------------------------------------------------
# MediaPipe Tasks API setup
# ---------------------------------------------------------------------------
BaseOptions = mp.tasks.BaseOptions
PoseLandmarker = mp.tasks.vision.PoseLandmarker
PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

_NOSE = 0
_LEFT_EAR = 7
_RIGHT_EAR = 8
_LEFT_SHOULDER = 11
_RIGHT_SHOULDER = 12
_LEFT_HIP = 23
_RIGHT_HIP = 24

VISIBILITY_THRESHOLD = 0.5
MIN_SHOULDER_WIDTH = 1e-6

options = PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=MODEL_PATH),
    running_mode=VisionRunningMode.IMAGE,
    num_poses=1,
    min_pose_detection_confidence=0.5,
    min_tracking_confidence=0.5,
)
landmarker = PoseLandmarker.create_from_options(options)


# ---------------------------------------------------------------------------
# Debug overlay: MediaPipe drawing utilities
# ---------------------------------------------------------------------------
# The classic `solutions` drawing helpers accept the NormalizedLandmarkList
# emitted by the Tasks API PoseLandmarker. They are deprecated-but-present in
# mediapipe 0.10.x; guard the import and fall back to manual cv2 drawing so
# the debug overlay survives future mediapipe versions.
try:
    mp_drawing = mp.solutions.drawing_utils
    mp_drawing_styles = mp.solutions.drawing_styles
    POSE_CONNECTIONS = mp.solutions.pose.POSE_CONNECTIONS
except (AttributeError, NotImplementedError):
    mp_drawing = None
    mp_drawing_styles = None
    POSE_CONNECTIONS = frozenset()


# ---------------------------------------------------------------------------
# Detection and smoothing configuration
# ---------------------------------------------------------------------------
CALIBRATION_SAMPLE_COUNT = 12  # Within the requested 10-15 frame range.
CALIBRATION_TIMEOUT_SECONDS = 6.0
SLOUCH_WINDOW_SIZE = 30
# A 15% drop was too insensitive for normal webcam pose movement. A 8% drop
# catches real slouching while the 30-frame / 80% window still filters noise.
SLOUCH_RATIO_THRESHOLD = 0.92
SLOUCH_REQUIRED_FRACTION = 0.80
AWAY_TIMEOUT_SECONDS = 3.0
FRAME_DELAY_SECONDS = 0.1

# This default lets the detector operate before the first calibration. A
# successful calibration replaces it with the user's measured posture ratio.
baseline_ratio: Optional[float] = 1.0

# Only valid pose frames are added to this window. A full window is required
# before slouching can be announced, which prevents startup flashes.
slouch_frames = deque(maxlen=SLOUCH_WINDOW_SIZE)


# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
clients: set = set()
current_status = "away"
last_detection_time = 0.0
calibrate_requested = False
# Debug mode is OFF unless a client explicitly asks for it — annotated frames
# are only encoded/streamed while true, keeping CPU at ~zero in normal use.
debug_enabled = False
# Camera capture gate. Wellness Mode (UC-4) sets this False, which releases the
# VideoCapture handle — the webcam LED turns off and the device is genuinely
# unpowered, not merely ignored. Nothing re-opens it until a client re-enables.
capture_enabled = True


# ---------------------------------------------------------------------------
# Posture analysis
# ---------------------------------------------------------------------------
def calculate_posture_ratio(landmarks) -> Optional[float]:
    """Return the normalized nose-to-shoulder posture ratio.

    MediaPipe's y-coordinate increases downward, so an upright head has a
    larger positive distance from the nose to the shoulder midpoint:

        ratio = (shoulder_mid_y - nose_y) / shoulder_width_x

    Dividing by shoulder width makes the measurement substantially less
    sensitive to how close the user is to the camera.
    """
    nose = landmarks[_NOSE]
    left_shoulder = landmarks[_LEFT_SHOULDER]
    right_shoulder = landmarks[_RIGHT_SHOULDER]

    visible = (
        nose.visibility >= VISIBILITY_THRESHOLD
        and left_shoulder.visibility >= VISIBILITY_THRESHOLD
        and right_shoulder.visibility >= VISIBILITY_THRESHOLD
    )
    if not visible:
        return None

    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
    shoulder_width = abs(right_shoulder.x - left_shoulder.x)
    if shoulder_width <= MIN_SHOULDER_WIDTH:
        return None

    vertical_distance = shoulder_mid_y - nose.y
    return vertical_distance / shoulder_width


def calculate_posture(landmarks) -> Optional[str]:
    """Classify one valid pose using the smoothed 30-frame history."""
    ratio = calculate_posture_ratio(landmarks)
    if ratio is None:
        return None

    return classify_ratio(ratio)


def classify_ratio(ratio: float) -> str:
    """Add a ratio to the smoothing window and return the debounced status."""
    threshold = SLOUCH_RATIO_THRESHOLD * (
        baseline_ratio if baseline_ratio is not None else ratio
    )
    slouch_frames.append(ratio < threshold)

    # Strictly greater than 80% means at least 25 of 30 frames.
    if (
        len(slouch_frames) == SLOUCH_WINDOW_SIZE
        and sum(slouch_frames) > SLOUCH_WINDOW_SIZE * SLOUCH_REQUIRED_FRACTION
    ):
        return "slouching"

    return "good"


def reset_smoothing() -> None:
    """Forget stale posture samples after a calibration or away period."""
    slouch_frames.clear()


def frame_to_result(frame):
    """Run MediaPipe on an OpenCV frame.

    Returns (landmarks, ratio): the raw landmark list (or None when no pose
    is detected) and the computed posture ratio (or None).
    """
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    result = landmarker.detect(mp_image)

    if not result.pose_landmarks:
        return None, None
    landmarks = result.pose_landmarks[0]
    return landmarks, calculate_posture_ratio(landmarks)


def frame_to_ratio(frame) -> Optional[float]:
    """Return the posture ratio for a frame, or None if no pose was found."""
    return frame_to_result(frame)[1]


# ---------------------------------------------------------------------------
# Debug overlay rendering (streamed only while debug_enabled is true)
# ---------------------------------------------------------------------------
_DEBUG_STATUS_LABELS = {
    "good": "GOOD_POSTURE",
    "slouching": "SLOUCHING",
    "away": "AWAY / NOT VISIBLE",
    "calibrating": "CALIBRATING",
}
_DEBUG_STATUS_COLORS = {  # BGR: green = good, red = slouching, blue = calibrate
    "good": (60, 200, 60),
    "slouching": (60, 60, 220),
    "away": (130, 130, 130),
    "calibrating": (60, 160, 230),
}


def draw_landmarks_on_frame(frame_bgr, landmarks) -> None:
    """Draw pose landmarks and connections onto a BGR frame in-place."""
    if landmarks is None:
        return
    if mp_drawing is not None:
        try:
            mp_drawing.draw_landmarks(
                frame_bgr,
                landmarks,
                POSE_CONNECTIONS,
                mp_drawing_styles.get_default_pose_landmarks_style(),
                mp_drawing_styles.get_default_pose_connections_style(),
            )
            return
        except Exception:
            pass  # Fall through to the manual cv2 renderer below.
    h, w = frame_bgr.shape[:2]
    for connection in POSE_CONNECTIONS:
        a, b = connection
        if (
            landmarks[a].visibility < VISIBILITY_THRESHOLD
            or landmarks[b].visibility < VISIBILITY_THRESHOLD
        ):
            continue
        ax, ay = int(landmarks[a].x * w), int(landmarks[a].y * h)
        bx, by = int(landmarks[b].x * w), int(landmarks[b].y * h)
        cv2.line(frame_bgr, (ax, ay), (bx, by), (60, 200, 60), 1, cv2.LINE_AA)
    for lm in landmarks:
        if lm.visibility < VISIBILITY_THRESHOLD:
            continue
        x, y = int(lm.x * w), int(lm.y * h)
        cv2.circle(frame_bgr, (x, y), 2, (40, 40, 255), -1, cv2.LINE_AA)


def compute_region_scores(landmarks, ratio: Optional[float]) -> dict:
    """Compute 0-10 heuristic slouch strain scores for neck, shoulder, and lowerBack.

    Uses existing MediaPipe pose landmarks (nose, ears, shoulders, hips) and the
    posture ratio relative to ``baseline_ratio`` — no additional ML models.
    """
    if landmarks is None or ratio is None:
        return {"neck": 0.0, "shoulder": 0.0, "lowerBack": 0.0}

    left_shoulder = landmarks[_LEFT_SHOULDER]
    right_shoulder = landmarks[_RIGHT_SHOULDER]
    left_ear = landmarks[_LEFT_EAR]
    right_ear = landmarks[_RIGHT_EAR]

    dx = abs(right_shoulder.x - left_shoulder.x)
    dy = abs(right_shoulder.y - left_shoulder.y)
    if dx <= MIN_SHOULDER_WIDTH:
        return {"neck": 0.0, "shoulder": 0.0, "lowerBack": 0.0}

    base = (
        baseline_ratio
        if (baseline_ratio is not None and baseline_ratio > MIN_SHOULDER_WIDTH)
        else 1.0
    )
    ratio_deficit = max(0.0, (base - ratio) / base)

    # Shoulder tilt in degrees against horizontal
    shoulder_slope_deg = math.degrees(math.atan2(dy, dx))

    # Ear-to-shoulder vertical distance normalized by shoulder width
    shoulder_mid_x = (left_shoulder.x + right_shoulder.x) / 2.0
    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
    ear_mid_y = (left_ear.y + right_ear.y) / 2.0
    ear_shoulder_ratio = (shoulder_mid_y - ear_mid_y) / dx
    ear_deficit = max(0.0, (0.55 * base - ear_shoulder_ratio) / max(0.25 * base, 0.05))

    # Trunk lean / torso sink for lower-back slouch
    torso_sink = max(0.0, (shoulder_mid_y - 0.58) * 18.0)
    trunk_lean = 0.0
    if len(landmarks) > _RIGHT_HIP:
        left_hip = landmarks[_LEFT_HIP]
        right_hip = landmarks[_RIGHT_HIP]
        if left_hip.visibility >= 0.2 and right_hip.visibility >= 0.2:
            hip_mid_x = (left_hip.x + right_hip.x) / 2.0
            trunk_lean = (abs(shoulder_mid_x - hip_mid_x) / dx) * 12.0

    neck_score = min(10.0, max(0.0, round(ratio_deficit * 25.0 + ear_deficit * 4.5, 1)))
    shoulder_score = min(
        10.0, max(0.0, round(shoulder_slope_deg * 0.8 + ratio_deficit * 18.0, 1))
    )
    lower_back_score = min(
        10.0, max(0.0, round(ratio_deficit * 22.0 + torso_sink + trunk_lean, 1))
    )

    return {
        "neck": neck_score,
        "shoulder": shoulder_score,
        "lowerBack": lower_back_score,
    }


def compute_debug_metrics(landmarks, ratio: Optional[float]) -> dict:
    """Extra telemetry for the debug overlay (angles / distances / window)."""
    metrics: dict = {}
    if landmarks is not None:
        left_shoulder = landmarks[_LEFT_SHOULDER]
        right_shoulder = landmarks[_RIGHT_SHOULDER]
        left_ear = landmarks[_LEFT_EAR]
        right_ear = landmarks[_RIGHT_EAR]
        dx = abs(right_shoulder.x - left_shoulder.x)
        dy = abs(right_shoulder.y - left_shoulder.y)
        # Shoulder tilt measured against the horizontal, in degrees.
        metrics["shoulder_slope_deg"] = (
            round(math.degrees(math.atan2(dy, dx)), 1) if dx > MIN_SHOULDER_WIDTH else 90.0
        )
        # Vertical drop from the ear midpoint to the shoulder midpoint,
        # normalized by shoulder width so it is distance-invariant.
        shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
        ear_mid_y = (left_ear.y + right_ear.y) / 2.0
        ear_to_shoulder = shoulder_mid_y - ear_mid_y
        if dx > MIN_SHOULDER_WIDTH:
            metrics["ear_shoulder_ratio"] = round(ear_to_shoulder / dx, 4)
        metrics["shoulder_width"] = round(dx, 4)
    if ratio is not None:
        metrics["ratio"] = round(ratio, 4)
        threshold = SLOUCH_RATIO_THRESHOLD * (
            baseline_ratio if baseline_ratio is not None else ratio
        )
        metrics["threshold"] = round(threshold, 4)
        if baseline_ratio is not None:
            metrics["baseline"] = round(baseline_ratio, 4)
    region_scores = compute_region_scores(landmarks, ratio)
    metrics["neck"] = region_scores["neck"]
    metrics["shoulder"] = region_scores["shoulder"]
    metrics["lowerBack"] = region_scores["lowerBack"]
    metrics["slouch_window"] = f"{sum(slouch_frames)}/{len(slouch_frames)}"
    return metrics


def annotate_debug_frame(frame_bgr, landmarks, status: str):
    """Overlay landmarks + telemetry; return (data_url, metrics) or None."""
    annotated = frame_bgr.copy()
    draw_landmarks_on_frame(annotated, landmarks)

    label = _DEBUG_STATUS_LABELS.get(status, status.upper())
    color = _DEBUG_STATUS_COLORS.get(status, (200, 200, 200))
    cv2.putText(
        annotated, label, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA
    )

    ratio = calculate_posture_ratio(landmarks) if landmarks is not None else None
    metrics = compute_debug_metrics(landmarks, ratio)
    threshold = metrics.get("threshold")
    baseline = metrics.get("baseline")
    slope = metrics.get("shoulder_slope_deg")
    ear = metrics.get("ear_shoulder_ratio")

    line2 = f"ratio={ratio:.3f}" if ratio is not None else "ratio=n/a"
    if baseline is not None and threshold is not None:
        line2 += f"  base={baseline:.3f}  thr={threshold:.3f}"
    line3 = ""
    if slope is not None:
        line3 += f"shoulder_tilt={slope}deg"
    if ear is not None:
        line3 += f"  ear->shldr={ear:.3f}"
    line3 += f"  slouch={metrics['slouch_window']}"
    cv2.putText(
        annotated, line2, (10, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.55,
        (230, 230, 230), 1, cv2.LINE_AA,
    )
    cv2.putText(
        annotated, line3, (10, 78), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
        (200, 200, 200), 1, cv2.LINE_AA,
    )

    ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        return None
    encoded = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}", metrics


async def stream_debug_frame(frame_bgr, landmarks, status: str) -> None:
    """Broadcast one annotated debug frame (no-op unless debug is enabled)."""
    if not debug_enabled:
        return
    result = annotate_debug_frame(frame_bgr, landmarks, status)
    if result is None:
        return
    data_url, metrics = result
    await broadcast(
        {"type": "debug_frame", "status": status, "data": data_url, "metrics": metrics}
    )


# ---------------------------------------------------------------------------
# WebSocket broadcast
# ---------------------------------------------------------------------------
async def broadcast(payload: dict) -> None:
    """Broadcast a JSON payload to all connected clients."""
    if not clients:
        return

    message = json.dumps({**payload, "timestamp": time.time()})
    connected_clients = list(clients)
    results = await asyncio.gather(
        *(client.send(message) for client in connected_clients),
        return_exceptions=True,
    )

    for client, result in zip(connected_clients, results):
        if isinstance(result, Exception):
            clients.discard(client)


async def broadcast_status(status: str, scores: Optional[dict] = None) -> None:
    """Broadcast one of the detector's official statuses along with 0-10 region scores."""
    payload: dict = {"status": status}
    if scores is not None:
        payload["neck"] = scores["neck"]
        payload["shoulder"] = scores["shoulder"]
        payload["lowerBack"] = scores["lowerBack"]
        payload["scores"] = scores
    await broadcast(payload)


# ---------------------------------------------------------------------------
# WebSocket command handler
# ---------------------------------------------------------------------------
async def websocket_handler(websocket) -> None:
    """Handle WebSocket connections and calibration commands."""
    global calibrate_requested, debug_enabled, capture_enabled

    clients.add(websocket)
    print(f"Client connected. Total clients: {len(clients)}")

    try:
        async for raw in websocket:
            try:
                message = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                continue

            if isinstance(message, dict) and message.get("command") == "calibrate":
                print("Calibration requested by client.")
                calibrate_requested = True
            elif isinstance(message, dict) and message.get("command") == "debug":
                debug_enabled = bool(message.get("enabled", False))
                print(f"Debug streaming {'enabled' if debug_enabled else 'disabled'}.")
            elif isinstance(message, dict) and message.get("command") == "capture":
                # UC-4: release the camera outright in Wellness Mode. The main
                # loop closes the handle on its next tick, so the device stops
                # being powered rather than just being ignored.
                enabled = bool(message.get("enabled", True))
                if enabled != capture_enabled:
                    capture_enabled = enabled
                    print(
                        "Camera capture enabled." if enabled
                        else "Camera capture disabled — webcam released."
                    )
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)
        print(f"Client disconnected. Total clients: {len(clients)}")


# ---------------------------------------------------------------------------
# Calibration
# ---------------------------------------------------------------------------
async def run_calibration(cap) -> bool:
    """Average the next 12 valid posture ratios and save the baseline."""
    global baseline_ratio, current_status

    current_status = "calibrating"
    reset_smoothing()
    await broadcast_status("calibrating")
    print(
        "Starting calibration — hold your ideal posture "
        f"for {CALIBRATION_SAMPLE_COUNT} valid frames..."
    )

    samples: list[float] = []
    deadline = time.monotonic() + CALIBRATION_TIMEOUT_SECONDS

    while len(samples) < CALIBRATION_SAMPLE_COUNT and time.monotonic() < deadline:
        ret, frame = cap.read()
        if ret:
            landmarks, ratio = frame_to_result(frame)
            if ratio is not None:
                samples.append(ratio)
            if debug_enabled:
                await stream_debug_frame(frame, landmarks, "calibrating")

        await broadcast_status("calibrating")
        await asyncio.sleep(FRAME_DELAY_SECONDS)

    if len(samples) < CALIBRATION_SAMPLE_COUNT:
        print(
            "Calibration failed: only "
            f"{len(samples)} of {CALIBRATION_SAMPLE_COUNT} valid frames detected."
        )
        current_status = "away"
        await broadcast_status("away")
        return False

    baseline_ratio = sum(samples) / len(samples)
    reset_smoothing()
    current_status = "good"
    print(
        f"Calibration complete. {len(samples)} samples. "
        f"baseline_ratio={baseline_ratio:.4f}"
    )
    await broadcast_status("good")
    return True


# ---------------------------------------------------------------------------
# Main detection loop
# ---------------------------------------------------------------------------
async def posture_detection_loop() -> None:
    """Capture frames, classify posture, and broadcast debounced statuses.

    The camera handle is owned by this loop and only exists while
    ``capture_enabled`` is true. Wellness Mode flips that flag off, which closes
    the handle so the webcam hardware is released (LED off) rather than merely
    ignored.
    """
    global current_status, last_detection_time, calibrate_requested, capture_enabled

    cap = None
    last_detection_time = time.monotonic()
    last_slouch_score_broadcast = 0.0

    print("Starting posture detection...")

    try:
        while True:
            # ── Camera gate (UC-4: Wellness Mode keeps the device unpowered) ──
            if not capture_enabled:
                if cap is not None:
                    cap.release()
                    del cap
                    cap = None
                    import gc
                    gc.collect()
                    reset_smoothing()
                    print("Camera released. Wellness Mode is active.")
                    if current_status != "away":
                        current_status = "away"
                        await broadcast_status("away")
                await asyncio.sleep(0.5)
                continue

            # Lazy open: only allocate the device once capture is actually on.
            # Request compact 320x240 frames and a 1-frame buffer to minimize
            # RAM and CPU usage (MediaPipe internally downscales to 256x256).
            if cap is None:
                cap = cv2.VideoCapture(0)
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
                cap.set(cv2.CAP_PROP_FPS, 10)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                last_detection_time = time.monotonic()
                if not cap.isOpened():
                    print("Warning: camera could not be opened. Broadcasting 'away'.")
                else:
                    print("Camera initialized (320x240 low-resource mode).")

            if calibrate_requested:
                calibrate_requested = False
                await run_calibration(cap)

            ret, frame = cap.read()
            now = time.monotonic()

            if not ret:
                if now - last_detection_time > AWAY_TIMEOUT_SECONDS:
                    reset_smoothing()
                    status = "away"
                else:
                    status = current_status
                await asyncio.sleep(FRAME_DELAY_SECONDS)
                if status != current_status:
                    current_status = status
                    print(f"Posture status: {status}")
                    await broadcast_status(status)
                continue

            landmarks, ratio = frame_to_result(frame)
            if ratio is not None:
                last_detection_time = now
                status = classify_ratio(ratio)
            elif now - last_detection_time > AWAY_TIMEOUT_SECONDS:
                reset_smoothing()
                status = "away"
            else:
                status = current_status

            if debug_enabled:
                await stream_debug_frame(frame, landmarks, status)

            if status != current_status:
                current_status = status
                last_slouch_score_broadcast = now
                scores = compute_region_scores(landmarks, ratio)
                if ratio is not None:
                    threshold = SLOUCH_RATIO_THRESHOLD * (
                        baseline_ratio if baseline_ratio is not None else ratio
                    )
                    print(
                        f"Posture status: {status} | ratio={ratio:.3f} "
                        f"threshold={threshold:.3f} "
                        f"slouch_frames={sum(slouch_frames)}/{len(slouch_frames)}"
                    )
                else:
                    print(f"Posture status: {status}")
                await broadcast_status(status, scores)
            elif status == "slouching" and (now - last_slouch_score_broadcast) >= 1.0:
                last_slouch_score_broadcast = now
                scores = compute_region_scores(landmarks, ratio)
                await broadcast_status(status, scores)

            await asyncio.sleep(FRAME_DELAY_SECONDS)
    finally:
        if cap is not None:
            cap.release()


async def main() -> None:
    """Start the WebSocket server and posture detector."""
    print("PosturePet Detector Starting...")
    print("WebSocket server: ws://localhost:8765")

    async with websockets.serve(websocket_handler, "localhost", 8765):
        await posture_detection_loop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPosturePet Detector stopped.")
