import socket
import struct
import time
import unittest
from unittest.mock import patch

from rover.control import RoverController
from rover.models import ControlInput


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.controller = RoverController("http://127.0.0.1", "test")
        self.addCleanup(lambda: self.controller.close(send_stop=False))
        self.controller.armed = True

    def test_expired_screen_and_servo_commands_are_not_replayed(self):
        c = self.controller
        c._desired = ControlInput(x=1, deadman=True, gripper_angle=40)
        c._desired_at = 10
        with patch.object(c, "_send") as send:
            c._stream_once(10.5)
            self.assertEqual(send.call_args.args[0].x, 1)
            c._stream_once(11.1)
            self.assertEqual(send.call_args.args[0], ControlInput())

    def test_live_input_keeps_working_when_gui_stops_updating(self):
        c = self.controller
        c._desired = ControlInput(gripper_angle=40)
        c._desired_at = 10
        current = ControlInput(y=0.5, deadman=True, speed_limit=35)
        c.set_drive_source(lambda: current)
        with patch.object(c, "_send") as send:
            c._stream_once(12)
            command = send.call_args.args[0]
            self.assertEqual(command.y, 0.5)
            self.assertIsNone(command.gripper_angle)
            current = ControlInput()
            c._stream_once(12.04)
            self.assertEqual(send.call_args.args[0].y, 0)
            self.assertFalse(send.call_args.args[0].deadman)

    def test_stop_clears_worker_input(self):
        c = self.controller
        c._desired = ControlInput(x=1, deadman=True)
        c.set_drive_source(lambda: ControlInput(y=1))
        with patch.object(c.api, "stop"), patch.object(c, "_send") as send:
            c.emergency_stop()
            c._stream_once(time.monotonic())
            self.assertIsNone(c._drive_source)
            self.assertEqual(c._desired, ControlInput())
            send.assert_not_called()  # no destination and disarmed

    def test_background_stop_is_latched_until_disarm_even_without_gui(self):
        c = self.controller
        current = ControlInput(emergency_stop=True)
        c.set_drive_source(lambda: current)
        with patch.object(c, "_send") as send:
            c._stream_once(10)
            self.assertFalse(send.call_args.args[0].emergency_stop)  # held resume
            current = ControlInput()
            c._stream_once(11)
            current = ControlInput(emergency_stop=True)
            c._stream_once(12)
            self.assertTrue(send.call_args.args[0].emergency_stop)
            current = ControlInput(y=1, deadman=True)
            c._stream_once(13)
            self.assertTrue(send.call_args.args[0].emergency_stop)
            self.assertEqual(send.call_args.args[0].y, 0)

    def test_real_background_udp_stream_runs_without_gui_ticks(self):
        receiver = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.addCleanup(receiver.close)
        receiver.bind(("127.0.0.1", 0))
        receiver.settimeout(1)
        c = self.controller
        c._destination = receiver.getsockname()
        c.start_stream()
        c.send(ControlInput())  # zero outputs only, loopback only
        sequences = [struct.unpack("<IBBHIIhhhBBBBII", receiver.recv(1024))[5] for _ in range(5)]
        self.assertEqual(sequences, sorted(set(sequences)))
        self.assertGreaterEqual(sequences[-1] - sequences[0], 4)


if __name__ == "__main__":
    unittest.main()
