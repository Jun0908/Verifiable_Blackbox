import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from rover.config import RoverSettings
from rover.web_bridge import BridgeError, RoverWebBridge


class GripperTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.packet = 0
        self.controller = Mock()
        self.controller.api.status.return_value = {"armed": False, "motors": False, "i2c": True}
        self.controller.armed = True
        self.controller.connect.return_value = {"armed": False}
        self.controller.send.side_effect = self.send
        self.settings = RoverSettings()
        self.bridge = RoverWebBridge(lambda: self.controller, clock=lambda: self.now, settings=self.settings)
        self.session = self.bridge.activate()["session"]
        self.feedback(25)

    def send(self, _command):
        self.packet += 1
        return self.packet

    def feedback(self, angle, sequence=None):
        self.now += .05
        self.controller.receive_telemetry.return_value = SimpleNamespace(
            uptime_ms=round(self.now * 1000), packet_age_ms=0, armed=True, i2c_ok=True,
            motors_running=False, motors=(0, 0, 0, 0), rssi=-50,
            gripper_angle=angle, sequence=self.packet if sequence is None else sequence)
        self.bridge.tick()

    def test_open_sends_configured_angle_without_wheel_motion(self):
        self.settings.gripper_open_angle = 30
        self.bridge.gripper(self.session, 1, "open")
        command = self.controller.send.call_args.args[0]
        self.assertEqual(command.gripper_angle, 30)
        self.assertEqual((command.x, command.y, command.z), (0, 0, 0))
        self.feedback(30)
        self.assertIsNone(self.bridge.command.gripper_angle)
        self.assertEqual(self.bridge.state, "ready")
        self.assertEqual(self.bridge.snapshot()["gripperAngle"], 30)

    def test_close_advances_only_after_ack_and_button_release_cancels(self):
        self.bridge.gripper(self.session, 1, "close")
        self.assertEqual(self.bridge.command.gripper_angle, 27)
        self.now += .13
        self.bridge.gripper(self.session, 2, "close")
        self.assertEqual(self.bridge.command.gripper_angle, 27)
        self.feedback(27)
        self.bridge.gripper(self.session, 3, "close")
        self.assertEqual(self.bridge.command.gripper_angle, 29)
        self.bridge.release(self.session, 4)
        self.assertIsNone(self.bridge.command.gripper_angle)
        with self.assertRaises(BridgeError):
            self.bridge.gripper(self.session, 3, "close")
        self.feedback(29)
        self.assertIsNone(self.bridge.command.gripper_angle)

    def test_old_matching_angle_does_not_ack_new_packet(self):
        old = self.packet
        self.bridge.gripper(self.session, 1, "open")
        self.feedback(25, sequence=old)
        self.assertEqual(self.bridge.command.gripper_angle, 25)
        self.feedback(25)
        self.assertIsNone(self.bridge.command.gripper_angle)

    def test_close_respects_reverse_configuration_and_limit(self):
        self.settings.gripper_closed_angle = 20
        self.bridge.gripper(self.session, 1, "close")
        self.assertEqual(self.bridge.command.gripper_angle, 23)
        self.bridge.release(self.session, 2)
        self.feedback(21)
        self.bridge.gripper(self.session, 3, "close")
        self.assertEqual(self.bridge.command.gripper_angle, 20)

    def test_close_does_not_overshoot_last_degree(self):
        self.settings.gripper_closed_angle = 26
        self.bridge.gripper(self.session, 1, "close")
        self.assertEqual(self.bridge.command.gripper_angle, 26)

    def test_lost_hold_does_not_keep_closing(self):
        self.bridge.gripper(self.session, 1, "close")
        self.now += .46
        self.feedback(27)
        self.assertIsNone(self.bridge.command.gripper_angle)
        self.assertTrue(self.bridge.needs_release)
        with self.assertRaises(BridgeError):
            self.bridge.gripper(self.session, 2, "close")
        self.bridge.release(self.session, 3)
        self.bridge.gripper(self.session, 4, "close")
        self.assertEqual(self.bridge.command.gripper_angle, 29)

    def test_pending_target_has_bounded_retry_and_stop_clears_it(self):
        self.bridge.gripper(self.session, 1, "close")
        for sequence in range(2, 12):
            self.now += .06
            self.feedback(25)
            if self.bridge.needs_release:
                break
            self.bridge.gripper(self.session, sequence, "close")
        self.assertTrue(self.bridge.needs_release)
        self.assertIsNone(self.bridge.command.gripper_angle)
        self.bridge.request_stop(self.session)
        self.bridge.tick()
        self.assertIsNone(self.bridge.gripper_sequence)

    def test_no_fresh_response_invalid_action_or_settings_rejected(self):
        with self.assertRaises(BridgeError):
            self.bridge.gripper(self.session, 1, "invalid")
        self.settings.gripper_open_angle = 150
        with self.assertRaises(BridgeError):
            self.bridge.gripper(self.session, 1, "open")
        self.settings.gripper_open_angle = 25
        self.now += .81
        with self.assertRaises(BridgeError):
            self.bridge.gripper(self.session, 1, "close")
        self.assertIsNone(self.bridge.command.gripper_angle)


if __name__ == "__main__":
    unittest.main()
