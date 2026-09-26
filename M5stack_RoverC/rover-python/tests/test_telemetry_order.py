import struct
import unittest
import zlib
from unittest.mock import Mock, patch
from rover.control import RoverController
from rover.models import ControlInput
from rover.protocol import encode_control, newer_sequence


def packet(seq, uptime, armed=True):
    body = struct.pack('<IBBHIIhhhbbbbBBbBH', 0x54454c32, 1,
                       13 | (2 if armed else 0), 36, seq, uptime,
                       0, 0, 0, 0, 0, 0, 0, 25, 90, -60, 35, 0)
    return body + struct.pack('<I', zlib.crc32(body))


class OrderingTests(unittest.TestCase):
    def test_reordered_and_duplicate_responses_cannot_refresh_or_disarm(self):
        c = RoverController('http://127.0.0.1', 'test')
        original = c._socket
        self.addCleanup(original.close)
        c._destination = ('127.0.0.1', 4210)
        c.sequence = 20
        c._socket = Mock()
        def read(*packets):
            c._socket.recvfrom.side_effect = [(p, c._destination) for p in packets] + [BlockingIOError()]
            return c._receive_socket()
        self.assertEqual(read(packet(12, 200), packet(11, 100, False)).sequence, 12)
        received = c.last_received_at
        self.assertIsNone(read(packet(12, 200), packet(11, 100), packet(21, 300)))
        self.assertEqual(c.last_received_at, received)
        self.assertTrue(c.armed)
        corrupted = bytearray(packet(15, 400)); corrupted[-1] ^= 1
        self.assertIsNone(read(bytes(corrupted)))
        self.assertEqual(read(packet(12, 300)).uptime_ms, 300)

    def test_rollover(self):
        self.assertTrue(newer_sequence(1, 0xffffffff))
        self.assertFalse(newer_sequence(0xffffffff, 1))
        self.assertFalse(newer_sequence(1, 1))

    def test_cpp_golden_packet(self):
        # Output of the host test, produced by the actual Firmware struct and CRC.
        from pathlib import Path
        import subprocess
        exe = Path(__file__).resolve().parents[2] / '.tools/host_protocol.exe'
        if not exe.exists():
            self.skipTest('Run scripts/test-firmware.ps1 to enable C++ cross-check')
        actual = subprocess.check_output([str(exe)], text=True).strip()
        expected = encode_control(ControlInput(x=-1,y=.5,deadman=True,speed_limit=35),123,10,'fixture-token')
        self.assertEqual(actual, expected.hex())
