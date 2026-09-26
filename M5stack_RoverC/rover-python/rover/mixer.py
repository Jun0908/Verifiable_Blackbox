from __future__ import annotations


def shape_axis(value: float, deadzone: float = 0.12, expo: float = 0.25) -> float:
    """Apply symmetric deadzone and exponential response."""
    value = max(-1.0, min(1.0, float(value)))
    deadzone = max(0.0, min(0.9, float(deadzone)))
    expo = max(0.0, min(1.0, float(expo)))
    magnitude = abs(value)
    if magnitude <= deadzone:
        return 0.0
    normalized = (magnitude - deadzone) / (1.0 - deadzone)
    curved = (1.0 - expo) * normalized + expo * normalized**3
    return curved if value >= 0.0 else -curved


def mecanum_mix(
    x: float, y: float, z: float, speed_limit: int = 100
) -> tuple[int, int, int, int]:
    """Use the same wheel ordering/formula as M5Stack's RoverC library."""
    x = max(-1.0, min(1.0, x))
    y = max(-1.0, min(1.0, y))
    z = max(-1.0, min(1.0, z))
    values = [y + x - z, y - x + z, y - x - z, y + x + z]
    scale = max(1.0, *(abs(value) for value in values))
    limit = max(0, min(100, int(speed_limit)))
    return tuple(round(value / scale * limit) for value in values)  # type: ignore[return-value]
