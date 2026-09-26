import time
import unittest
from mock_rover import MockRover
from rover.api import RoverAPI, RoverAPIError
from rover.control import RoverController
from rover.models import ControlInput


class ControllerIntegrationTests(unittest.TestCase):
    def test_authenticated_http_udp_session_and_stop(self):
        with MockRover() as device:
            with self.assertRaises(RoverAPIError):
                RoverAPI(device.url, 'wrong-token').status()
            c = RoverController(device.url, device.token)
            try:
                self.assertFalse(c.connect()['armed'])
                c.arm()
                with self.assertRaises(RoverAPIError):
                    RoverAPI(device.url, device.token).arm(c.session_id + 1)
                c.start_stream()
                c.send(ControlInput(y=1, deadman=True))
                deadline = time.monotonic()+2
                while time.monotonic()<deadline:
                    telemetry = c.receive_telemetry()
                    if telemetry and telemetry.motors_running: break
                    time.sleep(.02)
                self.assertTrue(telemetry.motors_running)
                c.emergency_stop()
                self.assertFalse(device.armed)
                self.assertEqual(device.motors,[0]*4)
            finally: c.close(send_stop=False)
