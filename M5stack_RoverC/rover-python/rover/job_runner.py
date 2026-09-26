"""Server-owned Rover runs with persistent command and camera records."""
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import time
import uuid

from .web_bridge import BridgeError


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class RoverJobRunner:
    def __init__(self, bridge, camera, root):
        self.bridge, self.camera, self.root = bridge, camera, Path(root).resolve()
        self.lock = threading.RLock()
        self.active = None
        self.cancelled = threading.Event()
        self.worker = None

    def _directory(self, session):
        if not isinstance(session, str) or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", session):
            raise BridgeError("INVALID_SESSION_ID")
        return self.root / session

    def _save(self, record):
        with self.lock:
            path = self._directory(record["request"]["sessionId"])
            path.mkdir(parents=True, exist_ok=True)
            temporary = path / (str(uuid.uuid4()) + ".tmp")
            with temporary.open("x", encoding="utf-8") as output:
                json.dump(record, output, sort_keys=True, separators=(",", ":"))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path / "run.json")

    def status(self, session):
        with self.lock:
            try:
                record = json.loads((self._directory(session) / "run.json").read_text(encoding="utf-8"))
            except FileNotFoundError:
                raise BridgeError("SESSION_NOT_FOUND") from None
            if record["phase"] in {"STARTING", "RECORDING", "OPERATING", "STOPPING"} and self.active != session:
                record.update(phase="ERROR", error="SESSION_INTERRUPTED")
                self._save(record)
            return record

    def start(self, request):
        required = {"sessionId", "jobId", "chainId", "core", "judgmentMode", "operation", "durationMs", "speed", "cameraUrl", "conditionsHash", "policyHash", "expiresAt"}
        if not isinstance(request, dict) or set(request) != required:
            raise BridgeError("INVALID_RUN_REQUEST")
        if request["judgmentMode"] == "VIDEO" and not isinstance(request["cameraUrl"], str):
            raise BridgeError("CAMERA_CONFIGURATION_REQUIRED")
        directory = self._directory(request["sessionId"])
        if (not isinstance(request["jobId"], str) or not re.fullmatch(r"[1-9][0-9]{0,77}", request["jobId"])
                or type(request["chainId"]) is not int or request["chainId"] <= 0
                or not isinstance(request["core"], str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", request["core"])
                or request["judgmentMode"] not in {"VIDEO", "SKIP_VIDEO"}
                or request["operation"] not in {"FORWARD", "STILL"}
                or type(request["durationMs"]) is not int or not 500 <= request["durationMs"] <= 5000
                or type(request["speed"]) is not int or not 1 <= request["speed"] <= 50
                or type(request["expiresAt"]) is not int):
            raise BridgeError("INVALID_RUN_REQUEST")
        for key in ("conditionsHash", "policyHash"):
            if not isinstance(request[key], str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", request[key]):
                raise BridgeError("INVALID_RUN_REQUEST")
        with self.lock:
            if (directory / "run.json").exists():
                record = self.status(request["sessionId"])
                if record["request"] != request:
                    raise BridgeError("RUN_CONDITIONS_CHANGED")
                return record
            if request["expiresAt"] <= time.time():
                raise BridgeError("SESSION_EXPIRED")
            if self.active is not None:
                raise BridgeError("ROVER_BUSY")
            self.bridge.claim_job(request["sessionId"])
            try:
                record = {"version": 1, "request": request, "phase": "STARTING", "createdAt": time.time(),
                          "commands": [], "stop": None, "recording": {"state": "PENDING", "frames": []}}
                self._save(record)
                self.active = request["sessionId"]
                self.cancelled.clear()
                response = json.loads(json.dumps(record))
                self.worker = threading.Thread(target=self._run, args=(record,), name="rover-job", daemon=True)
                self.worker.start()
                return response
            except Exception:
                self.active = None
                self.bridge.release_job(request["sessionId"])
                raise

    def stop(self, session):
        with self.lock:
            if self.active != session:
                return self.status(session)
            self.cancelled.set()
        with self.bridge.lock:
            self.bridge.request_stop(None if self.bridge.state == "connecting" else self.bridge.session)
        return {"ok": True, "phase": "STOPPING"}

    def _wait(self, seconds, record, *, check_control=True):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.cancelled.wait(min(0.04, max(0, deadline - time.monotonic()))):
                raise BridgeError("RUN_CANCELLED")
            if time.time() >= record["request"]["expiresAt"]:
                raise BridgeError("SESSION_EXPIRED")
            if check_control and self.bridge.snapshot()["state"] not in {"ready", "commanding"}:
                raise BridgeError("CONTROL_INTERRUPTED")

    def _capture(self, record, ended):
        recording = record["recording"]
        directory = self._directory(record["request"]["sessionId"])
        frames = recording["frames"]
        previous, total = None, 0
        try:
            with (directory / "recording.mjpeg").open("xb") as video:
                while not ended.is_set():
                    data, received = self.camera.frame()
                    if data and received != previous and 0 <= time.monotonic() - received < 0.5:
                        if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9") or len(data) > 2_000_000:
                            raise BridgeError("INVALID_CAMERA_FRAME")
                        if len(frames) >= 200 or total + len(data) > 64 * 1024 * 1024:
                            raise BridgeError("RECORDING_LIMIT")
                        index = len(frames)
                        name = f"{index:04d}.jpg"
                        (directory / name).write_bytes(data)
                        video.write(data)
                        frames.append({"index": index, "sha256": hashlib.sha256(data).hexdigest(),
                                       "receivedAtMonotonic": received, "capturedAt": time.time(), "phase": record["phase"]})
                        total += len(data)
                        previous = received
                    ended.wait(0.1)
            recording.update(state="RECORDED" if frames else "UNAVAILABLE", bytes=total,
                             sha256=hashlib.sha256((directory / "recording.mjpeg").read_bytes()).hexdigest() if frames else None,
                             framesHash=digest(frames))
        except Exception as error:
            recording.update(state="ERROR", error=str(error) if isinstance(error, BridgeError) else "RECORDING_FAILED")

    def _run(self, record):
        request = record["request"]
        session, control_session = request["sessionId"], None
        capture = None
        ended = threading.Event()
        camera_owned = False
        try:
            # VIDEO acquires camera frames before arming the Rover.
            try:
                if self.camera and (request["judgmentMode"] == "VIDEO" or self.camera.status()["receiving"]):
                    self.camera.claim_job(session)
                    camera_owned = True
                    if request["judgmentMode"] == "VIDEO" and self.camera.status()["url"] != request["cameraUrl"]:
                        raise BridgeError("CAMERA_CONFIGURATION_CHANGED")
                    record["phase"] = "RECORDING"
                    self._save(record)
                    capture = threading.Thread(target=self._capture, args=(record, ended), name="rover-recording", daemon=True)
                    capture.start()
                    if request["judgmentMode"] == "VIDEO":
                        self._wait(0.6, record, check_control=False)
                        if len(record["recording"]["frames"]) < 3:
                            raise BridgeError("RECORDING_UNAVAILABLE")
                elif request["judgmentMode"] == "VIDEO":
                    raise BridgeError("CAMERA_UNAVAILABLE")
                else:
                    record["recording"]["state"] = "UNAVAILABLE"
            except Exception:
                if request["judgmentMode"] == "VIDEO":
                    raise
                record["recording"].update(state="ERROR", error="RECORDING_UNAVAILABLE")
            if self.cancelled.is_set():
                raise BridgeError("RUN_CANCELLED")
            control_session = self.bridge.activate(owner=session)["session"]
            deadline = time.monotonic() + 2
            while not self.bridge.snapshot()["telemetryFresh"]:
                if time.monotonic() >= deadline:
                    raise BridgeError("TELEMETRY_UNAVAILABLE")
                self._wait(0.04, record)
            record["phase"] = "OPERATING"
            record["operationStartedAt"] = time.time()
            self._save(record)
            deadline = time.monotonic() + request["durationMs"] / 1000
            sequence = 0
            while time.monotonic() < deadline:
                if request["operation"] == "FORWARD":
                    sequence += 1
                    self.bridge.drive(control_session, sequence, "forward", request["speed"], owner=session)
                self._wait(min(0.12, max(0, deadline - time.monotonic())), record)
            record["operationEndedAt"] = time.time()
            record["phase"] = "STOPPING"
            self._save(record)
            self.bridge.request_stop(control_session)
            deadline = time.monotonic() + 5
            while self.bridge.snapshot()["state"] not in {"idle", "error"}:
                if time.monotonic() >= deadline:
                    raise BridgeError("STOP_UNCONFIRMED")
                time.sleep(0.04)
            with self.bridge.lock:
                if not self.bridge.stop_result or not self.bridge.stop_result.get("confirmed") or self.bridge.state != "idle":
                    raise BridgeError("STOP_UNCONFIRMED")
                if request["operation"] == "FORWARD" and not any(event["result"] == "SENT" and event["deadman"] and event["y"] > 0 for event in self.bridge.send_events):
                    raise BridgeError("DRIVE_NOT_SENT")
            if capture:
                self._wait(0.6, record, check_control=False)
            record["phase"] = "CAPTURED"
        except Exception as error:
            record.update(phase="ERROR", error=str(error) if isinstance(error, (BridgeError, ValueError)) else "RUN_FAILED")
        finally:
            with self.bridge.lock:
                if self.bridge.controller is not None:
                    self.bridge._stop_locked(failed=record["phase"] == "ERROR")
                record["commands"] = list(self.bridge.send_events)
                record["stop"] = self.bridge.stop_result
            ended.set()
            if capture:
                capture.join(timeout=3)
                if capture.is_alive():
                    record.update(phase="ERROR", error="RECORDING_SHUTDOWN_FAILED")
            if record["phase"] == "CAPTURED" and request["judgmentMode"] == "VIDEO":
                frames = record["recording"]["frames"]
                if (record["recording"]["state"] != "RECORDED"
                        or sum(f["phase"] == "RECORDING" for f in frames) < 3
                        or sum(f["phase"] == "OPERATING" for f in frames) < 3
                        or sum(f["phase"] == "STOPPING" for f in frames) < 3):
                    record.update(phase="ERROR", error="RECORDING_INCOMPLETE")
            record["completedAt"] = time.time()
            record["operationHash"] = digest({"request": request, "commands": record["commands"], "stop": record["stop"]})
            try:
                self._save(record)
            finally:
                if camera_owned:
                    self.camera.release_job(session)
                self.bridge.release_job(session)
                with self.lock:
                    self.active = None

    def close(self):
        self.cancelled.set()
        if self.worker:
            self.worker.join(timeout=8)
