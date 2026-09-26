import threading
import unittest
from unittest.mock import patch
from rover.gamepad import GamepadManager
from rover.config import ControllerMapping
from rover.models import GamepadSnapshot


class GamepadExpiryTests(unittest.TestCase):
    def test_reader_freeze_returns_zero_without_gui_polling(self):
        manager = GamepadManager.__new__(GamepadManager)
        manager._lock = threading.Lock()
        manager._filter_lock = threading.Lock()
        manager._filtered_axes = [0,0,0]
        manager._snapshot = GamepadSnapshot(connected=True, axes=[1,0,0],buttons=[False]*10)
        manager._sampled_at = 100
        with patch('rover.gamepad.time.monotonic',return_value=100.1):
            self.assertGreater(manager.live_drive(ControllerMapping(),35).x,0)
        with patch('rover.gamepad.time.monotonic',return_value=100.251):
            command = manager.live_drive(ControllerMapping(),35)
            self.assertEqual((command.x,command.y,command.z),(0,0,0))
            self.assertFalse(command.deadman)
