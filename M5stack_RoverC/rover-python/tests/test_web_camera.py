import unittest
from unittest.mock import Mock, patch
from rover.config import RoverSettings
from rover.web_camera import WebCamera


class WebCameraTests(unittest.TestCase):
    def setUp(self):
        self.stream = Mock()
        self.stream.snapshot.return_value = (b"jpeg", 99.0, "", "http://camera:81/stream")
        self.camera = WebCamera(self.stream, clock=lambda: 100.0)

    def test_only_fresh_frames_are_returned(self):
        self.assertEqual(self.camera.frame(), (b"jpeg", 99.0))
        self.assertTrue(self.camera.status()["receiving"])
        for snapshot in [(b"old", 97.9, "", "http://camera/stream"),
                         (b"old", 99.0, "disconnected", "http://camera/stream"),
                         (None, 0, "", "http://camera/stream"),
                         (b"old", 99.0, "", "")]:
            self.stream.snapshot.return_value = snapshot
            self.assertIsNone(self.camera.frame()[0])
            self.assertFalse(self.camera.status()["receiving"])

    def test_save_preserves_other_rover_settings(self):
        settings = RoverSettings(speed_limit=60, gripper_saved_angle=43)
        with patch("rover.web_camera.load_rover_settings", return_value=settings), patch("rover.web_camera.save_rover_settings") as save:
            self.camera.configure("192.168.1.10")
        saved = save.call_args.args[0]
        self.assertEqual(saved.camera_url, "http://192.168.1.10:81/stream")
        self.assertEqual(saved.speed_limit, 60)
        self.assertEqual(saved.gripper_saved_angle, 43)
        self.stream.configure.assert_called_once_with(saved.camera_url)

    def test_invalid_url_does_not_replace_current_camera(self):
        with patch("rover.web_camera.save_rover_settings") as save:
            for value in [None, 10, "file:///secret", "http://user:pass@camera/stream", "a" * 1025]:
                with self.assertRaises(ValueError):
                    self.camera.configure(value)
            save.assert_not_called()
            self.stream.configure.assert_not_called()

    def test_save_failure_does_not_switch_receiver(self):
        with patch("rover.web_camera.load_rover_settings", return_value=RoverSettings()), patch("rover.web_camera.save_rover_settings", side_effect=OSError):
            with self.assertRaises(OSError):
                self.camera.configure("camera")
        self.stream.configure.assert_not_called()

    def test_off_stops_receiver_and_preserves_address_across_restart(self):
        settings = RoverSettings(camera_url="http://camera:81/stream", speed_limit=60)
        with patch("rover.web_camera.load_rover_settings", return_value=settings), patch("rover.web_camera.save_rover_settings"):
            status = self.camera.set_enabled(False)
            self.assertFalse(status["enabled"])
            self.assertFalse(status["receiving"])
            self.assertEqual(status["url"], settings.camera_url)
            self.assertIsNone(self.camera.frame()[0])
            self.stream.configure.assert_called_with("")
            self.assertFalse(settings.camera_enabled)
            self.assertEqual(settings.speed_limit, 60)
            self.camera.start()
            self.stream.configure.assert_called_with("")
            self.camera.set_enabled(True)
            self.stream.configure.assert_called_with(settings.camera_url)

    def test_changing_address_while_off_does_not_start_stream(self):
        settings = RoverSettings(camera_url="http://camera:81/stream")
        with patch("rover.web_camera.load_rover_settings", return_value=settings), patch("rover.web_camera.save_rover_settings"):
            self.camera.set_enabled(False)
            status = self.camera.configure("new-camera")
            self.assertEqual(status["url"], "http://new-camera:81/stream")
            self.stream.configure.assert_called_with("")
            self.camera.set_enabled(True)
            self.stream.configure.assert_called_with("http://new-camera:81/stream")

    def test_invalid_or_unsaved_power_change_leaves_camera_running(self):
        with patch("rover.web_camera.save_rover_settings", side_effect=OSError):
            for invalid in ["false", 0, None]:
                with self.assertRaises(ValueError):
                    self.camera.set_enabled(invalid)
            with self.assertRaises(OSError):
                self.camera.set_enabled(False)
        self.assertTrue(self.camera.enabled)
        self.stream.configure.assert_not_called()

    def test_start_and_close_reuse_saved_camera(self):
        with patch("rover.web_camera.load_rover_settings", return_value=RoverSettings(camera_url="http://camera:81/stream")):
            self.camera.start()
        self.stream.configure.assert_called_once_with("http://camera:81/stream")
        self.camera.close()
        self.stream.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
