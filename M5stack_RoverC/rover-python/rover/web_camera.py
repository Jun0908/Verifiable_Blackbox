"""Shared camera receiver for local browser previews; no robot commands."""
import threading
import time
from .camera import CameraStream, stream_url
from .config import load_rover_settings, save_rover_settings


class WebCamera:
    def __init__(self, stream=None, *, clock=time.monotonic):
        self.stream = stream if stream is not None else CameraStream()
        self.clock = clock
        self.lock = threading.RLock()
        self.enabled = True
        self.url = ""
        self.job_owner = None

    def claim_job(self, owner):
        with self.lock:
            if self.job_owner is not None:
                raise ValueError("CAMERA_BUSY")
            self.job_owner = owner

    def release_job(self, owner):
        with self.lock:
            if self.job_owner == owner:
                self.job_owner = None

    def start(self):
        settings = load_rover_settings()
        self.enabled = settings.camera_enabled
        self.url = settings.camera_url
        self.stream.configure(self.url if self.enabled else "")

    def configure(self, url):
        if not isinstance(url, str) or len(url) > 1024:
            raise ValueError("Invalid camera address")
        normalized = stream_url(url)
        with self.lock:
            if self.job_owner is not None:
                raise ValueError("CAMERA_RESERVED")
            # Read the current settings so unrelated GUI changes are preserved.
            settings = load_rover_settings()
            settings.camera_url = normalized
            save_rover_settings(settings)
            self.url = normalized
            self.stream.configure(normalized if self.enabled else "")
        return self.status()

    def set_enabled(self, enabled):
        if not isinstance(enabled, bool):
            raise ValueError("Invalid camera state")
        with self.lock:
            if self.job_owner is not None:
                raise ValueError("CAMERA_RESERVED")
            settings = load_rover_settings()
            settings.camera_enabled = enabled
            save_rover_settings(settings)
            self.enabled = enabled
            self.url = settings.camera_url
            self.stream.configure(self.url if enabled else "")
        return self.status()

    def frame(self):
        data, received, error, url = self.stream.snapshot()
        fresh = bool(self.enabled and url and data and not error and 0 <= self.clock() - received < 2.0)
        return (data, received) if fresh else (None, received)

    def status(self):
        data, received, error, url = self.stream.snapshot()
        fresh = bool(self.enabled and url and data and not error and 0 <= self.clock() - received < 2.0)
        return {"url": self.url or url, "configured": bool(self.url or url),
                "enabled": self.enabled, "receiving": fresh}

    def close(self):
        self.stream.close()
