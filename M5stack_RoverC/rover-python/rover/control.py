from __future__ import annotations

import random
import socket
import threading
import time
from dataclasses import replace
from typing import Callable

from .api import DEFAULT_UDP_PORT, RoverAPI, RoverAPIError
from .models import ControlInput, Telemetry
from .protocol import ProtocolError, decode_telemetry, encode_control, newer_sequence


class RoverController:
    """Owns the ARM session and the low-latency UDP control socket."""

    def __init__(self, base_url: str, token: str) -> None:
        self.api = RoverAPI(base_url, token)
        self.token = token
        self.session_id = random.SystemRandom().randint(1, 0x7FFFFFFF)
        self.sequence = 0
        self.udp_port = DEFAULT_UDP_PORT
        self.armed = False
        self._lock = threading.RLock()
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._socket.bind(("", 0))
        self._socket.setblocking(False)
        self._destination: tuple[str, int] | None = None
        self.last_telemetry: Telemetry | None = None
        self.last_received_at = 0.0
        self.stream_error: str | None = None
        self._desired = ControlInput()
        self._desired_at = 0.0
        self._drive_source: Callable[[], ControlInput] | None = None
        self._emergency_down = True
        self._stop_requested = False
        self._delivered_telemetry: Telemetry | None = None
        self._stream_stop = threading.Event()
        self._stream_thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        return self.api.base_url

    def connect(self) -> dict:
        status = self.api.status()
        self.udp_port = int(status.get("udp_port", DEFAULT_UDP_PORT))
        self._destination = (socket.gethostbyname(self.api.host), self.udp_port)
        self.armed = bool(status.get("armed", False))
        return status

    def arm(self) -> dict:
        if self._destination is None:
            self.connect()
        with self._lock:
            self.session_id = random.SystemRandom().randint(1, 0x7FFFFFFF)
            self.sequence = 0
            result = self.api.arm(self.session_id)
            # Old DISARMED telemetry must not stop the newly acquired session.
            while True:
                try:
                    self._socket.recvfrom(1024)
                except BlockingIOError:
                    break
            self.last_telemetry = None
            self._delivered_telemetry = None
            self._desired = ControlInput()
            self._desired_at = 0.0
            self._drive_source = None
            self._emergency_down = True  # A held resume button is not a new stop.
            self._stop_requested = False
            self.armed = True
            return result

    def _send(self, command: ControlInput) -> None:
        if self._destination is None:
            raise RoverAPIError("Rover is not connected")
        self.sequence = (self.sequence + 1) & 0xFFFFFFFF
        if self.sequence == 0:
            self.sequence = 1
        packet = encode_control(command, self.session_id, self.sequence, self.token)
        self._socket.sendto(packet, self._destination)

    def send(self, command: ControlInput) -> int:
        with self._lock:
            if not self.armed:
                return self.sequence
            if self._stream_thread is not None:
                self._desired = replace(command)
                self._desired_at = time.monotonic()
                return ((self.sequence + 1) & 0xFFFFFFFF) or 1
            self._send(command)
            return self.sequence

    def start_stream(self) -> None:
        if self._stream_thread is None:
            self._stream_thread = threading.Thread(target=self._stream_loop, name="rover-udp", daemon=True)
            self._stream_thread.start()

    def set_drive_source(self, source: Callable[[], ControlInput] | None) -> None:
        with self._lock:
            self._drive_source = source

    def _stream_once(self, now: float) -> None:
        with self._lock:
            self._receive_socket()
            if not self.armed:
                return
            # A GUI freeze must not replay a mouse/servo command indefinitely.
            command = replace(self._desired) if now - self._desired_at <= 1.0 else ControlInput()
            if self._drive_source is not None:
                live = self._drive_source()
                command.x, command.y, command.z = live.x, live.y, live.z
                command.speed_limit = live.speed_limit
                command.deadman = live.deadman or command.gripper_angle is not None or command.aux_servo_angle is not None
                if live.emergency_stop and not self._emergency_down:
                    self._stop_requested = True
                self._emergency_down = live.emergency_stop
            if self._stop_requested:
                command = ControlInput(emergency_stop=True)
            self._send(command)

    def _stream_loop(self) -> None:
        while not self._stream_stop.is_set():
            started = time.monotonic()
            try:
                self._stream_once(started)
                self.stream_error = None
            except (OSError, RoverAPIError) as exc:
                self.stream_error = str(exc)
            self._stream_stop.wait(max(0.001, 0.04 - (time.monotonic() - started)))

    def receive_telemetry(self) -> Telemetry | None:
        with self._lock:
            if self._stream_thread is None:
                return self._receive_socket()
            newest = self.last_telemetry
            if newest is self._delivered_telemetry:
                return None
            self._delivered_telemetry = newest
            return newest

    def _receive_socket(self) -> Telemetry | None:
        newest = None
        while True:
            try:
                data, address = self._socket.recvfrom(1024)
            except BlockingIOError:
                break
            if self._destination is not None and address != self._destination:
                continue
            try:
                candidate = decode_telemetry(data)
                if newer_sequence(candidate.sequence, self.sequence):
                    continue
                previous = newest or self.last_telemetry
                if previous is not None:
                    if not newer_sequence(candidate.uptime_ms, previous.uptime_ms):
                        continue
                    if newer_sequence(previous.sequence, candidate.sequence):
                        continue
                newest = candidate
            except ProtocolError:
                continue
        if newest is not None:
            self.last_telemetry = newest
            self.armed = newest.armed
            self.last_received_at = time.monotonic()
        return newest

    def emergency_stop(self) -> None:
        with self._lock:
            self._desired = ControlInput()
            self._drive_source = None
            if self._destination is not None and self.armed:
                command = ControlInput(emergency_stop=True)
                for _ in range(3):
                    self._send(command)
            try:
                self.api.stop()
            finally:
                self.armed = False

    def disarm(self) -> None:
        try:
            if self.armed:
                self.api.disarm()
        finally:
            self.armed = False

    def close(self, send_stop: bool = True) -> None:
        self._stream_stop.set()
        if self._stream_thread is not None:
            self._stream_thread.join(timeout=2.0)
        try:
            if send_stop:
                self.emergency_stop()
        except RoverAPIError:
            self.armed = False
        finally:
            self._socket.close()
