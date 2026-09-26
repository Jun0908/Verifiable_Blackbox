from __future__ import annotations

import json
import os
import socket
import time
from typing import Any
from urllib.parse import urlparse

import requests

DISCOVERY_MESSAGE = b"ROVER_DISCOVER_V1"
DEFAULT_UDP_PORT = 4210


class RoverAPIError(RuntimeError):
    pass


class RoverAPI:
    def __init__(self, base_url: str, token: str, timeout: float = 3.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    @property
    def host(self) -> str:
        parsed = urlparse(self.base_url)
        if not parsed.hostname:
            raise RoverAPIError(f"Invalid Rover URL: {self.base_url}")
        return socket.gethostbyname(parsed.hostname)

    def request(
        self, method: str, path: str, form: dict[str, int] | None = None
    ) -> dict[str, Any]:
        try:
            response = requests.request(
                method,
                f"{self.base_url}{path}",
                data=form,
                headers={
                    "X-Rover-Token": self.token,
                    "Connection": "close",
                },
                timeout=self.timeout,
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            raise RoverAPIError(str(exc)) from exc
        try:
            payload = response.json()
        except requests.JSONDecodeError as exc:
            raise RoverAPIError(
                f"HTTP {response.status_code}: invalid JSON response"
            ) from exc
        if not isinstance(payload, dict):
            raise RoverAPIError("Invalid Rover response")
        if not 200 <= response.status_code < 300 or payload.get("ok") is False:
            message = payload.get("error", json.dumps(payload, ensure_ascii=False))
            raise RoverAPIError(f"HTTP {response.status_code}: {message}")
        return payload

    def status(self) -> dict[str, Any]:
        required = os.getenv("ROVER_REQUIRED_WIFI_PROFILE")
        if required:
            network = self.request("GET", "/network")
            if network.get("profile") != required or network.get("connected") is not True:
                raise RoverAPIError(f"Rover is not connected to the required {required} network")
        return self.request("GET", "/status")

    def arm(self, session_id: int) -> dict[str, Any]:
        return self.request("POST", "/arm", {"session_id": session_id})

    def disarm(self) -> dict[str, Any]:
        return self.request("POST", "/disarm")

    def stop(self) -> dict[str, Any]:
        return self.request("POST", "/stop")

    def configure(
        self, speed_limit: int, motor_signs: list[int] | None = None
    ) -> dict[str, Any]:
        form = {"speed_limit": speed_limit}
        if motor_signs is not None and len(motor_signs) == 4:
            form.update(
                {f"m{index + 1}_sign": int(sign) for index, sign in enumerate(motor_signs)}
            )
        return self.request("POST", "/config", form)

    def diagnostic_drive(
        self, session_id: int, motors: tuple[int, int, int, int], duration_ms: int
    ) -> dict[str, Any]:
        return self.request(
            "POST",
            "/drive",
            {
                "session_id": session_id,
                "m1": motors[0],
                "m2": motors[1],
                "m3": motors[2],
                "m4": motors[3],
                "duration_ms": duration_ms,
            },
        )


def discover_rovers(timeout: float = 0.7, port: int = DEFAULT_UDP_PORT) -> list[dict]:
    """Find Rover firmware by mDNS name, then by LAN UDP broadcast."""
    found: dict[str, dict] = {}
    try:
        ip = socket.gethostbyname("roverc.local")
        found[ip] = {
            "name": "RoverC Pro",
            "host": "roverc.local",
            "ip": ip,
            "http_port": 80,
            "udp_port": port,
            "protocol": 2,
        }
    except OSError:
        pass

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.bind(("", 0))
        sock.settimeout(0.1)
        sock.sendto(DISCOVERY_MESSAGE, ("255.255.255.255", port))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                data, address = sock.recvfrom(1024)
            except TimeoutError:
                continue
            try:
                payload = json.loads(data.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict) and payload.get("protocol") == 2:
                payload.setdefault("ip", address[0])
                found[payload["ip"]] = payload
    finally:
        sock.close()
    return list(found.values())
