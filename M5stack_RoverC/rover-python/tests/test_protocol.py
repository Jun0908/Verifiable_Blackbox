import struct
import unittest
import zlib

from rover.models import ControlInput
from rover.protocol import (
    CONTROL_MAGIC,
    CONTROL_PACKET_SIZE,
    FLAG_DEADMAN,
    FLAG_GRIPPER_VALID,
    PROTOCOL_VERSION,
    TELEMETRY_MAGIC,
    TELEMETRY_PACKET_SIZE,
    TELEMETRY_ARMED,
    TELEMETRY_I2C_OK,
    decode_telemetry,
    encode_control,
    token_hash,
)


class ProtocolTests(unittest.TestCase):
    def test_control_packet_matches_firmware_layout(self):
        packet = encode_control(
            ControlInput(
                x=0.25,
                y=-0.5,
                z=1.0,
                deadman=True,
                speed_limit=35,
                gripper_angle=50,
            ),
            session_id=123,
            sequence=7,
            token="test-token",
        )
        self.assertEqual(len(packet), 34)
        fields = struct.unpack("<IBBHIIhhhBBBBII", packet)
        self.assertEqual(fields[0], CONTROL_MAGIC)
        self.assertEqual(fields[1], PROTOCOL_VERSION)
        self.assertEqual(fields[2], FLAG_DEADMAN | FLAG_GRIPPER_VALID)
        self.assertEqual(fields[3], CONTROL_PACKET_SIZE)
        self.assertEqual(fields[4:9], (123, 7, 250, -500, 1000))
        self.assertEqual(fields[9], 35)
        self.assertEqual(fields[10], 50)
        self.assertEqual(fields[13], token_hash("test-token"))
        self.assertEqual(fields[14], zlib.crc32(packet[:-4]) & 0xFFFFFFFF)

    def test_values_are_clamped(self):
        packet = encode_control(
            ControlInput(x=5, y=-5, speed_limit=200), 1, 1, "token"
        )
        fields = struct.unpack("<IBBHIIhhhBBBBII", packet)
        self.assertEqual(fields[6], 1000)
        self.assertEqual(fields[7], -1000)
        self.assertEqual(fields[9], 100)

    def test_telemetry_packet(self):
        values = (
            TELEMETRY_MAGIC,
            PROTOCOL_VERSION,
            TELEMETRY_ARMED | TELEMETRY_I2C_OK,
            TELEMETRY_PACKET_SIZE,
            9,
            1234,
            10,
            -20,
            30,
            1,
            2,
            3,
            4,
            50,
            90,
            -60,
            35,
            12,
        )
        body = struct.pack("<IBBHIIhhhbbbbBBbBH", *values)
        packet = body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF)
        telemetry = decode_telemetry(packet)
        self.assertTrue(telemetry.armed)
        self.assertTrue(telemetry.i2c_ok)
        self.assertEqual(telemetry.motors, (1, 2, 3, 4))
        self.assertEqual(telemetry.rssi, -60)
        self.assertEqual(telemetry.stop_reason, 0)
        for reason in range(1, 6):
            reported = list(values)
            reported[2] |= reason << 4
            body = struct.pack("<IBBHIIhhhbbbbBBbBH", *reported)
            result = decode_telemetry(body + struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF))
            self.assertEqual(result.stop_reason, reason)
            self.assertTrue(result.armed)


if __name__ == "__main__":
    unittest.main()
