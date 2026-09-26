"""Loopback-only device simulator. Never discovers or contacts hardware."""
import json
import socket
import struct
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

from rover.protocol import token_hash, newer_sequence


class MockRover:
    def __init__(self):
        self.token = 'simulation-only-token'
        self.armed = False
        self.session = self.sequence = 0
        self.gripper, self.aux = 25, 90
        self.motors = [0] * 4
        self.commands = []
        self.done = threading.Event()
        self.lock = threading.RLock()
        self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp.bind(('127.0.0.1', 0))
        self.udp.settimeout(.04)
        self.started = time.monotonic()
        self.last_control = self.started
        self.target = None
        device = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self): self.dispatch()
            def do_POST(self): self.dispatch()
            def dispatch(self):
                body = parse_qs(self.rfile.read(int(self.headers.get('Content-Length', 0))).decode())
                with device.lock:
                    code = 200
                    result = {'ok': True, 'simulated': True}
                    if self.headers.get('X-Rover-Token') != device.token:
                        code, result = 401, {'error': 'unauthorized'}
                    elif self.path == '/status':
                        result.update(armed=device.armed, i2c=True, wifi=True,
                                      motors=any(device.motors), protocol=2,
                                      udp_port=device.udp.getsockname()[1])
                    elif self.path == '/arm':
                        session = int(body.get('session_id', ['0'])[0])
                        if not session or (device.armed and session != device.session):
                            code, result = 409, {'error': 'session leased'}
                        else:
                            device.armed, device.session, device.sequence = True, session, 0
                            device.motors = [0]*4
                    elif self.path in ('/stop', '/disarm'):
                        device.armed = False
                        device.motors = [0]*4
                    elif self.path == '/config':
                        if device.armed: code, result = 409, {'error': 'disarm required'}
                    else: code, result = 404, {'error': 'not found'}
                    data = json.dumps(result).encode()
                self.send_response(code)
                self.send_header('Content-Type','application/json')
                self.send_header('Content-Length',str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.http = ThreadingHTTPServer(('127.0.0.1',0), Handler)
        self.url = 'http://127.0.0.1:' + str(self.http.server_port)
        self.threads = [threading.Thread(target=self.http.serve_forever, daemon=True),
                        threading.Thread(target=self.run_udp, daemon=True)]

    def __enter__(self):
        for thread in self.threads: thread.start()
        return self

    def __exit__(self, *_):
        self.done.set()
        self.http.shutdown()
        self.http.server_close()
        for thread in self.threads: thread.join(2)
        self.udp.close()

    def run_udp(self):
        while not self.done.is_set():
            try: data, address = self.udp.recvfrom(1024)
            except socket.timeout: data = b''
            with self.lock:
                if len(data) == 34 and zlib.crc32(data[:-4]) == struct.unpack('<I',data[-4:])[0]:
                    fields = struct.unpack('<IBBHIIhhhBBBBII',data)
                    magic, version, flags, size, session, seq, x,y,z,speed,grip,aux,reserved,token,_ = fields
                    if (magic == 0x52565232 and version == 1 and size == 34 and not reserved
                            and token == token_hash(self.token) and self.armed and session == self.session
                            and newer_sequence(seq,self.sequence)):
                        self.sequence, self.target, self.last_control = seq, address, time.monotonic()
                        self.commands.append(fields)
                        if flags & 2: self.armed = False
                        moving = self.armed and flags & 1 and any((x,y,z))
                        self.motors = [speed if moving else 0]*4
                        if self.armed and flags & 1:
                            if flags & 4: self.gripper = max(10,min(90,grip))
                            if flags & 8: self.aux = max(45,min(135,aux))
                now = time.monotonic()
                if now-self.last_control >= 1: self.motors = [0]*4
                if self.target:
                    flags = 9 | (2 if self.armed else 0) | (4 if any(self.motors) else 0)
                    body = struct.pack('<IBBHIIhhhbbbbBBbBH',0x54454c32,1,flags,36,self.sequence,
                        int((now-self.started)*1000),0,0,0,*self.motors,self.gripper,self.aux,-55,85,
                        min(65535,int((now-self.last_control)*1000)))
                    self.udp.sendto(body+struct.pack('<I',zlib.crc32(body)),self.target)
