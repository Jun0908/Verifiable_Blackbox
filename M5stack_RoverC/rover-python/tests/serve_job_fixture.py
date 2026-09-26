"""Loopback fixture for browser tests. Uses an in-memory controller only."""
import argparse
from http.server import ThreadingHTTPServer
import signal
import threading

from rover.job_runner import RoverJobRunner
from rover.web_bridge import RoverWebBridge
from rover.web_camera import WebCamera
from tests.test_job_runner import Controller, Stream
from web_bridge_server import create_handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    controller = Controller()
    bridge = RoverWebBridge(lambda: controller)
    camera = WebCamera(Stream())
    jobs = RoverJobRunner(bridge, camera, args.directory)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), create_handler(bridge, args.token, port=args.port, camera=camera, jobs=jobs))
    server.daemon_threads = True
    done = threading.Event()
    def tick():
        while not done.wait(0.02):
            bridge.tick()
    threading.Thread(target=tick, daemon=True).start()
    def stop(*_):
        jobs.cancelled.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever()
    finally:
        jobs.close()
        done.set()
        bridge.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
