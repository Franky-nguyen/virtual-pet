import asyncio
import json
import os
import time
import urllib.request
from collections import deque
from typing import Optional

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
_LEFT_SHOULDER = 11
_RIGHT_SHOULDER = 12

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


def frame_to_ratio(frame) -> Optional[float]:
    """Run MediaPipe on an OpenCV frame and return its posture ratio."""
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    result = landmarker.detect(mp_image)

    if not result.pose_landmarks:
        return None
    return calculate_posture_ratio(result.pose_landmarks[0])


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


async def broadcast_status(status: str) -> None:
    """Broadcast one of the detector's official statuses."""
    await broadcast({"status": status})


# ---------------------------------------------------------------------------
# WebSocket command handler
# ---------------------------------------------------------------------------
async def websocket_handler(websocket) -> None:
    """Handle WebSocket connections and calibration commands."""
    global calibrate_requested

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
            ratio = frame_to_ratio(frame)
            if ratio is not None:
                samples.append(ratio)

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
    """Capture frames, classify posture, and broadcast debounced statuses."""
    global current_status, last_detection_time, calibrate_requested

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FPS, 10)

    if not cap.isOpened():
        print("Warning: camera could not be opened. Broadcasting 'away'.")
    else:
        print("Camera initialized. Processing at ~10 FPS")

    print("Starting posture detection...")
    last_detection_time = time.monotonic()

    try:
        while True:
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

            ratio = frame_to_ratio(frame)
            if ratio is not None:
                last_detection_time = now
                status = classify_ratio(ratio)
            elif now - last_detection_time > AWAY_TIMEOUT_SECONDS:
                reset_smoothing()
                status = "away"
            else:
                status = current_status

            if status != current_status:
                current_status = status
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
                await broadcast_status(status)

            await asyncio.sleep(FRAME_DELAY_SECONDS)
    finally:
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
