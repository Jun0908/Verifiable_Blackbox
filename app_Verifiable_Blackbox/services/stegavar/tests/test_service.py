import hashlib
import base64
import io
import uuid
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import inference_server as service
from settings import within


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.folder = self.root / 'rover-moving/surf'
        (self.folder / 'recovered').mkdir(parents=True)
        frame = np.zeros((24, 32, 3), dtype=np.uint8)
        for index in range(8):
            Image.fromarray(frame).save(self.folder / f'recovered/{index:04d}.png')
        (self.folder / 'stego-lossless.mkv').write_bytes(b'test fixture')
        self.meta = {'case': 'rover-moving', 'scene': 'surf', 'frames': 8,
                     'recognition_profile': 'rover_motion_v1',
                     'stego_sha256': hashlib.sha256(b'test fixture').hexdigest(),
                     'recovered_frames_sha256': hashlib.sha256(frame.tobytes() * 8).hexdigest()}
        self.write_manifest()
        self.data_patch = patch.object(service, 'DATA_ROOT', self.root)
        self.data_patch.start()
        self.server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.data_patch.stop()
        self.tmp.cleanup()

    def write_manifest(self):
        (self.folder / 'manifest.json').write_text(json.dumps(self.meta), encoding='utf-8')

    def request(self, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        connection.request('GET' if body is None else 'POST', '/health' if body is None else '/analyze',
                           None if body is None else json.dumps(body),
                           headers or {'Content-Type': 'application/json'})
        response = connection.getresponse()
        status, result = response.status, json.loads(response.read())
        connection.close()
        return status, result

    def test_health_and_recovered_only_analysis(self):
        status, health = self.request()
        self.assertEqual(status, 200)
        self.assertFalse(health['model_loaded'])
        self.assertEqual(health['available'], [{'case': 'rover-moving', 'scene': 'surf'}])
        status, result = self.request({'case': 'rover-moving', 'scene': 'surf'})
        self.assertEqual(status, 200)
        self.assertEqual(result['results']['recovered']['label'], 'ROVER_STILL')
        self.assertFalse(result['original_secret_used'])
        self.assertEqual(result['execution'], 'live')
        self.assertFalse((self.folder / 'recognition.json').exists())

    def test_disallowed_ids_and_browser_origin(self):
        self.assertEqual(self.request({'case': '../../private', 'scene': 'surf'})[0], 400)
        self.assertEqual(self.request({'case': 'rover-moving', 'scene': []})[0], 400)
        self.assertEqual(self.request(headers={'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.request(headers={'Host': 'example.com'})[0], 403)

    def test_corrupted_pixels(self):
        Image.new('RGB', (32, 24), 'white').save(self.folder / 'recovered/0000.png')
        self.assertEqual(self.request({'case': 'rover-moving', 'scene': 'surf'})[0], 422)
        self.assertFalse(service.LOCK.locked())

    def test_manifest_identity(self):
        self.meta['case'] = 'rover-still'
        self.write_manifest()
        self.assertEqual(self.request({'case': 'rover-moving', 'scene': 'surf'})[0], 422)

    def test_missing_data(self):
        self.assertEqual(self.request({'case': 'rover-still', 'scene': 'surf'})[0], 503)

    def test_concurrency(self):
        service.LOCK.acquire()
        try:
            self.assertTrue(self.request()[1]['busy'])
            self.assertEqual(self.request({'case': 'rover-moving', 'scene': 'surf'})[0], 409)
        finally:
            service.LOCK.release()

    def test_path_containment(self):
        with self.assertRaises(ValueError):
            within(self.root, '..', 'private')

    def recording_request(self, moving=False, count=16, corrupt=False):
        frames = []
        for index in range(count):
            pixels = np.zeros((216, 384, 3), dtype=np.uint8)
            offset = 35 if moving and index >= 4 else 0
            pixels[110:160, 150+offset:190+offset] = 230
            output = io.BytesIO()
            Image.fromarray(pixels).save(output, format='JPEG')
            frames.append(output.getvalue())
        raw = b''.join(frames) if not corrupt else b'not a jpeg'
        body = {'version': 1, 'source': 'job-recording', 'chainId': 31337, 'core': '0x'+'1'*40,
                'jobId': '1', 'sessionId': str(uuid.uuid4()), 'recordingSha256': hashlib.sha256(raw).hexdigest(),
                'policyHash': '0x'+'2'*64, 'policy': json.loads((service.ROOT/'config/rover_motion.json').read_text()),
                'rawBase64': base64.b64encode(raw).decode()}
        return body

    def raw_request(self, body):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        connection.request('POST', '/analyze-recording', json.dumps(body), {'Content-Type': 'application/json'})
        response = connection.getresponse()
        status, result = response.status, json.loads(response.read())
        connection.close()
        return status, result

    def test_raw_moving_and_still_return_three_way_result_with_session_binding(self):
        for moving, expected in [(True, 'MOVING'), (False, 'STILL')]:
            body = self.recording_request(moving)
            status, result = self.raw_request(body)
            self.assertEqual(status, 200)
            self.assertEqual(result['judgment'], expected)
            self.assertEqual(result['sessionId'], body['sessionId'])
            self.assertEqual(result['recordingSha256'], body['recordingSha256'])
            self.assertEqual(result['source'], 'job-recording')

    def test_insufficient_and_unreadable_raw_video_are_inconclusive(self):
        for body in [self.recording_request(count=2), self.recording_request(corrupt=True)]:
            status, result = self.raw_request(body)
            self.assertEqual(status, 200)
            self.assertEqual(result['judgment'], 'INCONCLUSIVE')
            self.assertTrue(result['reason'])

    def test_raw_hash_mismatch_and_button_hint_are_rejected(self):
        body = self.recording_request()
        body['recordingSha256'] = '0'*64
        self.assertEqual(self.raw_request(body)[0], 422)
        body = self.recording_request()
        body['forwardPressed'] = True
        self.assertEqual(self.raw_request(body)[0], 422)


if __name__ == '__main__':
    unittest.main()
