from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = PROJECT_DIR / "config"


def load_env_file(path: Path | None = None) -> None:
    path = path or PROJECT_DIR / ".env"
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(slots=True)
class AppSettings:
    base_url: str
    token: str


@dataclass(slots=True)
class VerifierSettings:
    base_url: str
    bearer_token: str = ""


@dataclass(slots=True)
class RoverSettings:
    language: str = "ja"
    camera_url: str = ""
    camera_enabled: bool = True
    speed_limit: int = 35
    precision_speed: int = 18
    gripper_open_angle: int = 25
    gripper_closed_angle: int = 75
    gripper_saved_angle: int | None = None
    gripper_min_angle: int = 10
    gripper_max_angle: int = 90
    aux_servo_min_angle: int = 45
    aux_servo_max_angle: int = 135
    axis_deadzone: float = 0.12
    axis_expo: float = 0.25
    motor_signs: list[int] | None = None

    def __post_init__(self) -> None:
        if self.motor_signs is None:
            self.motor_signs = [1, 1, 1, 1]


@dataclass(slots=True)
class ControllerMapping:
    simple_setup_version: int = 0
    guid: str = ""
    name: str = ""
    axis_x: int = 0
    axis_y: int = 1
    axis_z: int = 2
    invert_x: bool = False
    invert_y: bool = True
    invert_z: bool = False
    deadman_button: int = 5
    gripper_open_button: int = 0
    gripper_close_button: int = 1
    aux_decrease_button: int = 2
    aux_increase_button: int = 3
    precision_button: int = 4
    emergency_button: int = 7
    deadzone: float = 0.12
    expo: float = 0.25
    smoothing: float = 0.2


def app_settings(require: bool = True) -> AppSettings:
    load_env_file()
    base_url = os.getenv("ROVER_BASE_URL", "").rstrip("/")
    token = os.getenv("ROVER_API_TOKEN", "")
    if require and (not base_url or not token):
        raise RuntimeError(
            "ROVER_BASE_URL and ROVER_API_TOKEN are required in rover-python/.env"
        )
    return AppSettings(base_url=base_url, token=token)


def verifier_settings(require: bool = True) -> VerifierSettings:
    load_env_file()
    base_url = os.getenv("VBB_VERIFIER_URL", "").rstrip("/")
    bearer_token = os.getenv("VBB_VERIFIER_BEARER_TOKEN", "")
    if require and not base_url:
        raise RuntimeError("VBB_VERIFIER_URL is required in rover-python/.env")
    return VerifierSettings(base_url=base_url, bearer_token=bearer_token)


def _load_dataclass(path: Path, cls):
    instance = cls()
    if not path.exists():
        return instance
    data = json.loads(path.read_text(encoding="utf-8"))
    allowed = {item.name for item in fields(cls)}
    return cls(**{key: value for key, value in data.items() if key in allowed})


def _save_dataclass(path: Path, instance: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(asdict(instance), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_rover_settings(path: Path | None = None) -> RoverSettings:
    return _load_dataclass(path or rover_settings_path(), RoverSettings)


def rover_settings_path() -> Path:
    override = os.getenv("ROVER_SETTINGS_FILE")
    return Path(override) if override else CONFIG_DIR / "rover.json"


def save_rover_settings(settings: RoverSettings, path: Path | None = None) -> None:
    _save_dataclass(path or rover_settings_path(), settings)


def load_controller_mapping(path: Path | None = None) -> ControllerMapping:
    return _load_dataclass(
        path or CONFIG_DIR / "controller.json", ControllerMapping
    )


def save_controller_mapping(
    mapping: ControllerMapping, path: Path | None = None
) -> None:
    _save_dataclass(path or CONFIG_DIR / "controller.json", mapping)
