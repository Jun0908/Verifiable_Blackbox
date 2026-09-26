import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import hotspot_launcher
from rover.config import RoverSettings, load_rover_settings, save_rover_settings
from rover.network_switch import NetworkSwitchError

PRIVATE = {"ROVER_API_TOKEN": "test-token"}
READY = {"rover": {"url": "http://192.168.43.2"}, "camera": {"url": "http://192.168.43.3"}}


class HotspotLauncherTests(unittest.TestCase):
    def test_desktop_isolates_address_and_camera_and_preserves_calibration(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder)
            regular = config / "rover.json"
            save_rover_settings(RoverSettings(camera_url="http://home:81/stream", gripper_open_angle=31), regular)
            original = regular.read_bytes()
            with patch.object(hotspot_launcher, "CONFIG_DIR", config), \
                    patch.object(hotspot_launcher, "network_settings", return_value=PRIVATE), \
                    patch.object(hotspot_launcher, "prepare_network", return_value=READY), \
                    patch.dict(os.environ, {"ROVER_BASE_URL": "http://home"}), \
                    patch.object(hotspot_launcher.subprocess, "call", return_value=0) as launch:
                self.assertEqual(hotspot_launcher.main(["--desktop"]), 0)
                self.assertEqual(os.environ["ROVER_BASE_URL"], "http://home")
                env = launch.call_args.kwargs["env"]
                self.assertEqual(env["ROVER_BASE_URL"], "http://192.168.43.2")
                self.assertEqual(env["ROVER_SETTINGS_FILE"], str(config / "rover.hotspot.json"))
                self.assertEqual(env["ROVER_REQUIRED_WIFI_PROFILE"], "hotspot")
            mobile = load_rover_settings(config / "rover.hotspot.json")
            self.assertEqual(mobile.camera_url, "http://192.168.43.3:81/stream")
            self.assertEqual(mobile.gripper_open_angle, 31)
            self.assertEqual(regular.read_bytes(), original)

    def test_web_updates_discovered_camera_but_preserves_other_preferences(self):
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder)
            mobile = config / "rover.hotspot.json"
            save_rover_settings(RoverSettings(camera_url="http://saved:81/stream", speed_limit=42), mobile)
            with patch.object(hotspot_launcher, "CONFIG_DIR", config), \
                    patch.object(hotspot_launcher, "network_settings", return_value=PRIVATE), \
                    patch.object(hotspot_launcher, "prepare_network", return_value=READY), \
                    patch.object(hotspot_launcher.subprocess, "call", return_value=0) as launch:
                self.assertEqual(hotspot_launcher.main(["--web"]), 0)
                self.assertEqual(launch.call_args.args[0][-1], "--web")
                self.assertEqual(launch.call_args.kwargs["env"]["ROVER_BASE_URL"], READY["rover"]["url"])
            self.assertEqual(load_rover_settings(mobile).speed_limit, 42)

    def test_failed_all_device_check_does_not_start_controls(self):
        with patch.object(hotspot_launcher, "network_settings", return_value=PRIVATE), \
                patch.object(hotspot_launcher, "prepare_network", side_effect=NetworkSwitchError("camera missing")), \
                patch.object(hotspot_launcher.subprocess, "call") as launch:
            self.assertEqual(hotspot_launcher.main(["--web"]), 1)
            launch.assert_not_called()
