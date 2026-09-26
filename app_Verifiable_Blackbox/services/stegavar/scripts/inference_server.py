"""Loopback-only recovered-frame analysis with one active request at a time."""
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import json
import os
import threading
import time
import uuid

from settings import ROOT, DATA_ROOT, MODEL_ROOT, TORCH_THREADS, within

CASES = json.loads((ROOT / 'config/cases.json').read_text(encoding='utf-8'))
SCENES = json.loads((ROOT / 'config/scenes.json').read_text(encoding='utf-8'))
LOCK = threading.Lock()
ENGINE = None


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def allowed(self):
        # Browser requests go through Next.js; accept server-to-server calls only.
        return (self.headers.get('Host') in {
            f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'
        } and self.headers.get('Origin') is None)

    def do_GET(self):
        if not self.allowed():
            return self.reply(403, {'error': 'origin_rejected'})
        if self.path != '/health':
            return self.reply(404, {'error': 'not_found'})
        ready = []
        for case in CASES:
            for scene in SCENES:
                if within(DATA_ROOT, case, scene, 'manifest.json').is_file():
                    ready.append({'case': case, 'scene': scene})
        self.reply(200, {
            'application': 'vbb-stegavar', 'version': 1, 'pid': os.getpid(),
            'busy': LOCK.locked(), 'model_loaded': ENGINE is not None,
            'model_available': (MODEL_ROOT / 'xclip/model.safetensors').is_file(),
            'device': 'cpu', 'threads': TORCH_THREADS, 'available': ready,
        })

    def do_POST(self):
        global ENGINE
        if not self.allowed():
            return self.reply(403, {'error': 'origin_rejected'})
        if self.path != '/analyze':
            return self.reply(404, {'error': 'not_found'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 1024 or self.headers.get_content_type() != 'application/json':
                raise ValueError()
            self.connection.settimeout(10)
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict) or set(request) != {'case', 'scene'}:
                raise ValueError()
            case, scene = request['case'], request['scene']
            if not isinstance(case, str) or not isinstance(scene, str) or case not in CASES or scene not in SCENES:
                raise ValueError()
        except (ValueError, OSError):
            return self.reply(400, {'error': 'invalid_request'})
        if not LOCK.acquire(blocking=False):
            return self.reply(409, {'error': 'busy'})
        try:
            start = time.perf_counter()
            folder = within(DATA_ROOT, case, scene)
            meta = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
            if meta.get('case') != case or meta.get('scene') != scene:
                raise ValueError('Manifest identity mismatch')
            if meta.get('recognition_profile') == 'rover_motion_v1':
                from analyze_rover import main
                result = main(folder, save=False)
            else:
                from recognize_video import VideoRecognizer, main
                if ENGINE is None:
                    ENGINE = VideoRecognizer(local_files_only=True)
                result = main(folder, recognizer=ENGINE, controls=False, save=False)
            result.update({
                'case': case, 'scene': scene, 'execution': 'live',
                'request_id': str(uuid.uuid4()),
                'analyzed_at': datetime.now(timezone.utc).isoformat(),
                'total_seconds': time.perf_counter() - start,
            })
            self.reply(200, result)
        except FileNotFoundError:
            self.reply(503, {'error': 'data_or_model_unavailable'})
        except ValueError:
            self.reply(422, {'error': 'input_integrity_failed'})
        except Exception as error:
            print(f'Analysis failed: {type(error).__name__}', flush=True)
            self.reply(500, {'error': 'analysis_failed'})
        finally:
            LOCK.release()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=int(os.environ.get('STEGAVAR_PORT', '4176')))
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'StegaVAR CPU analysis: http://127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
