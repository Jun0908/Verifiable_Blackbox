import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from rover.camera import CameraStream, JpegFrames, stream_url


class CameraTests(unittest.TestCase):
    def test_split_frames_and_multipart_headers(self):
        parser = JpegFrames()
        self.assertEqual(parser.feed(b"--frame\r\nContent-Type: image/jpeg\r\n\r\n\xff"), [])
        self.assertEqual(parser.feed(b"\xd8abc\xff"), [])
        self.assertEqual(parser.feed(b"\xd9\r\n--frame\r\n\xff\xd8def\xff\xd9"),
                         [b"\xff\xd8abc\xff\xd9", b"\xff\xd8def\xff\xd9"])

    def test_unbounded_bad_stream_is_rejected(self):
        parser = JpegFrames()
        with self.assertRaises(ValueError):
            parser.feed(b"\xff\xd8" + b"a" * 2_000_001)
        self.assertLess(len(parser.buffer), 2_000_000)

    def test_addresses(self):
        self.assertEqual(stream_url("192.168.1.10"), "http://192.168.1.10:81/stream")
        self.assertEqual(stream_url("http://rover-camera.local:81/stream"), "http://rover-camera.local:81/stream")
        self.assertEqual(stream_url(""), "")
        with self.assertRaises(ValueError):
            stream_url("file:///tmp/video")

    def test_background_receives_and_reconnects_without_gui(self):
        jpeg = b"\xff\xd8" + b"a" * 1500 + b"\xff\xd9"
        class Handler(BaseHTTPRequestHandler):
            calls = 0
            def do_GET(self):
                Handler.calls += 1
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.end_headers()
                self.wfile.write(b"--frame\r\n\r\n" + jpeg)
            def log_message(self, *_):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        camera = CameraStream()
        try:
            camera.configure(f"http://127.0.0.1:{server.server_port}/stream")
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline and Handler.calls < 2:
                time.sleep(.02)
            frame, received, _, _ = camera.snapshot()
            self.assertEqual(frame, jpeg)
            self.assertGreater(received, 0)
            self.assertGreaterEqual(Handler.calls, 2)
            camera.configure("")
            self.assertIsNone(camera.snapshot()[0])
        finally:
            camera.close()
            server.shutdown()
            server.server_close()
        self.assertFalse(camera._thread.is_alive())
