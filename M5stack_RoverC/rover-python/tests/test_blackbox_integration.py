import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import requests
from mock_rover import MockRover
from test_browser import SimulatedCamera


class BlackboxIntegrationTests(unittest.TestCase):
    def test_launcher_and_actual_app_routes(self):
        root=Path(__file__).resolve().parents[2]
        app=Path(os.getenv('VBB_APP_ROOT',str(root.parent/'app_Verifiable_Blackbox')))
        if not (app/'node_modules/typescript').exists():
            self.skipTest('Install the sibling Blackbox app dependencies to run integration')
        with MockRover() as device, tempfile.TemporaryDirectory() as folder:
            device.camera_jpeg=SimulatedCamera().jpeg
            settings=Path(folder)/'settings.json'
            settings.write_text(json.dumps({'camera_url':device.url+'/stream','camera_enabled':True}))
            with socket.socket() as listener:
                listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
            token='isolated-integration-test-token-'*2
            env={k:v for k,v in os.environ.items() if k.lower() in ('path','systemroot','windir','temp','tmp','home','userprofile','localappdata','appdata')}
            env.update(ROVER_BASE_URL=device.url,ROVER_API_TOKEN=device.token,ROVER_SETTINGS_FILE=str(settings),VBB_BRIDGE_TOKEN=token)
            process=subprocess.Popen([sys.executable,'web_bridge_server.py','--camera','--no-browser','--port',str(port)],
                                     cwd=root/'rover-python',env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            url=f'http://127.0.0.1:{port}'
            try:
                for _ in range(60):
                    self.assertIsNone(process.poll(),'Bridge exited during startup')
                    try:
                        response=requests.get(url+'/status',headers={'Authorization':'Bearer '+token},timeout=.3)
                        if response.ok: break
                    except requests.RequestException: pass
                    time.sleep(.05)
                self.assertFalse(device.armed,'Process startup must not ARM')
                node_env={**env,'VBB_BRIDGE_URL':url,'VBB_APP_ROOT':str(app)}
                result=subprocess.run(['node',str(root/'scripts/check-blackbox.mjs')],env=node_env,capture_output=True,text=True,timeout=30)
                self.assertEqual(result.returncode,0,result.stdout+result.stderr)
                self.assertFalse(device.armed)
            finally:
                process.terminate()
                process.communicate(timeout=5)
