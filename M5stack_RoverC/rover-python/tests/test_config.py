import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from rover.config import (
    ControllerMapping,
    RoverSettings,
    load_controller_mapping,
    load_rover_settings,
    save_controller_mapping,
    save_rover_settings,
)


class ConfigTests(unittest.TestCase):
    def test_hotspot_settings_do_not_overwrite_regular_settings(self):
        with tempfile.TemporaryDirectory() as folder:
            regular = Path(folder) / "rover.json"
            hotspot = Path(folder) / "rover.hotspot.json"
            save_rover_settings(RoverSettings(camera_url="http://home:81/stream"), regular)
            original = regular.read_bytes()
            with patch.dict("os.environ", {"ROVER_SETTINGS_FILE": str(hotspot)}):
                save_rover_settings(RoverSettings(camera_url="http://mobile:81/stream"))
                self.assertEqual(load_rover_settings().camera_url, "http://mobile:81/stream")
                self.assertEqual(load_rover_settings(regular).camera_url, "http://home:81/stream")
            self.assertEqual(regular.read_bytes(), original)

    def test_settings_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "rover.json"
            save_rover_settings(RoverSettings(speed_limit=42, language="en"), path)
            restored = load_rover_settings(path)
            self.assertEqual(restored.speed_limit, 42)
            self.assertEqual(restored.language, "en")

    def test_mapping_roundtrip(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "controller.json"
            save_controller_mapping(
                ControllerMapping(axis_z=4, simple_setup_version=1), path
            )
            restored = load_controller_mapping(path)
            self.assertEqual(restored.axis_z, 4)
            self.assertEqual(restored.simple_setup_version, 1)


if __name__ == "__main__":
    unittest.main()
