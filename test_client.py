"""
Test WebSocket client to verify posture detection server.
Run this in a separate terminal while detector.py is running.
"""
import asyncio
import websockets
import json


async def test_client():
    uri = "ws://localhost:8765"
    print(f"Connecting to {uri}...")

    try:
        async with websockets.connect(uri) as websocket:
            print("✅ Connected to posture detection server")
            print("Listening for posture updates...\n")

            while True:
                message = await websocket.recv()
                data = json.loads(message)

                status = data['status']
                timestamp = data['timestamp']

                # Color-coded output
                if status == 'good':
                    emoji = "✅"
                elif status == 'slouching':
                    emoji = "⚠️"
                else:
                    emoji = "👀"

                print(f"{emoji} Status: {status.upper()} (timestamp: {timestamp:.2f})")

    except ConnectionRefusedError:
        print("❌ Connection refused. Is detector.py running?")
    except KeyboardInterrupt:
        print("\n👋 Disconnected")


if __name__ == "__main__":
    asyncio.run(test_client())
