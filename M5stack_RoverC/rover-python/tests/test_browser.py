"""Real Chromium input against the HTTP Bridge and loopback device simulator."""
import threading
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from http.server import ThreadingHTTPServer

from playwright.sync_api import sync_playwright, expect
from mock_rover import MockRover
from rover.control import RoverController
from rover.web_bridge import RoverWebBridge
from web_bridge_server import create_handler


class SimulatedCamera:
    def __init__(self):
        from PySide6.QtGui import QImage, QColor
        from PySide6.QtCore import QBuffer, QIODevice
        image = QImage(320,240,QImage.Format.Format_RGB32)
        image.fill(QColor('#247a70'))
        buffer = QBuffer(); buffer.open(QIODevice.OpenModeFlag.WriteOnly)
        image.save(buffer,'JPEG')
        self.jpeg = bytes(buffer.data())
        self.enabled = True
        self.url = 'simulation://camera-fixture'
        self.offline = False

    def status(self):
        return dict(url=self.url,configured=True,enabled=self.enabled,receiving=self.enabled and not self.offline)

    def frame(self):
        return (self.jpeg if self.enabled and not self.offline else None,time.monotonic())

    def set_enabled(self,value):
        self.enabled = value
        return self.status()

    def configure(self,value):
        self.url = value
        return self.status()


class BrowserTests(unittest.TestCase):
    def test_hold_release_gripper_stop_and_mobile(self):
        with MockRover() as device, sync_playwright() as pw, TemporaryDirectory() as recordings:
            bridge = RoverWebBridge(lambda: RoverController(device.url, device.token))
            token = 'browser-test-only-token-'*3
            server = ThreadingHTTPServer(('127.0.0.1',0),create_handler(bridge,token))
            camera = SimulatedCamera()
            server.RequestHandlerClass = create_handler(bridge,token,serve_web=True,port=server.server_port,
                                                        camera=camera,recordings_root=recordings)
            done = threading.Event()
            def tick():
                while not done.wait(.04): bridge.tick()
            workers = [threading.Thread(target=server.serve_forever,daemon=True),threading.Thread(target=tick,daemon=True)]
            for worker in workers: worker.start()
            browser = pw.chromium.launch(headless=True)
            try:
                page = browser.new_page(viewport={'width':1200,'height':1000})
                errors = []
                page.on('pageerror',lambda e: errors.append(str(e)))
                page.goto(f'http://127.0.0.1:{server.server_port}')
                page.locator('#connect').wait_for()
                self.assertFalse(device.armed)
                page.locator('#connect').click()
                expect(page.locator("[data-direction=forward]")).to_be_enabled()
                box = page.locator('[data-direction=forward]').bounding_box()
                page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
                page.mouse.down()
                page.wait_for_timeout(600)
                self.assertTrue(any(device.motors))
                page.mouse.up()
                page.wait_for_timeout(200)
                self.assertEqual(device.motors,[0]*4)
                grip = page.locator('[data-gripper=close]')
                box=grip.bounding_box()
                page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
                page.mouse.down(); page.wait_for_timeout(600); page.mouse.up()
                page.wait_for_timeout(200)
                angle = device.gripper
                self.assertGreater(angle,25)
                page.wait_for_timeout(300)
                self.assertEqual(device.gripper,angle)
                page.locator('#gripper-open').click()
                page.wait_for_timeout(200)
                self.assertEqual(device.gripper,25)
                page.locator('#stop').click()
                expect(page.locator("#connect")).to_be_enabled()
                self.assertFalse(device.armed)
                self.assertEqual(bridge.state,'idle')
                expect(page.locator('#camera-image')).to_be_visible()
                page.locator('.camera-settings summary').click()
                page.locator('#record-on').click()
                page.wait_for_timeout(1300)
                page.locator('#record-off').click()
                expect(page.locator('#record-status')).to_contain_text('Saved',timeout=10000)
                files=list(Path(recordings).glob('*.webm'))
                self.assertEqual(len(files),1)
                self.assertGreater(files[0].stat().st_size,100)
                dimensions=page.evaluate('''async () => {
                  const video=document.createElement('video');
                  video.src=document.querySelector('#record-download').href;
                  await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;});
                  return [video.videoWidth,video.videoHeight];
                }''')
                self.assertEqual(dimensions,[320,240])
                page.locator('#camera-off').click()
                expect(page.locator('#camera-image')).to_be_hidden()
                self.assertEqual(camera.url,'simulation://camera-fixture')
                page.locator('#camera-on').click()
                expect(page.locator('#camera-image')).to_be_visible()
                camera.offline=True
                expect(page.locator('#camera-image')).to_be_hidden()
                camera.offline=False
                expect(page.locator('#camera-image')).to_be_visible()
                page.locator('#ja').click()
                self.assertEqual(page.locator('html').get_attribute('lang'),'ja')
                artifacts = Path(__file__).resolve().parents[2]/'.tools'
                artifacts.mkdir(exist_ok=True)
                page.screenshot(path=str(artifacts/'web-desktop.png'),full_page=True)
                page.set_viewport_size({'width':390,'height':844})
                self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                page.screenshot(path=str(artifacts/'web-mobile.png'),full_page=True)
                # Keyboard drive then navigating away must disconnect.
                page.locator('#connect').click()
                expect(page.locator("[data-direction=forward]")).to_be_enabled()
                page.locator('[data-direction=forward]').focus()
                page.keyboard.down('Space'); page.wait_for_timeout(200)
                page.goto('about:blank'); page.wait_for_timeout(300)
                self.assertFalse(device.armed)
                self.assertFalse(bridge.snapshot()['paymentEnabled'])
                self.assertEqual(errors,[])
            finally:
                browser.close()
                done.set(); bridge.shutdown()
                server.shutdown(); server.server_close()
                for worker in workers: worker.join(2)
