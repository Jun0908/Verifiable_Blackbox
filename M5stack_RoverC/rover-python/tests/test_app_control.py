import os
import time
import unittest
from dataclasses import replace
from unittest.mock import Mock, patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

import app
from rover.config import AppSettings, ControllerMapping, RoverSettings
from rover.models import ControlInput, GamepadSnapshot, Telemetry


class FakeController:
    def __init__(self):
        self.armed = True
        self.sequence = 0
        self.commands = []
        self.next_telemetry = None
        self.arm_count = 0
        self.last_received_at = 0.0
        self.drive_source = None

    def set_drive_source(self, source):
        self.drive_source = source

    def arm(self):
        self.armed = True
        self.sequence = 0
        self.arm_count += 1

    def send(self, command):
        self.sequence += 1
        self.commands.append(replace(command))
        return self.sequence

    def receive_telemetry(self):
        result, self.next_telemetry = self.next_telemetry, None
        if result is not None:
            self.armed = result.armed
        return result

    def emergency_stop(self):
        self.armed = False

    def close(self, send_stop=False):
        self.armed = False


def telemetry(sequence, gripper=25, aux=90, armed=True):
    return Telemetry(
        sequence=sequence, uptime_ms=100, x=0, y=0, z=0,
        motors=(0, 0, 0, 0), gripper_angle=gripper, aux_servo_angle=aux,
        rssi=-60, speed_limit=35, packet_age_ms=0, i2c_ok=True,
        armed=armed, motors_running=False, wifi_ok=True,
    )


class AppControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.qt = QApplication.instance() or QApplication([])

    def setUp(self):
        patches = [
            patch.object(app, "QTimer"),
            patch.object(app, "GamepadManager"),
            patch.object(app, "RoverController"),
            patch.object(app, "app_settings", return_value=AppSettings("http://test", "test")),
            patch.object(app, "load_rover_settings", return_value=RoverSettings()),
            patch.object(app, "load_controller_mapping", return_value=ControllerMapping()),
            patch.object(app, "save_controller_mapping"),
            patch.object(app, "save_rover_settings"),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.window = app.MainWindow()
        self.window.gamepad.poll.return_value = GamepadSnapshot()
        self.controller = FakeController()
        self.window.controller = self.controller
        self.window._set_state("status_ready", "#63e6be")
        self.addCleanup(self.window.deleteLater)

    def test_release_button_resumes_stopped_session(self):
        self.controller.armed = False
        self.window.paused = True
        self.window._set_state("status_stopped", "#ff6b78")
        self.window.open_button.click()
        self.window._control_tick()
        self.assertEqual(self.controller.arm_count, 1)
        self.assertFalse(self.window.paused)
        command = self.controller.commands[-1]
        self.assertEqual(command.gripper_angle, 25)
        self.assertTrue(command.deadman)
        self.assertEqual((command.x, command.y, command.z), (0, 0, 0))

    def test_lost_servo_packet_retries_until_matching_reply(self):
        self.window.open_button.click()
        for _ in range(4):
            self.window._control_tick()
        self.assertEqual([c.gripper_angle for c in self.controller.commands], [25] * 4)
        self.controller.next_telemetry = telemetry(self.controller.sequence, gripper=75)
        self.window._control_tick()
        self.assertEqual(self.window.pending_gripper, 25)
        self.controller.next_telemetry = telemetry(self.controller.sequence)
        self.window._control_tick()
        self.assertIsNone(self.window.pending_gripper)
        self.assertEqual(self.window.servo_feedback_key, "servo_received")
        self.window._control_tick()
        self.assertIsNone(self.controller.commands[-1].gripper_angle)

    def test_old_matching_angle_does_not_ack_new_command(self):
        self.controller.sequence = 10
        self.window.open_button.click()
        self.controller.next_telemetry = telemetry(10)
        self.window._control_tick()
        self.assertEqual(self.window.servo_sequence, 11)
        self.assertEqual(self.window.pending_gripper, 25)
        self.assertEqual(self.window.servo_feedback_key, "servo_sending")

    def test_servo_retry_expires(self):
        self.window.open_button.click()
        self.window.servo_deadline = time.monotonic() - 1
        self.window._control_tick()
        self.assertIsNone(self.controller.commands[-1].gripper_angle)
        self.assertEqual(self.window.servo_feedback_key, "servo_timeout")

    def test_stop_discards_pending_command_before_resume(self):
        self.window.open_button.click()
        self.window.toggle_pause()
        self.window.toggle_pause()
        self.window._control_tick()
        self.assertIsNone(self.controller.commands[-1].gripper_angle)
        self.assertIsNone(self.window.pending_gripper)

    def test_firmware_disarm_cancels_servo_and_screen_command(self):
        self.window.open_button.click()
        self.window._screen_pressed(0, 1, 0)
        self.controller.next_telemetry = telemetry(1, armed=False)
        self.window._control_tick()
        self.assertTrue(self.window.paused)
        self.assertFalse(self.window.screen_active)
        self.assertIsNone(self.window.pending_gripper)
        self.assertEqual(self.window.servo_feedback_key, "servo_interrupted")

    def test_reconnection_does_not_replay_unconfirmed_servo(self):
        self.window.open_button.click()
        self.window._drop_connection()
        self.window.controller = self.controller
        self.assertTrue(self.window.paused)
        self.window.paused = False  # explicit resume
        self.window._try_start_control()
        self.window._control_tick()
        self.assertIsNone(self.controller.commands[-1].gripper_angle)

    def setup_gamepad(self, axes=None):
        self.window.mapping = ControllerMapping(guid="test", simple_setup_version=1)
        snapshot = GamepadSnapshot(
            connected=True, guid="test", name="test", axes=axes or [0, 0, 0],
            buttons=[False] * 10,
        )
        self.window.gamepad.poll.return_value = snapshot
        self.window.last_snapshot = snapshot
        self.window.last_gamepad_guid = snapshot.guid
        self.window.gamepad.control_input.return_value = ControlInput(x=1)
        return snapshot

    def test_off_center_gamepad_does_not_block_screen_or_servo(self):
        self.setup_gamepad([1, 0, 0])
        self.controller.armed = False
        self.window._try_start_control()
        self.assertTrue(self.controller.armed)
        self.assertFalse(self.window.gamepad_ready)
        self.window.open_button.click()
        self.window._control_tick()
        command = self.controller.commands[-1]
        self.assertEqual(command.gripper_angle, 25)
        self.assertEqual(command.x, 0)
        self.window._screen_pressed(0, 1, 0)
        self.window._control_tick()
        self.assertEqual(self.controller.commands[-1].y, 1)
        self.window.gamepad.control_input.assert_not_called()

    def test_holding_stop_does_not_toggle_back_to_running(self):
        snapshot = self.setup_gamepad()
        snapshot.buttons[self.window.mapping.emergency_button] = True
        for _ in range(3):
            self.window._control_tick()
        self.assertTrue(self.window.paused)
        self.assertFalse(self.controller.armed)
        self.assertEqual(self.controller.arm_count, 0)

    def acknowledge_gripper(self):
        self.controller.next_telemetry = telemetry(self.controller.sequence, self.window.gripper_target)
        self.window.gripper_next_step = 0
        self.window._control_tick()

    def test_hold_closes_one_degree_per_ack_and_release_stops_advancing(self):
        self.window.start_gripper_close("screen")
        self.window._control_tick()
        self.assertEqual(self.window.pending_gripper, 26)
        self.window.gripper_next_step = 0
        self.window._control_tick()
        self.assertEqual(self.window.pending_gripper, 26)  # no ACK yet
        self.acknowledge_gripper()
        self.assertEqual(self.window.pending_gripper, 27)
        self.window.stop_gripper_close("screen")
        self.acknowledge_gripper()
        self.assertIsNone(self.window.pending_gripper)
        self.assertEqual(self.window.gripper_target, 27)

    def test_loosen_cancels_close_and_reverses_three_degrees(self):
        self.window.start_gripper_close("screen")
        self.window._control_tick()
        self.window.loosen_button.click()
        self.assertEqual(self.window.pending_gripper, 23)
        self.assertIsNone(self.window.gripper_close_source)

    def test_saved_position_requires_ack_and_recalls_gradually(self):
        self.window.queue_gripper(40)
        self.window.save_gripper_position()
        self.assertIsNone(self.window.settings.gripper_saved_angle)
        self.window._control_tick()
        self.acknowledge_gripper()
        self.window.save_gripper_position()
        self.assertEqual(self.window.settings.gripper_saved_angle, 40)
        app.save_rover_settings.assert_called_once_with(self.window.settings)
        self.window.release_gripper()
        self.window._control_tick()
        self.acknowledge_gripper()
        self.window.recall_gripper_position()
        self.window._control_tick()
        self.assertEqual(self.window.pending_gripper, 26)

    def test_gamepad_close_releases_and_disconnects(self):
        snapshot = self.setup_gamepad()
        snapshot.buttons[self.window.mapping.gripper_close_button] = True
        self.window._control_tick()
        self.assertEqual(self.window.gripper_close_source, "gamepad")
        snapshot.buttons[self.window.mapping.gripper_close_button] = False
        self.window._control_tick()
        self.assertIsNone(self.window.gripper_close_source)
        snapshot.buttons[self.window.mapping.gripper_close_button] = True
        self.window._control_tick()
        self.window.gamepad.poll.return_value = GamepadSnapshot()
        self.window._control_tick()
        self.assertIsNone(self.window.gripper_close_source)

    def test_timeout_does_not_continue_closing(self):
        self.window.start_gripper_close("screen")
        self.window._control_tick()
        self.window.servo_deadline = time.monotonic() - 1
        self.window._control_tick()
        self.assertIsNone(self.window.gripper_close_source)
        self.assertIsNone(self.window.pending_gripper)

    def test_soft_timeout_does_not_pause_or_rearm(self):
        self.controller.next_telemetry = replace(telemetry(0), stop_reason=2)
        self.window._control_tick()
        self.assertFalse(self.window.paused)
        self.assertEqual(self.controller.arm_count, 0)
        self.assertEqual(self.window.state_key, "status_link_wait")
        self.controller.next_telemetry = telemetry(self.controller.sequence)
        self.window._control_tick()
        self.assertEqual(self.window.state_key, "status_ready")

    def test_worker_detected_disarm_is_processed_before_armed_check(self):
        self.controller.armed = False
        self.controller.next_telemetry = replace(telemetry(0, armed=False), stop_reason=4)
        self.window._control_tick()
        self.assertTrue(self.window.paused)

    def test_manual_pause_survives_reconnection(self):
        self.window.toggle_pause()
        self.window._drop_connection()
        self.assertTrue(self.window.paused)

    def test_connection_loss_attempts_stop_and_requires_resume(self):
        from unittest.mock import Mock
        self.controller.close = Mock()
        self.window._drop_connection()
        self.controller.close.assert_called_once_with(send_stop=True)
        self.assertTrue(self.window.paused)

    def test_gui_does_not_take_over_other_controller(self):
        from unittest.mock import Mock
        candidate = Mock()
        candidate.connect.return_value = {'armed': True}
        with patch.object(app, 'RoverController', return_value=candidate), patch.object(self.window, '_candidate_urls', return_value=['http://127.0.0.1']):
            self.window._attempt_connect()
        candidate.api.stop.assert_not_called()
        candidate.arm.assert_not_called()

    def test_one_second_telemetry_gap_does_not_drop_connection(self):
        self.window.last_telemetry_at = time.monotonic() - 1.1
        self.window._control_tick()
        self.assertIs(self.window.controller, self.controller)

    def test_settings_cancels_background_and_gripper_input(self):
        self.window.start_gripper_close("screen")
        self.window._screen_pressed(0, 1, 0)
        self.window._suspend_inputs()
        self.assertIsNone(self.controller.drive_source)
        self.assertIsNone(self.window.gripper_close_source)
        self.assertFalse(self.window.screen_active)
        self.assertEqual(self.controller.commands[-1], ControlInput())

    def test_corrupt_camera_frame_is_not_labeled_live(self):
        with patch.object(self.window.camera, "snapshot", return_value=(
            b"bad image", time.monotonic(), "", "http://test/stream"
        )):
            self.window.camera_panel.refresh()
        self.assertEqual(self.window.camera_panel.status.text(), self.window.tr("camera_title"))
        self.assertEqual(self.window.camera_panel.video.text(), self.window.tr("camera_waiting"))


class SessionTests(unittest.TestCase):
    def test_arm_discards_queued_telemetry_from_previous_session(self):
        from rover.control import RoverController

        with patch("rover.control.socket.socket") as sockets, patch("rover.control.RoverAPI"):
            controller = RoverController("http://test", "test")
            controller._destination = ("127.0.0.1", 4210)
            sockets.return_value.recvfrom.side_effect = [(b"old", ("127.0.0.1", 4210)), BlockingIOError]
            controller.last_telemetry = telemetry(17, armed=False)
            controller.arm()
            self.assertTrue(controller.armed)
            self.assertIsNone(controller.last_telemetry)
            self.assertEqual(sockets.return_value.recvfrom.call_count, 2)


if __name__ == "__main__":
    unittest.main()
