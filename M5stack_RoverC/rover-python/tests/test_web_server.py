import http.client
import json
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import Mock
from rover.web_bridge import RoverWebBridge
from web_bridge_server import create_handler

TOKEN = "test-browser-token-" * 3


@contextmanager
def running_server(bridge, standalone=True, camera=None, recordings_root=None):
    server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(bridge, TOKEN))
    server.RequestHandlerClass = create_handler(bridge, TOKEN, serve_web=standalone, port=server.server_port, camera=camera, **({"recordings_root": recordings_root} if recordings_root else {}))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_port
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class WebServerTests(unittest.TestCase):
    def setUp(self):
        self.now = 100.0
        self.controller = Mock()
        self.controller.connect.return_value = {"armed": False}
        self.controller.api.status.return_value = {"armed": False, "motors": False, "i2c": True}
        self.controller.armed = True
        self.controller.send.return_value = 1
        self.controller.receive_telemetry.return_value = SimpleNamespace(
            uptime_ms=100001, packet_age_ms=0, armed=True, i2c_ok=True,
            motors_running=False, motors=(0, 0, 0, 0), rssi=-50, gripper_angle=25, sequence=1)
        self.factory = Mock(return_value=self.controller)
        self.bridge = RoverWebBridge(self.factory, clock=lambda: self.now)

    def request(self, port, path, body=None, *, token=TOKEN, origin=True, host=None, site=None):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        if origin:
            headers["Origin"] = f"http://127.0.0.1:{port}" if origin is True else origin
        if host:
            headers["Host"] = host
        if site:
            headers["Sec-Fetch-Site"] = site
        conn.request("POST" if body is not None else "GET", path,
                     json.dumps(body) if body is not None else None, headers)
        response = conn.getresponse()
        status, content, content_type = response.status, response.read(), response.getheader("Content-Type")
        conn.close()
        return status, json.loads(content) if content_type == "application/json" else content.decode()

    def test_page_and_assets_do_not_connect_robot(self):
        with running_server(self.bridge) as port:
            for path in ["/", "/app.js", "/style.css"]:
                code, body = self.request(port, path, token=None, origin=False)
                self.assertEqual(code, 200)
                self.assertTrue(body)
            code, body = self.request(port, "/", token=None, origin=False)
            self.assertIn(TOKEN, body)
            self.assertNotIn("__BRIDGE_TOKEN__", body)
            self.assertEqual(self.request(port, "/status")[1]["state"], "idle")
            self.factory.assert_not_called()

    def test_browser_controls_use_existing_bridge_and_ordering(self):
        with running_server(self.bridge) as port:
            code, body = self.request(port, "/activate", {})
            self.assertEqual(code, 200)
            session = body["session"]
            self.bridge.tick()
            code, _ = self.request(port, "/drive", dict(session=session, sequence=1, direction="forward", speed=35))
            self.assertEqual(code, 200)
            self.assertEqual(self.bridge.command.y, 1)
            code, _ = self.request(port, "/release", dict(session=session, sequence=2))
            self.assertEqual(code, 200)
            self.assertFalse(self.bridge.command.deadman)
            self.assertEqual(self.request(port, "/drive", dict(session=session, sequence=1, direction="forward", speed=35))[0], 400)
            self.assertEqual(self.request(port, "/stop", dict(session=session))[0], 200)
            self.bridge.tick()
            result = self.request(port, "/status")[1]
            self.assertEqual(result["state"], "idle")
            self.assertFalse(result["paymentEnabled"])
            self.controller.emergency_stop.assert_called_once()

    def test_gripper_endpoint_uses_same_session_and_authentication(self):
        with running_server(self.bridge) as port:
            session = self.request(port, "/activate", {})[1]["session"]
            self.bridge.tick()
            body = dict(session=session, sequence=1, action="close")
            self.assertEqual(self.request(port, "/gripper", body, token=None)[0], 403)
            self.assertEqual(self.request(port, "/gripper", body, origin="https://example.org")[0], 403)
            self.assertEqual(self.request(port, "/gripper", dict(body, session="other"))[0], 400)
            self.assertEqual(self.request(port, "/gripper", body)[0], 200)
            self.assertEqual(self.bridge.command.gripper_angle, 27)
            self.assertEqual(self.request(port, "/release", dict(session=session, sequence=2))[0], 200)
            self.assertIsNone(self.bridge.command.gripper_angle)

    def test_camera_frame_and_settings_require_local_auth(self):
        camera = Mock()
        camera.frame.return_value = (b"JPEG preview", 100.5)
        camera.status.return_value = {"url": "http://camera:81/stream", "configured": True}
        camera.configure.return_value = camera.status.return_value
        with running_server(self.bridge, camera=camera) as port:
            self.assertEqual(self.request(port, "/camera", token=None)[0], 403)
            self.assertEqual(self.request(port, "/camera/frame", token=None)[0], 403)
            self.assertEqual(self.request(port, "/camera", {"url": "camera"}, origin="https://example.org")[0], 403)
            camera.configure.assert_not_called()
            self.assertEqual(self.request(port, "/camera")[1]["configured"], True)
            self.assertEqual(self.request(port, "/camera/frame"), (200, "JPEG preview"))
            self.assertEqual(self.request(port, "/camera", {"url": "camera"})[0], 200)
            camera.configure.assert_called_once_with("camera")
            camera.frame.return_value = (None, 0)
            self.assertEqual(self.request(port, "/camera/frame")[0], 204)
            self.factory.assert_not_called()

    def test_recordings_saved_locally_and_reject_invalid_requests(self):
        with TemporaryDirectory() as folder, running_server(self.bridge, camera=Mock(), recordings_root=folder) as port:
            def upload(body, **overrides):
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
                headers = {"Authorization": "Bearer " + TOKEN, "Origin": f"http://127.0.0.1:{port}",
                           "Content-Type": "video/webm"}
                headers.update(overrides)
                connection.request("POST", "/camera/recordings", body=body, headers=headers)
                response = connection.getresponse()
                result = response.status, json.loads(response.read())
                connection.close()
                return result
            data = b"\x1a\x45\xdf\xa3" + b"test recording" * 6000
            self.assertEqual(upload(data, Authorization="wrong")[0], 403)
            self.assertEqual(upload(data, Origin="https://example.org")[0], 403)
            self.assertEqual(upload(b"not a video")[0], 400)
            self.assertEqual(upload(data, **{"Content-Type": "text/plain"})[0], 400)
            self.assertEqual(list(Path(folder).iterdir()), [])
            code, result = upload(data)
            self.assertEqual(code, 201)
            saved = Path(folder) / result["filename"]
            self.assertEqual(saved.read_bytes(), data)
            self.assertEqual(result["bytes"], len(data))
            self.assertTrue(saved.name.endswith(".webm"))
            self.factory.assert_not_called()

    def test_camera_power_requires_auth_and_never_operates_robot(self):
        camera = Mock()
        camera.set_enabled.return_value = {"enabled": False}
        with running_server(self.bridge, camera=camera) as port:
            for kwargs in [{"token": None}, {"origin": "https://example.org"}, {"origin": False}]:
                self.assertEqual(self.request(port, "/camera/power", {"enabled": False}, **kwargs)[0], 403)
            camera.set_enabled.assert_not_called()
            self.assertEqual(self.request(port, "/camera/power", {"enabled": False}), (200, {"enabled": False}))
            camera.set_enabled.assert_called_once_with(False)
            self.factory.assert_not_called()

    def test_other_origins_hosts_and_missing_token_cannot_operate(self):
        with running_server(self.bridge) as port:
            for kwargs in [
                {"origin": "https://example.org"}, {"origin": False},
                {"token": None}, {"token": "wrong"},
                {"host": f"example.org:{port}"}, {"site": "cross-site"}
            ]:
                self.assertEqual(self.request(port, "/activate", {}, **kwargs)[0], 403)
            self.assertEqual(self.request(port, "/", host="example.org")[0], 403)
            self.assertEqual(self.request(port, "/", site="cross-site")[0], 403)
            self.assertEqual(self.request(port, "/../.env")[0], 404)
            self.assertEqual(self.request(port, "/activate", [1, 2])[0], 400)
            self.factory.assert_not_called()

    def test_dashboard_bridge_mode_still_accepts_server_requests(self):
        with running_server(self.bridge, standalone=False) as port:
            self.assertEqual(self.request(port, "/", token=None, origin=False)[0], 403)
            self.assertEqual(self.request(port, "/status", origin=False)[0], 200)
            self.assertEqual(self.request(port, "/activate", {}, origin=False)[0], 200)


if __name__ == "__main__":
    unittest.main()
