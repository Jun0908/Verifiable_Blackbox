from __future__ import annotations

import struct
import zlib

from .models import ControlInput, Telemetry

CONTROL_MAGIC = 0x52565232
TELEMETRY_MAGIC = 0x54454C32
PROTOCOL_VERSION = 1

FLAG_DEADMAN = 1 << 0
FLAG_EMERGENCY_STOP = 1 << 1
FLAG_GRIPPER_VALID = 1 << 2
FLAG_AUX_SERVO_VALID = 1 << 3

TELEMETRY_I2C_OK = 1 << 0
TELEMETRY_ARMED = 1 << 1
TELEMETRY_MOTORS_RUNNING = 1 << 2
TELEMETRY_WIFI_OK = 1 << 3

_CONTROL_BODY = struct.Struct("<IBBHIIhhhBBBBI")
_CONTROL_PACKET = struct.Struct("<IBBHIIhhhBBBBII")
_TELEMETRY_PACKET = struct.Struct("<IBBHIIhhhbbbbBBbBHI")

CONTROL_PACKET_SIZE = _CONTROL_PACKET.size
TELEMETRY_PACKET_SIZE = _TELEMETRY_PACKET.size


class ProtocolError(ValueError):
    pass


def token_hash(token: str) -> int:
    result = 2_166_136_261
    for byte in token.encode("utf-8"):
        result ^= byte
        result = (result * 16_777_619) & 0xFFFFFFFF
    return result


def encode_control(
    command: ControlInput, session_id: int, sequence: int, token: str
) -> bytes:
    command = command.clamped()
    flags = 0
    if command.deadman:
        flags |= FLAG_DEADMAN
    if command.emergency_stop:
        flags |= FLAG_EMERGENCY_STOP
    if command.gripper_angle is not None:
        flags |= FLAG_GRIPPER_VALID
    if command.aux_servo_angle is not None:
        flags |= FLAG_AUX_SERVO_VALID

    body = _CONTROL_BODY.pack(
        CONTROL_MAGIC,
        PROTOCOL_VERSION,
        flags,
        CONTROL_PACKET_SIZE,
        session_id & 0xFFFFFFFF,
        sequence & 0xFFFFFFFF,
        round(command.x * 1000),
        round(command.y * 1000),
        round(command.z * 1000),
        command.speed_limit,
        command.gripper_angle or 0,
        command.aux_servo_angle or 0,
        0,
        token_hash(token),
    )
    checksum = zlib.crc32(body) & 0xFFFFFFFF
    return body + struct.pack("<I", checksum)


def decode_telemetry(data: bytes) -> Telemetry:
    if len(data) != TELEMETRY_PACKET_SIZE:
        raise ProtocolError(f"telemetry size {len(data)} is invalid")
    fields = _TELEMETRY_PACKET.unpack(data)
    (
        magic,
        version,
        flags,
        size,
        sequence,
        uptime_ms,
        x,
        y,
        z,
        m1,
        m2,
        m3,
        m4,
        gripper,
        aux_servo,
        rssi,
        speed_limit,
        packet_age_ms,
        checksum,
    ) = fields
    if magic != TELEMETRY_MAGIC or version != PROTOCOL_VERSION:
        raise ProtocolError("unknown telemetry protocol")
    if size != TELEMETRY_PACKET_SIZE:
        raise ProtocolError("telemetry header size is invalid")
    if zlib.crc32(data[:-4]) & 0xFFFFFFFF != checksum:
        raise ProtocolError("telemetry CRC is invalid")
    return Telemetry(
        sequence=sequence,
        uptime_ms=uptime_ms,
        x=x,
        y=y,
        z=z,
        motors=(m1, m2, m3, m4),
        gripper_angle=gripper,
        aux_servo_angle=aux_servo,
        rssi=rssi,
        speed_limit=speed_limit,
        packet_age_ms=packet_age_ms,
        i2c_ok=bool(flags & TELEMETRY_I2C_OK),
        armed=bool(flags & TELEMETRY_ARMED),
        motors_running=bool(flags & TELEMETRY_MOTORS_RUNNING),
        wifi_ok=bool(flags & TELEMETRY_WIFI_OK),
        stop_reason=flags >> 4,
    )


def newer_sequence(candidate: int, previous: int) -> bool:
    """RFC-1982 style ordering, including uint32 rollover."""
    return 0 < ((candidate - previous) & 0xffffffff) < 0x80000000
