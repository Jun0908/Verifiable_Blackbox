import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from rover.web_bridge import BridgeError, RoverWebBridge

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.controller = Mock()
        self.controller.api.status.return_value = {"armed": False, "motors": False, "i2c": True}
        self.controller.armed = True
        self.controller.connect.return_value = {"armed": False}
        self.controller.receive_telemetry.return_value = None
        self.client = Mock()
        self.factory = Mock(return_value=self.controller)
        self.bridge = RoverWebBridge(self.factory, self.client, clock=lambda:self.now)

    def telemetry(self, motors=(0,0,0,0), **kwargs):
        values = dict(uptime_ms=int(self.now*1000),packet_age_ms=20,armed=True,i2c_ok=True,motors_running=any(motors),motors=motors,rssi=-50)
        values.update(kwargs)
        return SimpleNamespace(**values)

    def activate(self):
        session = self.bridge.activate()["session"]
        self.controller.receive_telemetry.return_value = self.telemetry()
        self.bridge.tick()
        return session

    def test_startup_and_status_do_not_touch_hardware(self):
        self.assertEqual(self.bridge.snapshot()["state"],"idle")
        self.factory.assert_not_called()

    def test_control_needs_no_job_or_deposit(self):
        self.activate()
        self.client.confirm_waiting_job.assert_not_called()
        self.controller.api.configure.assert_called_once_with(85)

    def test_network_permission_error_is_distinguished_from_robot_offline(self):
        self.controller.connect.side_effect = OSError("[WinError 10013] access denied")
        with self.assertRaisesRegex(BridgeError, "network access is blocked"):
            self.bridge.activate()
        self.controller.arm.assert_not_called()
        self.assertEqual(self.bridge.state, "error")

    def test_do_not_take_over_windows_app(self):
        self.controller.connect.return_value = {"armed":True}
        with self.assertRaisesRegex(BridgeError,"Windows"): self.activate()
        self.controller.arm.assert_not_called()
        self.controller.close.assert_called_once_with(send_stop=False)

    def test_cannot_drive_before_robot_response(self):
        session=self.bridge.activate()["session"]
        with self.assertRaisesRegex(BridgeError,"telemetry"): self.bridge.drive(session,1,"forward",35)
        self.assertFalse(self.bridge.command.deadman)

    def test_commands_without_motor_response_never_count_as_movement(self):
        session=self.activate()
        self.bridge.drive(session,1,"forward",35)
        self.bridge.tick()
        self.assertFalse(self.bridge.snapshot()["motorOutputSeen"])
        self.bridge.request_stop(session)
        self.bridge.tick()
        self.client.verify.assert_not_called()
        self.assertFalse(self.bridge.snapshot()["physicalMovementVerified"])

    def test_motor_output_is_not_physical_evidence_or_payment(self):
        session=self.activate()
        self.bridge.drive(session,1,"forward",60)
        self.now += .1
        self.controller.receive_telemetry.return_value = self.telemetry((60,60,60,60))
        self.bridge.tick()
        self.assertTrue(self.bridge.snapshot()["motorOutputSeen"])
        self.assertFalse(self.bridge.snapshot()["physicalMovementVerified"])
        self.bridge.release(session,2)
        self.bridge.request_stop(session)
        self.bridge.tick()
        self.client.verify.assert_not_called()
        self.assertFalse(self.bridge.snapshot()["paymentEnabled"])

    def test_release_sends_zero_and_allows_next_direction(self):
        session=self.activate()
        self.bridge.drive(session,1,"forward",35)
        self.bridge.release(session,2)
        self.assertFalse(self.controller.send.call_args.args[0].deadman)
        self.bridge.drive(session,3,"left",35)
        self.assertEqual(self.bridge.command.x,-1)

    def test_late_drive_cannot_override_release(self):
        session=self.activate()
        self.bridge.drive(session,1,"forward",35)
        self.bridge.release(session,3)
        with self.assertRaises(BridgeError): self.bridge.drive(session,2,"forward",35)
        self.assertFalse(self.bridge.command.deadman)

    def test_lost_browser_lease_stops_without_more_drive(self):
        session=self.activate()
        self.bridge.drive(session,1,"right",35)
        self.bridge.tick()
        count=self.controller.send.call_count
        self.now += .46
        self.bridge.tick()
        for call in self.controller.send.call_args_list[count:]:
            self.assertFalse(call.args[0].deadman)
        self.assertGreater(self.controller.send.call_count, count)
        self.assertEqual(self.bridge.state, "ready")
        self.assertTrue(self.bridge.snapshot()["controlPaused"])
        self.controller.emergency_stop.assert_not_called()
        with self.assertRaises(BridgeError): self.bridge.drive(session,2,"right",35)
        self.bridge.release(session,3)
        self.bridge.drive(session,4,"left",35)
        self.assertEqual(self.bridge.command.x, -1)
        self.client.verify.assert_not_called()

    def test_late_heartbeat_cannot_revive_expired_lease(self):
        session=self.activate()
        self.bridge.drive(session,1,"forward",35)
        self.now += .46
        with self.assertRaises(BridgeError): self.bridge.drive(session,2,"forward",35)
        self.bridge.tick()
        self.client.verify.assert_not_called()

    def test_wrong_session_rejected(self):
        self.activate()
        with self.assertRaises(BridgeError): self.bridge.drive("wrong",3,"back",35)

    def test_late_drive_after_stop_is_rejected(self):
        session=self.activate()
        self.bridge.request_stop(session)
        with self.assertRaises(BridgeError): self.bridge.drive(session,99,"forward",35)

    def test_failed_stop_does_not_submit(self):
        session=self.activate()
        self.bridge.drive(session,1,"forward",35)
        self.controller.emergency_stop.side_effect = OSError("offline")
        self.bridge.request_stop(session)
        self.bridge.tick()
        self.client.verify.assert_not_called()
        self.assertEqual(self.bridge.state,"error")

    def test_missing_telemetry_stops_ready_session(self):
        self.activate()
        self.now += .81
        self.bridge.tick()
        self.controller.emergency_stop.assert_called_once()
        self.assertEqual(self.bridge.state,"error")

    def test_queued_fresh_response_survives_delayed_loop(self):
        self.activate()
        self.now += .81
        self.controller.receive_telemetry.return_value = self.telemetry()
        self.bridge.tick()
        self.assertEqual(self.bridge.state, "ready")
        self.assertTrue(self.bridge.snapshot()["telemetryFresh"])
        self.controller.emergency_stop.assert_not_called()

    def test_queued_fault_stops_before_sending_another_drive(self):
        session = self.activate()
        self.bridge.drive(session, 1, "forward", 35)
        count = self.controller.send.call_count
        self.now += .1
        self.controller.receive_telemetry.return_value = self.telemetry(i2c_ok=False)
        self.bridge.tick()
        self.assertEqual(self.controller.send.call_count, count)
        self.controller.emergency_stop.assert_called_once()

    def test_duplicate_telemetry_does_not_refresh_connection(self):
        self.activate()
        self.now += .5
        self.bridge.tick()
        self.now += .31
        self.bridge.tick()
        self.assertEqual(self.bridge.state,"error")
        self.assertFalse(self.bridge.snapshot()["telemetryFresh"])

    def test_i2c_error_stops(self):
        self.activate()
        self.now += .1
        self.controller.receive_telemetry.return_value=self.telemetry(i2c_ok=False)
        self.bridge.tick()
        self.assertEqual(self.bridge.state,"error")

    def test_no_second_session_during_control(self):
        self.activate()
        with self.assertRaises(BridgeError): self.bridge.activate()

    def test_idle_timeout_stops_even_with_no_browser_commands(self):
        self.activate()
        self.now += 60
        self.bridge.tick()
        self.controller.emergency_stop.assert_called_once()
        self.assertEqual(self.bridge.state, 'idle')

    def test_ack_without_stopped_status_is_not_success(self):
        session = self.activate()
        self.controller.api.status.return_value = {'armed': False, 'motors': False, 'i2c': False}
        self.bridge.request_stop(session)
        self.bridge.tick()
        self.assertEqual(self.bridge.state, 'error')

    def test_sequence_rejects_coercible_and_unsafe_values(self):
        session = self.activate()
        for value in (True, 1.5, '1', None, 2**53):
            with self.assertRaises(BridgeError): self.bridge.drive(session,value,'forward',35)

    def test_shutdown_cancels_inflight_activation(self):
        self.controller.arm.side_effect = self.bridge.shutdown
        with self.assertRaises(BridgeError): self.bridge.activate()
        self.controller.close.assert_called_once_with(send_stop=True)
        self.assertIsNone(self.bridge.controller)

    def test_close_failure_is_contained(self):
        session=self.activate()
        self.controller.close.side_effect=OSError("socket failed")
        self.bridge.request_stop(session)
        self.bridge.tick()
        self.assertEqual(self.bridge.state,"error")
        self.client.verify.assert_not_called()

if __name__ == "__main__": unittest.main()
