import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import preflight
from rover.config import AppSettings, RoverSettings


class PreflightTests(unittest.TestCase):
    def test_offline_report_has_no_network_or_secret_values(self):
        token = 'private-test-token-do-not-print'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for relative in ('m5stick-rover/include', 'camera-firmware/RoverCamera'):
                target = root / relative / 'secrets.h'
                target.parent.mkdir(parents=True)
                target.write_text(f'#define ROVER_API_TOKEN "{token}"\n'
                                  '#define ROVER_WIFI_SSID "private-ssid"\n')
            with patch.object(preflight, 'app_settings', return_value=AppSettings('http://rover.local', token)), \
                 patch.object(preflight, 'load_rover_settings', return_value=RoverSettings(camera_url='http://camera.local/stream')), \
                 patch('socket.socket', side_effect=AssertionError('Offline check opened socket')):
                report = preflight.inspect(root)
            self.assertTrue(report['readyForConfigurationReview'])
            self.assertFalse(report['hardwareTested'])
            self.assertNotIn(token, json.dumps(report))
            self.assertNotIn('private-ssid', json.dumps(report))

    def test_missing_settings_are_not_ready(self):
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(preflight, 'app_settings', return_value=AppSettings('', '')), \
             patch.object(preflight, 'load_rover_settings', return_value=RoverSettings()):
            self.assertFalse(preflight.inspect(Path(folder))['readyForConfigurationReview'])

    def test_explicit_probe_only_reads_status_and_failure_is_nonzero(self):
        with patch('sys.argv', ['preflight.py', '--probe']), \
             patch.object(preflight, 'inspect', return_value={'readyForConfigurationReview': True}), \
             patch.object(preflight, 'app_settings', return_value=AppSettings('http://rover.local', 'token')), \
             patch('rover.api.RoverAPI') as api, contextlib.redirect_stdout(io.StringIO()) as output:
            api.return_value.status.side_effect = RuntimeError('secret must not leak')
            self.assertEqual(preflight.main(), 1)
            api.return_value.status.assert_called_once_with()
            self.assertEqual([call[0] for call in api.return_value.method_calls], ['status'])
            self.assertNotIn('secret must not leak', output.getvalue())
