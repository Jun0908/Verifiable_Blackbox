from __future__ import annotations

import threading
import time
from urllib.parse import urlparse

import requests


def stream_url(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if "://" not in value:
        value = "http://" + value
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Enter the camera's HTTP address")
    if parsed.path in ("", "/"):
        port = parsed.port or 81
        return f"{parsed.scheme}://{parsed.hostname}:{port}/stream"
    return value


class JpegFrames:
    """Extract JPEG frames across arbitrary multipart/network chunk boundaries."""

    def __init__(self) -> None:
        self.buffer = bytearray()

    def feed(self, chunk: bytes) -> list[bytes]:
        self.buffer.extend(chunk)
        frames = []
        while True:
            start = self.buffer.find(b"\xff\xd8")
            if start < 0:
                self.buffer[:] = self.buffer[-1:]
                break
            if start:
                del self.buffer[:start]
            end = self.buffer.find(b"\xff\xd9", 2)
            if end >= 2_000_000:
                self.buffer.clear()
                raise ValueError("Camera frame exceeds 2 MB")
            if end < 0:
                if len(self.buffer) > 2_000_000:
                    self.buffer.clear()
                    raise ValueError("Camera frame exceeds 2 MB")
                break
            frames.append(bytes(self.buffer[:end + 2]))
            del self.buffer[:end + 2]
        return frames


class CameraStream:
    """Network I/O stays off the GUI and control threads; only the newest frame is kept."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._changed = threading.Event()
        self._thread: threading.Thread | None = None
        self._url = ""
        self._frame: bytes | None = None
        self._received_at = 0.0
        self._error = ""

    def configure(self, url: str) -> None:
        normalized = stream_url(url)
        with self._lock:
            self._url = normalized
            self._frame = None
            self._received_at = 0.0
            self._error = ""
        self._changed.set()
        if normalized and self._thread is None:
            self._thread = threading.Thread(target=self._run, name="rover-camera", daemon=True)
            self._thread.start()

    def snapshot(self):
        with self._lock:
            return self._frame, self._received_at, self._error, self._url

    def _run(self) -> None:
        session = requests.Session()
        session.trust_env = False
        try:
            while not self._stop.is_set():
                self._changed.clear()
                with self._lock:
                    url = self._url
                if not url:
                    self._changed.wait(0.2)
                    continue
                try:
                    with session.get(url, stream=True, timeout=(2, 2)) as response:
                        response.raise_for_status()
                        content_type = response.headers.get("Content-Type", "").lower()
                        if "multipart" not in content_type and "image/jpeg" not in content_type:
                            raise ValueError("Camera URL is not a JPEG stream")
                        parser = JpegFrames()
                        for chunk in response.iter_content(1024):
                            if self._stop.is_set() or self._changed.is_set():
                                break
                            frames = parser.feed(chunk)
                            if frames:
                                with self._lock:
                                    if url == self._url:
                                        self._frame = frames[-1]
                                        self._received_at = time.monotonic()
                                        self._error = ""
                    if not self._changed.is_set() and not self._stop.is_set():
                        raise ValueError("Camera stream ended")
                except (requests.RequestException, ValueError) as exc:
                    with self._lock:
                        if url == self._url:
                            self._error = str(exc)
                if not self._stop.is_set():
                    self._changed.wait(1.0)
        finally:
            session.close()

    def close(self) -> None:
        self._stop.set()
        self._changed.set()
        if self._thread is not None:
            self._thread.join(timeout=3.0)
