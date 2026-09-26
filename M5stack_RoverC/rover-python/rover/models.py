from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class ControlInput:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    deadman: bool = False
    speed_limit: int = 35
    gripper_angle: int | None = None
    aux_servo_angle: int | None = None
    emergency_stop: bool = False

    def clamped(self) -> "ControlInput":
        return ControlInput(
            x=max(-1.0, min(1.0, self.x)),
            y=max(-1.0, min(1.0, self.y)),
            z=max(-1.0, min(1.0, self.z)),
            deadman=bool(self.deadman),
            speed_limit=max(10, min(100, int(self.speed_limit))),
            gripper_angle=(
                None
                if self.gripper_angle is None
                else max(10, min(90, int(self.gripper_angle)))
            ),
            aux_servo_angle=(
                None
                if self.aux_servo_angle is None
                else max(45, min(135, int(self.aux_servo_angle)))
            ),
            emergency_stop=bool(self.emergency_stop),
        )


@dataclass(slots=True)
class Telemetry:
    sequence: int
    uptime_ms: int
    x: int
    y: int
    z: int
    motors: tuple[int, int, int, int]
    gripper_angle: int
    aux_servo_angle: int
    rssi: int
    speed_limit: int
    packet_age_ms: int
    i2c_ok: bool
    armed: bool
    motors_running: bool
    wifi_ok: bool
    stop_reason: int = 0


@dataclass(slots=True)
class GamepadSnapshot:
    connected: bool = False
    name: str = ""
    guid: str = ""
    axes: list[float] = field(default_factory=list)
    buttons: list[bool] = field(default_factory=list)
    hats: list[tuple[int, int]] = field(default_factory=list)
