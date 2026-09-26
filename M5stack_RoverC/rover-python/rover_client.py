from __future__ import annotations

import argparse
import json
import random
import time

from rover.api import RoverAPI, RoverAPIError, discover_rovers
from rover.config import app_settings
from rover.control import RoverController
from rover.models import ControlInput

MIN_SPEED = -40
MAX_SPEED = 40
MIN_DURATION_MS = 50
MAX_DURATION_MS = 1000


def main() -> int:
    parser = argparse.ArgumentParser(description="RoverC Pro Wi-Fi diagnostic client")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("discover", help="Find RoverC Pro on the local network")
    commands.add_parser("status", help="Show M5StickC Plus2 status")
    commands.add_parser("stop", help="Stop and DISARM immediately")
    pulse = commands.add_parser("pulse", help="Run a short diagnostic motor pulse")
    pulse.add_argument("--speed", type=int, default=20)
    pulse.add_argument("--duration", type=int, default=500)
    pulse.add_argument(
        "--confirm-wheels-raised",
        action="store_true",
        help="Required safety confirmation; all wheels must be clear of the floor",
    )
    motor = commands.add_parser(
        "motor-test", help="Pulse one motor for wheel-position calibration"
    )
    motor.add_argument("motor", type=int, choices=range(1, 5))
    motor.add_argument("--speed", type=int, choices=range(-35, 36), default=20)
    motor.add_argument("--duration", type=int, choices=range(50, 501), default=300)
    motor.add_argument("--confirm-wheels-raised", action="store_true")
    servo = commands.add_parser(
        "servo-test", help="Move one servo within the firmware safety range"
    )
    servo.add_argument("channel", choices=("gripper", "aux"))
    servo.add_argument("angle", type=int)
    servo.add_argument("--confirm-safe-range", action="store_true")
    args = parser.parse_args()

    if args.command == "discover":
        print(json.dumps(discover_rovers(), ensure_ascii=False, indent=2))
        return 0

    settings = app_settings()
    api = RoverAPI(settings.base_url, settings.token)
    try:
        if args.command == "status":
            payload = api.status()
        elif args.command == "stop":
            payload = api.stop()
        elif args.command in ("pulse", "motor-test"):
            if not args.confirm_wheels_raised:
                parser.error(f"{args.command} requires --confirm-wheels-raised")
            if not MIN_SPEED <= args.speed <= MAX_SPEED:
                parser.error(f"speed must be {MIN_SPEED}..{MAX_SPEED}")
            if not MIN_DURATION_MS <= args.duration <= MAX_DURATION_MS:
                parser.error(
                    f"duration must be {MIN_DURATION_MS}..{MAX_DURATION_MS}"
                )
            session_id = random.SystemRandom().randint(1, 0x7FFFFFFF)
            if args.command == "motor-test":
                motors = [0, 0, 0, 0]
                motors[args.motor - 1] = args.speed
            else:
                motors = [args.speed] * 4
            api.arm(session_id)
            try:
                payload = api.diagnostic_drive(
                    session_id,
                    tuple(motors),
                    args.duration,
                )
                time.sleep(args.duration / 1000 + 0.1)
            finally:
                api.disarm()
        else:
            if not args.confirm_safe_range:
                parser.error("servo-test requires --confirm-safe-range")
            valid_range = (10, 90) if args.channel == "gripper" else (45, 135)
            if not valid_range[0] <= args.angle <= valid_range[1]:
                parser.error(
                    f"{args.channel} angle must be {valid_range[0]}..{valid_range[1]}"
                )
            controller = RoverController(settings.base_url, settings.token)
            controller.connect()
            controller.arm()
            try:
                command = ControlInput(
                    deadman=True,
                    gripper_angle=args.angle if args.channel == "gripper" else None,
                    aux_servo_angle=args.angle if args.channel == "aux" else None,
                )
                for _ in range(3):
                    controller.send(command)
                    time.sleep(0.04)
                payload = {"ok": True, "channel": args.channel, "angle": args.angle}
            finally:
                controller.disarm()
                controller.close(send_stop=False)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    except RoverAPIError as exc:
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
