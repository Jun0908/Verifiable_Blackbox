import json
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
import uuid

from rover.job_runner import RoverJobRunner
from rover.web_bridge import BridgeError, RoverWebBridge
from rover.web_camera import WebCamera


class Controller:
    def __init__(self):
        self.armed = False
        self.sequence = 0
        self.sent = []
        self.stop_ok = True
        self.api = SimpleNamespace(configure=lambda _: None, status=self.status)

    def connect(self):
        return {"armed": False}

    def arm(self):
        self.armed = True

    def send(self, command):
        self.sequence += 1
        self.sent.append(command)
        return self.sequence

    def receive_telemetry(self):
        return SimpleNamespace(uptime_ms=int(time.monotonic() * 1000) % (2**32), packet_age_ms=0,
                               armed=self.armed, i2c_ok=True, motors_running=False, motors=(0, 0, 0, 0), rssi=-40)

    def emergency_stop(self):
        self.armed = False

    def status(self):
        return {"armed": not self.stop_ok, "motors": not self.stop_ok, "i2c": True}

    def close(self, **_):
        self.armed = False


class Stream:
    def __init__(self):
        self.available = True

    def snapshot(self):
        return (b"\xff\xd8test\xff\xd9" if self.available else None, time.monotonic(), "", "http://camera:81/stream")


class JobRunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.controller = Controller()
        self.bridge = RoverWebBridge(lambda: self.controller)
        self.stream = Stream()
        self.camera = WebCamera(self.stream)
        self.runner = RoverJobRunner(self.bridge, self.camera, self.directory.name)
        self.done = threading.Event()
        def tick():
            while not self.done.wait(0.02):
                self.bridge.tick()
        self.ticker = threading.Thread(target=tick, daemon=True)
        self.ticker.start()

    def tearDown(self):
        self.runner.close()
        self.done.set()
        self.ticker.join(timeout=2)
        self.bridge.shutdown()
        self.directory.cleanup()

    def request(self, mode="SKIP_VIDEO", operation="FORWARD"):
        return {"sessionId": str(uuid.uuid4()), "jobId": "1", "chainId": 31337, "core": "0x" + "1" * 40,
                "judgmentMode": mode, "operation": operation, "durationMs": 500, "speed": 20, "cameraUrl": "http://camera:81/stream" if mode == "VIDEO" else None,
                "conditionsHash": "0x" + "2" * 64, "policyHash": "0x" + "3" * 64, "expiresAt": int(time.time()) + 60}

    def finish(self, request, manual=True):
        if manual:
            deadline = time.monotonic() + 3
            while self.runner.worker.is_alive() and self.runner.status(request["sessionId"])["phase"] in {"STARTING", "RECORDING"} and time.monotonic() < deadline:
                time.sleep(0.02)
            if self.runner.worker.is_alive() and self.runner.status(request["sessionId"])["phase"] == "OPERATING":
                if request["operation"] == "FORWARD":
                    self.runner.input(request["sessionId"], "press", 1)
                    for sequence in range(2, 6):
                        time.sleep(0.09)
                        self.runner.input(request["sessionId"], "hold", sequence)
                    self.runner.input(request["sessionId"], "release", 6)
                else:
                    time.sleep(0.35)
                    self.runner.input(request["sessionId"], "finish", 1)
        self.runner.worker.join(timeout=7)
        self.assertFalse(self.runner.worker.is_alive())
        return self.runner.status(request["sessionId"])

    def wait_phase(self, request, phase):
        deadline = time.monotonic() + 3
        while self.runner.status(request["sessionId"])["phase"] != phase:
            if time.monotonic() > deadline:
                self.fail("Phase not reached: " + phase)
            time.sleep(0.02)

    def test_skip_runs_without_camera_and_records_sent_commands_and_stop_response(self):
        self.runner.camera = None
        request = self.request()
        self.runner.start(request)
        record = self.finish(request)
        self.assertEqual(record["phase"], "CAPTURED")
        self.assertEqual(record["recording"]["state"], "UNAVAILABLE")
        self.assertTrue(record["stop"]["confirmed"])
        self.assertEqual(record["stop"]["response"], {"armed": False, "motors": False, "i2c": True})
        self.assertTrue(any(event["result"] == "SENT" and event["y"] == 1 and event["deviceSequence"] > 0 for event in record["commands"]))
        self.assertEqual(len(record["operationHash"]), 64)
        self.assertFalse(self.bridge.snapshot()["jobOccupied"])

    def test_video_records_pre_drive_and_post_stop_frames_with_hashes(self):
        request = self.request("VIDEO")
        self.runner.start(request)
        record = self.finish(request)
        self.assertEqual(record["phase"], "CAPTURED", record)
        self.assertEqual(record["recording"]["state"], "RECORDED")
        self.assertEqual(len(record["recording"]["sha256"]), 64)
        for phase in ("RECORDING", "OPERATING", "STOPPING"):
            self.assertGreaterEqual(sum(f["phase"] == phase for f in record["recording"]["frames"]), 3)
        self.assertTrue((Path(self.directory.name) / request["sessionId"] / "recording.mjpeg").is_file())

    def test_stationary_run_never_sends_nonzero_drive(self):
        request = self.request("VIDEO", "STILL")
        self.runner.start(request)
        record = self.finish(request)
        self.assertEqual(record["phase"], "CAPTURED")
        self.assertFalse(any(event["deadman"] and (event["x"] or event["y"] or event["z"]) for event in record["commands"]))

    def test_video_camera_failure_preserves_operation_records(self):
        self.stream.available = False
        request = self.request("VIDEO")
        self.runner.start(request)
        record = self.finish(request)
        self.assertEqual(record["phase"], "CAPTURED")
        self.assertTrue(record["forwardPressed"])
        self.assertEqual(record["recording"]["state"], "UNAVAILABLE")

    def test_changed_camera_configuration_is_rejected_before_arming(self):
        request = self.request("VIDEO")
        request["cameraUrl"] = "http://different-camera:81/stream"
        self.runner.start(request)
        record = self.finish(request)
        self.assertEqual(record["error"], "CAMERA_CONFIGURATION_CHANGED")
        self.assertEqual(self.controller.sent, [])

    def test_skip_optional_camera_failure_does_not_block_run(self):
        self.camera.status = lambda: (_ for _ in ()).throw(OSError("camera offline"))
        request = self.request()
        self.runner.start(request)
        record = self.finish(request)
        self.assertEqual(record["phase"], "CAPTURED")
        self.assertEqual(record["recording"]["state"], "ERROR")

    def test_camera_dropout_does_not_discard_operation_record(self):
        request = self.request("VIDEO")
        self.runner.start(request)
        self.wait_phase(request, "OPERATING")
        self.stream.available = False
        record = self.finish(request)
        self.assertEqual(record["phase"], "CAPTURED")
        self.assertTrue(record["forwardPressed"])
        self.assertTrue(record["stop"]["confirmed"])

    def test_job_and_free_drive_cannot_take_over_and_camera_settings_are_locked(self):
        request = self.request("VIDEO")
        self.runner.start(request)
        self.wait_phase(request, "RECORDING")
        with self.assertRaisesRegex(BridgeError, "ROVER_BUSY"):
            self.runner.start(self.request())
        with self.assertRaisesRegex(BridgeError, "ROVER_RESERVED"):
            self.bridge.activate()
        with self.assertRaisesRegex(ValueError, "CAMERA_RESERVED"):
            self.camera.set_enabled(False)
        self.runner.stop(request["sessionId"])
        self.assertEqual(self.finish(request)["phase"], "ERROR")
        self.assertIsNone(self.camera.job_owner)

    def test_stop_failure_is_not_a_completed_run(self):
        self.controller.stop_ok = False
        request = self.request()
        self.runner.start(request)
        record = self.finish(request)
        self.assertEqual(record["phase"], "ERROR")
        self.assertFalse(record["stop"]["confirmed"])

    def test_duplicate_start_never_drives_again_even_after_runner_restart(self):
        request = self.request()
        self.runner.start(request)
        self.runner.start(request)
        self.finish(request)
        count = len(self.controller.sent)
        restarted = RoverJobRunner(self.bridge, self.camera, self.directory.name)
        self.assertEqual(restarted.start(request)["phase"], "CAPTURED")
        self.assertEqual(len(self.controller.sent), count)
        with self.assertRaisesRegex(BridgeError, "RUN_CONDITIONS_CHANGED"):
            restarted.start({**request, "speed": 30})

    def test_interrupted_record_is_not_restarted_or_treated_as_complete(self):
        request = self.request()
        self.runner._save({"request": request, "phase": "OPERATING"})
        self.assertEqual(self.runner.start(request)["error"], "SESSION_INTERRUPTED")
        self.assertEqual(self.controller.sent, [])

    def test_expired_and_path_inputs_do_not_touch_hardware(self):
        request = self.request()
        with self.assertRaisesRegex(BridgeError, "SESSION_EXPIRED"):
            self.runner.start({**request, "expiresAt": 1})
        with self.assertRaises(BridgeError):
            self.runner.start({**request, "sessionId": "../../secret"})
        with self.assertRaises(BridgeError):
            self.runner.start({**request, "path": "recording.webm"})
        self.assertEqual(self.controller.sent, [])

    def test_no_press_is_false_with_video_and_no_forward_commands(self):
        request = self.request("VIDEO")
        self.runner.start(request)
        self.wait_phase(request, "OPERATING")
        self.runner.input(request["sessionId"], "finish", 1)
        record = self.finish(request, manual=False)
        self.assertIs(record["forwardPressed"], False)
        self.assertTrue(record["recording"]["frames"])
        self.assertFalse(any(e["y"] > 0 for e in record["commands"]))

    def test_input_timeout_stops_and_keeps_press_event_as_incomplete(self):
        request = self.request()
        request["durationMs"] = 3000
        self.runner.start(request)
        self.wait_phase(request, "OPERATING")
        self.runner.input(request["sessionId"], "press", 1)
        record = self.finish(request, manual=False)
        self.assertEqual(record["error"], "INPUT_TIMEOUT")
        self.assertIsNone(record["forwardPressed"])
        self.assertEqual(record["inputs"][0]["action"], "press")
        self.assertTrue(record["stop"]["confirmed"])

    def test_release_closes_input_and_stale_messages_do_not_restart_drive(self):
        request = self.request()
        self.runner.start(request)
        self.wait_phase(request, "OPERATING")
        self.runner.input(request["sessionId"], "press", 5)
        with self.assertRaisesRegex(BridgeError, "STALE_INPUT"):
            self.runner.input(request["sessionId"], "hold", 4)
        time.sleep(0.1)
        self.runner.input(request["sessionId"], "release", 6)
        with self.assertRaisesRegex(BridgeError, "INPUT_WINDOW_CLOSED"):
            self.runner.input(request["sessionId"], "press", 7)
        record = self.finish(request, manual=False)
        self.assertTrue(record["forwardPressed"])
        self.assertEqual([e["action"] for e in record["inputs"]], ["press", "release"])

    def test_failed_send_keeps_press_event_and_failed_command(self):
        request = self.request()
        self.runner.start(request)
        self.wait_phase(request, "OPERATING")
        self.controller.send = lambda command: (_ for _ in ()).throw(OSError("offline")) if command.y else 1
        self.runner.input(request["sessionId"], "press", 1)
        record = self.finish(request, manual=False)
        self.assertEqual(record["phase"], "ERROR")
        self.assertEqual(record["inputs"][0]["action"], "press")
        self.assertTrue(any(e["result"] == "FAILED" and e["y"] > 0 for e in record["commands"]))

    def test_duration_limit_stops_even_with_held_button(self):
        request = self.request()
        self.runner.camera = None
        self.runner.start(request)
        self.wait_phase(request, "OPERATING")
        self.runner.input(request["sessionId"], "press", 1)
        for sequence in range(2, 20):
            time.sleep(0.1)
            try:
                self.runner.input(request["sessionId"], "hold", sequence)
            except BridgeError:
                break
        record = self.finish(request, manual=False)
        self.assertEqual(record["phase"], "CAPTURED")
        self.assertTrue(record["forwardPressed"])
        self.assertLess(record["operationEndedAt"] - record["operationStartedAt"], 1)


if __name__ == "__main__":
    unittest.main()
