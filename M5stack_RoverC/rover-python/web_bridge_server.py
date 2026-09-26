"""Local bridge for the dashboard, or standalone browser controls with --web."""
import argparse
from datetime import datetime
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
import os
from pathlib import Path
import secrets
import signal
import threading
import webbrowser
from urllib.parse import parse_qs, urlsplit
from rover.config import app_settings, load_rover_settings
from rover.control import RoverController
from rover.web_bridge import BridgeError, RoverWebBridge

WEB_ROOT = Path(__file__).resolve().parent / "web"
RECORDINGS_ROOT = WEB_ROOT.parent / "recordings"
MAX_RECORDING_BYTES = 128 * 1024 * 1024


def create_handler(bridge, token, *, serve_web=False, port=8765, camera=None, recordings_root=RECORDINGS_ROOT, jobs=None):
    hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
    assets = {"/": ("index.html", "text/html; charset=utf-8"),
              "/app.js": ("app.js", "text/javascript; charset=utf-8"),
              "/camera.js": ("camera.js", "text/javascript; charset=utf-8"),
              "/style.css": ("style.css", "text/css; charset=utf-8")}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def send_bytes(self, status, data, content_type, headers=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def reply(self, status, body):
            self.send_bytes(status, json.dumps(body).encode(), "application/json")

        def local_page_request(self):
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            return (host in hosts
                    and (not origin or origin == f"http://{host}")
                    and self.headers.get("Sec-Fetch-Site") not in {"cross-site", "same-site"})

        def authorized(self):
            return hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)

        def do_GET(self):
            if serve_web and not self.local_page_request():
                return self.reply(403, {"error": "Local browser only"})
            if serve_web and self.path in assets:
                filename, content_type = assets[self.path]
                data = (WEB_ROOT / filename).read_bytes()
                if filename == "index.html":
                    data = data.replace(b"__BRIDGE_TOKEN__", token.encode())
                return self.send_bytes(200, data, content_type)
            if not self.authorized():
                return self.reply(403, {"error": "Forbidden"})
            if jobs is not None and urlsplit(self.path).path == "/jobs/status":
                try:
                    session = parse_qs(urlsplit(self.path).query).get("sessionId", [None])[0]
                    return self.reply(200, jobs.status(session))
                except (ValueError, KeyError, OSError):
                    return self.reply(409, {"error": "SESSION_UNAVAILABLE"})
            if camera is not None and self.path == "/camera":
                return self.reply(200, camera.status())
            if camera is not None and self.path == "/camera/frame":
                data, received = camera.frame()
                if data is None:
                    return self.send_bytes(204, b"", "image/jpeg")
                return self.send_bytes(200, data, "image/jpeg", {"X-Camera-Frame": str(received)})
            if self.path != "/status":
                return self.reply(404, {"error": "Not found"})
            self.reply(200, bridge.snapshot())

        def save_recording(self):
            if not serve_web or camera is None:
                return self.reply(404, {"error": "Not found"})
            if (not self.local_page_request()
                    or self.headers.get("Origin") != "http://" + self.headers.get("Host", "")
                    or not self.authorized()):
                self.close_connection = True
                return self.reply(403, {"error": "Same-origin authentication required"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if (not 12 <= length <= MAX_RECORDING_BYTES or self.headers.get("Content-Type") != "video/webm"
                    or self.headers.get("Transfer-Encoding")):
                self.close_connection = True
                return self.reply(400, {"error": "Invalid recording"})
            target = None
            created = False
            try:
                self.connection.settimeout(30)
                header = self.rfile.read(4)
                if header != b"\x1a\x45\xdf\xa3":
                    self.close_connection = True
                    return self.reply(400, {"error": "Invalid WebM header"})
                size_byte = self.rfile.read(1)
                if not size_byte or size_byte[0] == 0:
                    raise OSError("Invalid EBML header size")
                width = 9 - size_byte[0].bit_length()
                size_tail = self.rfile.read(width - 1)
                size = int.from_bytes(size_byte + size_tail, 'big') & ((1 << (7 * width)) - 1)
                if len(size_tail) != width - 1 or size > 4096 or 4 + width + size > length:
                    raise OSError("Invalid EBML header size")
                ebml = self.rfile.read(size)
                if len(ebml) != size or b"\x42\x82\x84webm" not in ebml:
                    self.close_connection = True
                    return self.reply(400, {"error": "WebM DocType required"})
                header += size_byte + size_tail + ebml
                root = Path(recordings_root)
                root.mkdir(parents=True, exist_ok=True)
                filename = "rover-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8] + ".webm"
                target = root / filename
                with target.open("xb") as output:
                    created = True
                    output.write(header)
                    remaining = length - len(header)
                    while remaining:
                        chunk = self.rfile.read(min(65536, remaining))
                        if not chunk:
                            raise OSError("Incomplete recording")
                        output.write(chunk)
                        remaining -= len(chunk)
                self.reply(201, {"filename": filename, "bytes": length})
            except OSError:
                if created:
                    try:
                        target.unlink(missing_ok=True)
                    except OSError:
                        pass
                self.close_connection = True
                self.reply(500, {"error": "Recording could not be saved"})

        def do_POST(self):
            if self.path == "/camera/recordings":
                return self.save_recording()
            # Drain a bounded body before an early rejection to avoid TCP resets on Windows.
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if not 0 < length <= 2048:
                return self.reply(400, {"error": "Invalid request size"})
            if self.headers.get("Transfer-Encoding"):
                self.close_connection = True
                return self.reply(400, {"error": "Unsupported transfer encoding"})
            self.connection.settimeout(3)
            try:
                raw_body = self.rfile.read(length)
            except (OSError, TimeoutError):
                self.close_connection = True
                return self.reply(400, {"error": "Incomplete body"})
            if len(raw_body) != length:
                return self.reply(400, {"error": "Incomplete body"})
            if serve_web and (not self.local_page_request()
                              or self.headers.get("Origin") != "http://" + self.headers.get("Host", "")):
                return self.reply(403, {"error": "Same-origin request required"})
            if not self.authorized():
                return self.reply(403, {"error": "Forbidden"})
            try:
                body = json.loads(raw_body)
                if not isinstance(body, dict):
                    raise BridgeError("Invalid request")
                if self.path == "/jobs/start" and jobs is not None:
                    return self.reply(202, jobs.start(body))
                elif self.path == "/jobs/stop" and jobs is not None:
                    result = jobs.stop(body.get("sessionId"))
                elif self.path == "/camera" and camera is not None:
                    result = camera.configure(body.get("url"))
                elif self.path == "/camera/power" and camera is not None:
                    result = camera.set_enabled(body.get("enabled"))
                elif self.path == "/activate":
                    result = bridge.activate()
                elif self.path == "/drive":
                    result = bridge.drive(body["session"], body["sequence"], body["direction"], body["speed"])
                elif self.path == "/gripper":
                    result = bridge.gripper(body["session"], body["sequence"], body["action"])
                elif self.path == "/release":
                    result = bridge.release(body["session"], body["sequence"])
                elif self.path == "/stop":
                    result = bridge.request_stop(body["session"])
                else:
                    return self.reply(404, {"error": "Not found"})
                self.reply(200, result)
            except OSError:
                self.reply(500, {"error": "Camera settings could not be saved"})
            except (ValueError, KeyError, TypeError) as exc:
                self.reply(400, {"error": str(exc) if isinstance(exc, BridgeError) else "Invalid request"})

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--web", action="store_true", help="Serve standalone browser controls")
    parser.add_argument("--camera", action="store_true", help="Enable camera endpoints for the dashboard bridge")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    token = secrets.token_hex(32) if args.web else os.environ.get("VBB_BRIDGE_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("VBB_BRIDGE_TOKEN must be provided by the Web launcher (or use --web)")
    def controller_factory():
        settings = app_settings()
        return RoverController(settings.base_url, settings.token)
    bridge = RoverWebBridge(controller_factory, settings=load_rover_settings())
    camera = None
    if args.web or args.camera:
        from rover.web_camera import WebCamera
        camera = WebCamera()
    from rover.job_runner import RoverJobRunner
    jobs = RoverJobRunner(bridge, camera, Path(os.environ.get("ROVER_JOB_RECORDING_DIR", str(WEB_ROOT.parent / ".rover-sessions"))))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port),
                                     create_handler(bridge, token, serve_web=args.web, port=args.port, camera=camera, jobs=jobs))
    except OSError as exc:
        raise SystemExit(f"Cannot listen on port {args.port}. Close the other Rover web launcher first. ({exc})")
    if camera is not None:
        camera.start()
    server.daemon_threads = True
    done = threading.Event()

    def control_loop():
        while not done.wait(0.04):
            bridge.tick()

    threading.Thread(target=control_loop, daemon=True).start()

    def stop(*_):
        jobs.cancelled.set()
        done.set()
        bridge.shutdown()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Rover {'web controls' if args.web else 'bridge'} ready: {url}; hardware is not armed", flush=True)
    if args.web and not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    finally:
        jobs.close()
        done.set()
        bridge.shutdown()
        server.server_close()
        if camera is not None:
            camera.close()


if __name__ == "__main__":
    main()
