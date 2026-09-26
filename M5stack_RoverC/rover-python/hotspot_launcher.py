"""Select one Wi-Fi for the PC and all devices, then open the controls."""
from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys

from rover.config import CONFIG_DIR, PROJECT_DIR, load_rover_settings, save_rover_settings
from rover.network_switch import NetworkSwitchError, network_settings, prepare_network


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=["home", "hotspot"], default="hotspot")
    parser.add_argument("--web", action="store_true")
    parser.add_argument("--desktop", action="store_true")
    parser.add_argument("--rover-only", action="store_true", help="Explicitly omit the camera")
    parser.add_argument("--prepare-only", action="store_true", help="Switch and verify; do not start controls")
    args = parser.parse_args(argv)
    if args.web and args.desktop:
        parser.error("Choose either --web or --desktop")
    mode = "1" if args.web else "2" if args.desktop else ""
    if not mode and not args.prepare_only:
        mode = input("Controls: 1 = Web, 2 = Desktop with camera [1]: ").strip() or "1"
        if mode not in {"1", "2"}:
            print("Choose 1 or 2.")
            return 1
    try:
        private = network_settings()
        ready = prepare_network(args.profile, private, rover_only=args.rover_only)
    except NetworkSwitchError as exc:
        print(str(exc))
        return 1
    if args.prepare_only:
        return 0

    # Only the child process receives this address. The regular .env stays intact.
    child_env = os.environ.copy()
    child_env["ROVER_BASE_URL"] = ready["rover"]["url"]
    child_env["ROVER_API_TOKEN"] = private["ROVER_API_TOKEN"]
    child_env["ROVER_REQUIRED_WIFI_PROFILE"] = args.profile
    settings_path = CONFIG_DIR / f"rover.{args.profile}.json"
    if not settings_path.exists():
        settings_path.parent.mkdir(parents=True, exist_ok=True)
        original = CONFIG_DIR / "rover.json"
        if original.exists():
            shutil.copy2(original, settings_path)
    settings = load_rover_settings(settings_path)
    settings.camera_url = ready["camera"]["url"] + ":81/stream" if "camera" in ready else ""
    save_rover_settings(settings, settings_path)
    child_env["ROVER_SETTINGS_FILE"] = str(settings_path)
    command = [sys.executable, str(PROJECT_DIR / ("web_bridge_server.py" if mode == "1" else "app.py"))]
    if mode == "1":
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        command.extend(["--port", str(port), "--web"])
    return subprocess.call(command, cwd=PROJECT_DIR, env=child_env)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, EOFError):
        raise SystemExit(0)
