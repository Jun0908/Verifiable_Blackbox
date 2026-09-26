"""Local operation only. Motor commands are never physical-work evidence."""
import secrets
import threading
import time
from .models import ControlInput
from .config import RoverSettings
from .protocol import newer_sequence

DIRECTIONS = {"forward": (0,1,0), "back": (0,-1,0), "left": (-1,0,0),
              "right": (1,0,0), "turn-left": (0,0,-1), "turn-right": (0,0,1)}

class BridgeError(ValueError):
    pass

class RoverWebBridge:
    LEASE_SECONDS = 0.45
    IDLE_SECONDS = 60.0
    GRIPPER_STEP_DEGREES = 2

    def __init__(self, controller_factory, evidence_client=None, *, clock=time.monotonic, settings=None):
        self.factory, self.evidence_client, self.clock = controller_factory, evidence_client, clock
        self.settings = settings or RoverSettings()
        self.gripper_action = self.gripper_sequence = None
        self.gripper_deadline = self.gripper_next_step = 0.0
        self.lock = threading.RLock()
        self.controller = self.session = self.last_telemetry = None
        self.state, self.message = "idle", "Connect to test the robot. No payment is triggered."
        self.sequence, self.deadline, self.telemetry_at = -1, 0, 0
        self.command = ControlInput()
        self.motor_output_seen = False
        self.last_uptime = -1
        self.needs_release = False
        self.activation_epoch = 0
        self.job_owner = None
        self.send_events = []
        self.stop_result = None

    def claim_job(self, owner):
        with self.lock:
            if self.job_owner is not None or self.state not in {"idle", "error"}:
                raise BridgeError("ROVER_BUSY")
            self.job_owner = owner
            self.send_events = []
            self.stop_result = None

    def release_job(self, owner):
        with self.lock:
            if self.job_owner == owner:
                if self.controller is not None:
                    raise BridgeError("STOP_REQUIRED")
                self.job_owner = None

    def _owner(self, owner):
        if self.job_owner is not None and self.job_owner != owner:
            raise BridgeError("ROVER_RESERVED")

    def _send(self, command):
        event = {"sessionId": self.job_owner, "sequence": self.sequence, "sentAt": time.time(),
                 "x": command.x, "y": command.y, "z": command.z, "speed": command.speed_limit,
                 "deadman": command.deadman}
        try:
            sequence = self.controller.send(command)
            event.update({"result": "SENT", "deviceSequence": sequence})
            return sequence
        except Exception:
            event["result"] = "FAILED"
            raise
        finally:
            if self.job_owner is not None and len(self.send_events) < 2000:
                self.send_events.append(event)

    def snapshot(self):
        with self.lock:
            fresh = self.last_telemetry is not None and self.clock() - self.telemetry_at <= 0.8 and self.controller is not None
            telemetry = self.last_telemetry if fresh else None
            return {"ok": True, "state": self.state, "message": self.message,
                    "telemetryFresh": fresh, "controlPaused": self.needs_release, "motorOutputSeen": self.motor_output_seen,
                    "motorsRunning": telemetry.motors_running if telemetry else None,
                    "motors": list(telemetry.motors) if telemetry else None,
                    "rssi": telemetry.rssi if telemetry else None,
                    "gripperAngle": getattr(telemetry, "gripper_angle", None),
                    "physicalMovementVerified": False, "paymentEnabled": False,
                    "jobOccupied": self.job_owner is not None}

    def activate(self, *_unused, owner=None):
        with self.lock:
            self._owner(owner)
            if self.state in {"connecting","ready","commanding","stopping"}:
                raise BridgeError("A control session is already active. Stop it before reconnecting.")
            self.state = "connecting"
            self.activation_epoch += 1
            epoch = self.activation_epoch
        controller, armed_here = None, False
        try:
            controller = self.factory()
            status = controller.connect()
            if status.get("armed"):
                raise BridgeError("Close the Windows Rover app and stop the robot before connecting.")
            controller.api.configure(85)
            controller.arm()
            armed_here = True
            controller.send(ControlInput(speed_limit=35))
            with self.lock:
                if epoch != self.activation_epoch:
                    raise BridgeError("Connection was cancelled.")
                self.controller = controller
                self.session = secrets.token_urlsafe(24)
                self.sequence = -1
                self._clear_gripper()
                self.command, self.motor_output_seen = ControlInput(speed_limit=35), False
                self.last_telemetry = None
                self.last_uptime = -1
                self.needs_release = False
                self.telemetry_at = self.clock()
                self.deadline = self.clock() + self.IDLE_SECONDS
                self.state = "ready"
                self.message = "Connected. Hold a direction to send commands; release to stop."
                return {**self.snapshot(), "session": self.session}
        except Exception as exc:
            if controller:
                try: controller.close(send_stop=armed_here)
                except Exception: pass
            with self.lock:
                self.state = "error"
                if "10013" in str(exc) or "Permission denied" in str(exc):
                    self.message = "Robot network access is blocked. Restart the launcher with LAN access."
                else:
                    self.message = str(exc) if isinstance(exc, BridgeError) else "Cannot connect. Check the robot power and Wi-Fi."
            raise BridgeError(self.message) from None

    def _validate(self, session, sequence, owner=None):
        self._owner(owner)
        if session != self.session or self.state not in {"ready","commanding"}:
            raise BridgeError("Control session ended. Reconnect to continue.")
        if type(sequence) is not int or not 0 <= sequence <= 2**53 - 1:
            raise BridgeError("Invalid sequence.")
        if sequence <= self.sequence:
            raise BridgeError("Stale command rejected.")
        if self.clock() >= self.deadline:
            if self.state == "commanding":
                self._pause_locked()
                if self.state != "ready":
                    raise BridgeError("Control session ended. Reconnect to continue.")
            else:
                raise BridgeError("Control signal expired. Wait for the robot to stop.")

    def drive(self, session, sequence, direction, speed, *, owner=None):
        with self.lock:
            self._validate(session, sequence, owner)
            if self.needs_release:
                raise BridgeError("Controls paused. Release the direction and try again.")
            valid_speed = type(speed) is int and (1 <= speed <= 50 if owner is not None else speed in {35,60,85})
            if not isinstance(direction, str) or direction not in DIRECTIONS or not valid_speed:
                raise BridgeError("Invalid direction or speed.")
            if not self.last_telemetry or self.clock() - self.telemetry_at > 0.8:
                raise BridgeError("Waiting for robot telemetry. No movement command sent.")
            self.sequence = sequence
            self._clear_gripper()
            x,y,z = DIRECTIONS[direction]
            self.command = ControlInput(x=x,y=y,z=z,deadman=True,speed_limit=speed)
            self.deadline = self.clock() + self.LEASE_SECONDS
            self.state, self.message = "commanding", "Sending drive commands. Physical movement is not verified."
            return self.snapshot()

    def _clear_gripper(self):
        self.gripper_action = self.gripper_sequence = None
        self.gripper_deadline = self.gripper_next_step = 0.0

    def gripper(self, session, sequence, action):
        with self.lock:
            self._validate(session, sequence)
            if self.needs_release:
                raise BridgeError("Controls paused. Release the direction and try again.")
            if action not in {"open", "close"}:
                raise BridgeError("Invalid gripper action.")
            telemetry = self.last_telemetry
            angle = getattr(telemetry, "gripper_angle", None)
            if type(angle) is not int or self.clock() - self.telemetry_at > 0.8:
                raise BridgeError("Waiting for robot telemetry. No gripper command sent.")
            lower = max(10, self.settings.gripper_min_angle)
            upper = min(90, self.settings.gripper_max_angle)
            opened, closed = self.settings.gripper_open_angle, self.settings.gripper_closed_angle
            if not lower <= opened <= upper or not lower <= closed <= upper:
                raise BridgeError("Invalid gripper settings.")
            self.sequence = sequence
            self.deadline = self.clock() + self.LEASE_SECONDS
            self.state = "commanding"
            if self.gripper_action == action and self.command.gripper_angle is not None:
                return self.snapshot()  # Retry the same target until its sequence is acknowledged.
            if action == "close" and self.clock() < self.gripper_next_step:
                return self.snapshot()
            target = opened if action == "open" else angle + max(-self.GRIPPER_STEP_DEGREES, min(self.GRIPPER_STEP_DEGREES, closed - angle))
            target = max(lower, min(upper, target))
            self.command = ControlInput(gripper_angle=target, deadman=True)
            self.gripper_action = action
            self.gripper_deadline = self.clock() + 1.0
            self.gripper_next_step = self.clock() + 0.12
            try:
                # Send immediately so a short click is not lost between control ticks.
                self.gripper_sequence = self._send(self.command)
            except Exception:
                self._stop_locked(failed=True)
                raise BridgeError("Gripper command could not be sent.") from None
            self.message = "Sending gripper command."
            return self.snapshot()

    def release(self, session, sequence):
        with self.lock:
            self._validate(session, sequence)
            self.sequence = sequence
            self.needs_release = False
            self._clear_gripper()
            self.command = ControlInput(speed_limit=35)
            self.deadline = self.clock() + self.IDLE_SECONDS
            # Send zero immediately; old drive requests cannot override its sequence.
            try:
                self._send(self.command)
                self.state, self.message = "ready", "Controls released. No payment is triggered."
            except Exception:
                self._stop_locked(failed=True)
            return self.snapshot()

    def request_stop(self, session):
        with self.lock:
            if self.state == "connecting" and session is None:
                self.activation_epoch += 1
                self.state, self.message = "stopping", "Cancelling connection."
                return self.snapshot()
            if session != self.session:
                raise BridgeError("Control session does not match.")
            if self.state in {"ready","commanding"}:
                self.state, self.message = "stopping", "Stopping the robot."
                self._clear_gripper()
                self.command = ControlInput()
            return self.snapshot()

    def tick(self):
        with self.lock:
            if self.state not in {"ready","commanding","stopping"}: return
            if self.clock() >= self.deadline:
                if self.state == "commanding":
                    self._pause_locked()
                    if self.state != "ready": return
                else: self.state = "stopping"
            if self.state == "stopping":
                if self.controller is not None: self._stop_locked()
                return
            try:
                # Read queued responses before deciding that telemetry has expired.
                telemetry = self.controller.receive_telemetry()
                if telemetry and (self.last_uptime < 0 or newer_sequence(telemetry.uptime_ms, self.last_uptime)) and telemetry.packet_age_ms <= 450:
                    self.last_uptime = telemetry.uptime_ms
                    self.telemetry_at = self.clock()
                    self.last_telemetry = telemetry
                    if not telemetry.armed or not telemetry.i2c_ok:
                        raise BridgeError("Robot stopped or motor controller is unavailable.")
                    if self.command.deadman and telemetry.motors_running and any(telemetry.motors):
                        self.motor_output_seen = True
                if self.command.gripper_angle is not None:
                    if (telemetry is self.last_telemetry and telemetry is not None
                            and self.gripper_sequence is not None
                            and telemetry.sequence >= self.gripper_sequence
                            and telemetry.gripper_angle == self.command.gripper_angle):
                        self.command = ControlInput()
                        self.gripper_sequence = None
                        self.gripper_deadline = 0.0
                        if self.gripper_action == "open":
                            self._clear_gripper()
                            self.state = "ready"
                            self.deadline = self.clock() + self.IDLE_SECONDS
                    elif self.clock() >= self.gripper_deadline:
                        self._pause_locked()
                if not self.controller.armed or self.clock() - self.telemetry_at > 0.8:
                    raise BridgeError("Robot telemetry is unavailable.")
                self._send(self.command)
            except Exception:
                self._stop_locked(failed=True)

    def _pause_locked(self):
        # Stop at the SAME 450 ms deadline. Keep the existing idle connection,
        # but reject ALL subsequent drive packets until an explicit release.
        self._clear_gripper()
        self.command = ControlInput(speed_limit=35)
        self.needs_release = True
        self.deadline = self.clock() + self.IDLE_SECONDS
        try:
            self._send(self.command)
            self.state, self.message = "ready", "Controls paused. Release the direction and try again."
        except Exception:
            self._stop_locked(failed=True)

    def _stop_locked(self, failed=False):
        self._clear_gripper()
        self.stop_result = {"requestedAt": time.time(), "confirmed": False}
        try:
            self.controller.emergency_stop()
            status = self.controller.api.status()
            self.stop_result["response"] = {key: status.get(key) for key in ("armed", "motors", "i2c")}
            if status.get("armed") is not False or status.get("motors") is not False or status.get("i2c") is not True:
                raise BridgeError("Stop could not be confirmed.")
            self.stop_result.update({"confirmed": True, "confirmedAt": time.time()})
        except Exception: failed = True
        finally:
            try: self.controller.close(send_stop=False)
            except Exception: failed = True
            self.controller = None
        self.command = ControlInput()
        self.state = "error" if failed else "idle"
        self.message = "Robot response lost. Check that it has stopped. No payment was triggered." if failed else "Stopped. No payment was triggered."

    def shutdown(self):
        with self.lock:
            self.activation_epoch += 1
            if self.controller: self._stop_locked()
            self.state = "offline"
