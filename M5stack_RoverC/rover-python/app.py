from __future__ import annotations

import sys
import time
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from dataclasses import replace

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QCloseEvent
from PySide6.QtWidgets import (
    QApplication,
    QButtonGroup,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from rover.advanced_dialog import AdvancedDialog
from rover.api import RoverAPIError, discover_rovers
from rover.config import (
    ControllerMapping,
    app_settings,
    load_controller_mapping,
    load_rover_settings,
    save_controller_mapping,
    save_rover_settings,
)
from rover.control import RoverController
from rover.camera import CameraStream, stream_url
from rover.camera_panel import CameraPanel
from rover.gamepad import GamepadManager
from rover.gamepad_dialog import GamepadSetupDialog
from rover.i18n import translate
from rover.mixer import shape_axis
from rover.models import ControlInput, GamepadSnapshot
from rover.simple_setup import SimpleControllerSetup

SPEEDS = {"speed_slow": 35, "speed_normal": 60, "speed_fast": 85}


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("RoverC Pro Remote")
        self.setMinimumSize(860, 780)
        self.resize(980, 820)

        self.settings = load_rover_settings()
        self.language = self.settings.language if self.settings.language in ("ja", "en") else "ja"
        self.mapping = load_controller_mapping()
        environment = app_settings(require=False)
        self.token = environment.token
        self.current_url = environment.base_url
        self.controller: RoverController | None = None
        self.gamepad = GamepadManager()
        self.camera = CameraStream()
        self.camera.configure(self.settings.camera_url if self.settings.camera_enabled else "")
        self.last_snapshot = GamepadSnapshot()
        self.last_buttons: list[bool] = []
        self.last_hat = (0, 0)
        self.last_gamepad_guid = ""
        self.gamepad_ready = False
        self.last_telemetry_at = 0.0
        self.last_connection_attempt = 0.0
        self.setup_prompted_guid = ""
        self.paused = False
        self.settings_open = False
        self.calibrating = False
        self.state_key = "status_searching"
        self.state_color = "#f4c95d"
        self.detail_key = "status_check_controller"
        self.detail_values: dict[str, object] = {}
        self.simple_state = self.tr(self.state_key)
        self.log_messages: list[str] = []
        self.pending_gripper: int | None = None
        self.pending_aux: int | None = None
        self.servo_sequence: int | None = None
        self.servo_deadline = 0.0
        self.servo_feedback_key = "servo_idle"
        self.screen_x = 0.0
        self.screen_y = 0.0
        self.screen_z = 0.0
        self.screen_active = False
        self.screen_press_started = 0.0
        self.screen_generation = 0
        self.gripper_angle = self.settings.gripper_open_angle
        self.gripper_target = self.gripper_angle
        self.gripper_close_source: str | None = None
        self.gripper_goal: int | None = None
        self.gripper_next_step = 0.0
        self.last_stop_reason = 0
        self.aux_angle = 90
        self.selected_speed = min(
            SPEEDS.values(), key=lambda speed: abs(speed - self.settings.speed_limit)
        )

        self._build_ui()
        self._set_state("status_searching", "#f4c95d", "status_check_controller")

        self.control_timer = QTimer(self)
        self.control_timer.timeout.connect(self._control_tick)
        self.control_timer.start(40)
        self.connection_timer = QTimer(self)
        self.connection_timer.timeout.connect(self._connection_tick)
        self.connection_timer.start(1000)
        QTimer.singleShot(200, self._connection_tick)

    def _build_ui(self) -> None:
        central = QWidget()
        central.setObjectName("central")
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(30, 24, 30, 20)
        layout.setSpacing(18)

        title_row = QHBoxLayout()
        brand = QVBoxLayout()
        brand.setSpacing(1)
        title = QLabel("ROVERC PRO")
        title.setObjectName("title")
        self.subtitle_label = QLabel()
        self.subtitle_label.setObjectName("subtitle")
        brand.addWidget(title)
        brand.addWidget(self.subtitle_label)
        title_row.addLayout(brand)
        title_row.addStretch()

        language_frame = QFrame()
        language_frame.setObjectName("languageFrame")
        language_row = QHBoxLayout(language_frame)
        language_row.setContentsMargins(3, 3, 3, 3)
        language_row.setSpacing(0)
        self.language_group = QButtonGroup(self)
        self.language_group.setExclusive(True)
        self.language_buttons: dict[str, QPushButton] = {}
        for code, label in (("ja", "JP"), ("en", "EN")):
            button = QPushButton(label)
            button.setObjectName("language")
            button.setCheckable(True)
            button.setMinimumSize(48, 36)
            button.clicked.connect(
                lambda checked=False, selected=code: self.set_language(selected)
            )
            self.language_group.addButton(button)
            self.language_buttons[code] = button
            language_row.addWidget(button)
        self.language_buttons[self.language].setChecked(True)
        title_row.addWidget(language_frame)

        self.settings_button = QPushButton()
        self.settings_button.setObjectName("settings")
        self.settings_button.setMinimumHeight(42)
        self.settings_button.clicked.connect(self.open_advanced)
        title_row.addWidget(self.settings_button)
        layout.addLayout(title_row)

        self.state_frame = QFrame()
        self.state_frame.setObjectName("stateFrame")
        state_layout = QHBoxLayout(self.state_frame)
        state_layout.setContentsMargins(20, 15, 20, 15)
        self.state_dot = QLabel("●")
        self.state_dot.setObjectName("stateDot")
        self.state_label = QLabel()
        self.state_label.setObjectName("state")
        self.controller_label = QLabel()
        self.controller_label.setObjectName("substate")
        state_layout.addWidget(self.state_dot)
        state_layout.addWidget(self.state_label)
        state_layout.addSpacing(12)
        state_layout.addWidget(self.controller_label, 1)
        layout.addWidget(self.state_frame)

        content = QHBoxLayout()
        content.setSpacing(18)

        drive_panel = QFrame()
        drive_panel.setObjectName("panel")
        drive_layout = QVBoxLayout(drive_panel)
        drive_layout.setContentsMargins(22, 20, 22, 22)
        drive_layout.setSpacing(12)
        self.drive_title_label = QLabel()
        self.drive_title_label.setObjectName("sectionTitle")
        self.drive_hint_label = QLabel()
        self.drive_hint_label.setObjectName("sectionHint")
        drive_layout.addWidget(self.drive_title_label)
        drive_layout.addWidget(self.drive_hint_label)
        self.camera_panel = CameraPanel(self.camera, self.tr, self)
        drive_layout.addWidget(self.camera_panel, 1)
        drive_grid = QGridLayout()
        drive_grid.setSpacing(12)
        drive_specs = (
            ("drive_rotate_left", 0, 0, (0.0, 0.0, -1.0)),
            ("drive_forward", 0, 1, (0.0, 1.0, 0.0)),
            ("drive_rotate_right", 0, 2, (0.0, 0.0, 1.0)),
            ("drive_left", 1, 0, (-1.0, 0.0, 0.0)),
            ("drive_stop", 1, 1, None),
            ("drive_right", 1, 2, (1.0, 0.0, 0.0)),
            ("drive_backward", 2, 1, (0.0, -1.0, 0.0)),
        )
        self.drive_buttons: dict[str, QPushButton] = {}
        for key, row, column, vector in drive_specs:
            button = QPushButton()
            button.setObjectName("driveStop" if vector is None else "drive")
            button.setMinimumSize(116, 64)
            if vector is None:
                button.clicked.connect(self.toggle_pause)
            else:
                button.pressed.connect(
                    lambda value=vector: self._screen_pressed(*value)
                )
                button.released.connect(self._screen_released)
            self.drive_buttons[key] = button
            drive_grid.addWidget(button, row, column)
        drive_layout.addLayout(drive_grid)
        content.addWidget(drive_panel, 3)

        side = QVBoxLayout()
        side.setSpacing(14)

        speed_panel = QFrame()
        speed_panel.setObjectName("panel")
        speed_layout = QVBoxLayout(speed_panel)
        speed_layout.setContentsMargins(18, 16, 18, 18)
        speed_layout.setSpacing(10)
        self.speed_title_label = QLabel()
        self.speed_title_label.setObjectName("sectionTitle")
        speed_layout.addWidget(self.speed_title_label)
        speed_row = QHBoxLayout()
        speed_row.setSpacing(8)
        self.speed_group = QButtonGroup(self)
        self.speed_group.setExclusive(True)
        self.speed_buttons: dict[int, QPushButton] = {}
        self.speed_keys: dict[int, str] = {}
        for key, speed in SPEEDS.items():
            button = QPushButton()
            button.setCheckable(True)
            button.setObjectName("choice")
            button.setMinimumHeight(48)
            button.clicked.connect(lambda checked=False, value=speed: self.set_speed(value))
            self.speed_group.addButton(button, speed)
            self.speed_buttons[speed] = button
            self.speed_keys[speed] = key
            speed_row.addWidget(button)
        self.speed_buttons[self.selected_speed].setChecked(True)
        speed_layout.addLayout(speed_row)
        side.addWidget(speed_panel)

        gripper_panel = QFrame()
        gripper_panel.setObjectName("panel")
        gripper_panel.setMinimumHeight(330)
        gripper_layout = QVBoxLayout(gripper_panel)
        gripper_layout.setContentsMargins(18, 16, 18, 18)
        gripper_layout.setSpacing(10)
        self.gripper_title_label = QLabel()
        self.gripper_title_label.setObjectName("sectionTitle")
        gripper_layout.addWidget(self.gripper_title_label)
        gripper_row = QHBoxLayout()
        gripper_row.setSpacing(8)
        self.open_button = QPushButton()
        self.close_button = QPushButton()
        for button in (self.open_button, self.close_button):
            button.setObjectName("gripper")
            button.setMinimumHeight(58)
            gripper_row.addWidget(button)
        self.open_button.clicked.connect(self.release_gripper)
        self.close_button.pressed.connect(lambda: self.start_gripper_close("screen"))
        self.close_button.released.connect(lambda: self.stop_gripper_close("screen"))
        gripper_layout.addLayout(gripper_row)
        self.loosen_button = QPushButton()
        self.loosen_button.setObjectName("gripper")
        self.loosen_button.setMinimumHeight(40)
        self.loosen_button.clicked.connect(self.loosen_gripper)
        gripper_layout.addWidget(self.loosen_button)
        preset_row = QHBoxLayout()
        self.save_grip_button = QPushButton()
        self.recall_grip_button = QPushButton()
        for button in (self.save_grip_button, self.recall_grip_button):
            button.setObjectName("choice")
            button.setMinimumHeight(38)
            preset_row.addWidget(button)
        self.save_grip_button.clicked.connect(self.save_gripper_position)
        self.recall_grip_button.clicked.connect(self.recall_gripper_position)
        gripper_layout.addLayout(preset_row)
        self.gripper_position = QLabel()
        self.gripper_position.setObjectName("sectionHint")
        gripper_layout.addWidget(self.gripper_position)
        self.gripper_hint = QLabel()
        self.gripper_hint.setObjectName("sectionHint")
        self.gripper_hint.setWordWrap(True)
        gripper_layout.addWidget(self.gripper_hint)
        self.servo_feedback = QLabel()
        self.servo_feedback.setObjectName("sectionHint")
        self.servo_feedback.setWordWrap(True)
        gripper_layout.addWidget(self.servo_feedback)
        side.addWidget(gripper_panel)

        self.stop_button = QPushButton()
        self.stop_button.setObjectName("stop")
        self.stop_button.setMinimumHeight(104)
        self.stop_button.clicked.connect(self.toggle_pause)
        side.addWidget(self.stop_button)
        side.addStretch()
        content.addLayout(side, 2)
        layout.addLayout(content, 1)

        self.setup_button = QPushButton()
        self.setup_button.setObjectName("setup")
        self.setup_button.clicked.connect(self.run_simple_setup)
        self.setup_button.hide()
        layout.addWidget(self.setup_button)

        self.footer_label = QLabel()
        self.footer_label.setObjectName("footer")
        self.footer_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.footer_label)

        self.setStyleSheet(
            """
            QWidget#central { background: #090d12; color: #eef2f7; }
            QLabel#title { font-size: 27px; font-weight: 900; letter-spacing: 2px; color: #f8fafc; }
            QLabel#subtitle { font-size: 12px; font-weight: 600; color: #7f8b9a; letter-spacing: 1px; }
            QFrame#languageFrame { background: #151b23; border: 1px solid #252e3a; border-radius: 10px; }
            QPushButton#language { border: none; border-radius: 7px; background: transparent;
                                   color: #778394; font-size: 13px; font-weight: 800; }
            QPushButton#language:checked { background: #2d3745; color: #ffffff; }
            QPushButton#settings { padding: 9px 18px; border: 1px solid #2a3441; border-radius: 10px;
                                   background: #151b23; color: #dce3eb; font-size: 14px; font-weight: 700; }
            QPushButton#settings:hover { background: #202834; }
            QFrame#stateFrame { background: #121820; border: 1px solid #242d39; border-radius: 14px; }
            QLabel#stateDot { font-size: 17px; }
            QLabel#state { font-size: 20px; font-weight: 850; }
            QLabel#substate { font-size: 13px; color: #8f9ba9; }
            QFrame#panel { background: #121820; border: 1px solid #242d39; border-radius: 18px; }
            QLabel#sectionTitle { font-size: 15px; font-weight: 850; color: #e9eef5; letter-spacing: 1px; }
            QLabel#sectionHint { font-size: 12px; color: #748191; }
            QLabel#footer { font-size: 11px; color: #596575; }
            QPushButton { color: #f7f9fc; }
            QPushButton#drive { border: 1px solid #303b49; border-radius: 14px;
                                background: #1b232e; font-size: 17px; font-weight: 800; }
            QPushButton#drive:hover { background: #252f3d; border-color: #465568; }
            QPushButton#drive:pressed { background: #2563eb; border-color: #60a5fa; }
            QPushButton#driveStop { border: 1px solid #6b3f46; border-radius: 14px;
                                    background: #302026; color: #ff9aa7; font-size: 17px; font-weight: 850; }
            QPushButton#driveStop:hover { background: #43262e; }
            QPushButton#choice { border: 1px solid #303a47; border-radius: 10px;
                                 background: #1a212b; color: #929eac; font-size: 12px; font-weight: 800; }
            QPushButton#choice:hover { background: #242e3a; }
            QPushButton#choice:checked { background: #143b34; border: 1px solid #3dd6b0; color: #78f0d0; }
            QPushButton#gripper { border: 1px solid #354253; border-radius: 11px;
                                  background: #1c2632; font-size: 16px; font-weight: 750; }
            QPushButton#gripper:hover { background: #273443; }
            QPushButton#stop { background: #e04455; border: none; border-radius: 16px;
                               color: white; font-size: 25px; font-weight: 900; }
            QPushButton#stop:hover { background: #f05262; }
            QPushButton#setup { background: #b7791f; border: none; border-radius: 10px;
                                color: white; font-size: 17px; padding: 14px; }
            """
        )
        self._apply_language()

    def tr(self, key: str, **values: object) -> str:
        return translate(self.language, key, **values)

    def set_language(self, language: str) -> None:
        if language not in ("ja", "en") or language == self.language:
            return
        self.language = language
        self.settings.language = language
        save_rover_settings(self.settings)
        self._apply_language()

    def _apply_language(self) -> None:
        self.language_buttons[self.language].setChecked(True)
        self.subtitle_label.setText(self.tr("app_subtitle"))
        self.settings_button.setText(self.tr("settings"))
        self.drive_title_label.setText(self.tr("drive_title"))
        self.drive_hint_label.setText(self.tr("drive_hint"))
        for key, button in self.drive_buttons.items():
            button.setText(self.tr(key))
        self.speed_title_label.setText(self.tr("speed_title"))
        for speed, button in self.speed_buttons.items():
            button.setText(self.tr(self.speed_keys[speed]))
        self.gripper_title_label.setText(self.tr("gripper_title"))
        self.open_button.setText(self.tr("gripper_open"))
        self.close_button.setText(self.tr("gripper_close_hold"))
        self.loosen_button.setText(self.tr("gripper_loosen"))
        self.save_grip_button.setText(self.tr("gripper_save"))
        self.recall_grip_button.setText(self.tr("gripper_recall"))
        self.gripper_hint.setText(self.tr("gripper_hint"))
        self._render_gripper()
        self.setup_button.setText(self.tr("setup_controller"))
        self.footer_label.setText(self.tr("footer_hint"))
        self.servo_feedback.setText(self.tr(self.servo_feedback_key))
        self._render_state()

    def _log(self, message: str) -> None:
        self.log_messages.append(time.strftime("%H:%M:%S ") + message)
        del self.log_messages[:-500]
        logging.getLogger("rover.ui").info(message)

    def _set_state(
        self,
        key: str,
        color: str,
        detail_key: str | None = None,
        **detail_values: object,
    ) -> None:
        self.state_key = key
        self.state_color = color
        if detail_key is not None:
            self.detail_key = detail_key
            self.detail_values = detail_values
        self._render_state()

    def _render_state(self) -> None:
        self.simple_state = self.tr(self.state_key)
        self.state_label.setText(self.simple_state)
        self.state_label.setStyleSheet(f"color: {self.state_color};")
        self.state_dot.setStyleSheet(f"color: {self.state_color};")
        self.controller_label.setText(
            self.tr(self.detail_key, **self.detail_values) if self.detail_key else ""
        )
        can_operate = self.controller is not None and not self.calibrating
        self.open_button.setEnabled(can_operate)
        self.close_button.setEnabled(can_operate)
        self.loosen_button.setEnabled(can_operate)
        self._render_gripper()
        self.stop_button.setText(self.tr("resume" if self.paused else "stop"))
        if self.paused:
            self.stop_button.setStyleSheet(
                "background: #16845b; font-size: 24px; font-weight: 900;"
            )
        else:
            self.stop_button.setStyleSheet("")

    def _set_servo_feedback(self, key: str) -> None:
        changed = key != self.servo_feedback_key
        self.servo_feedback_key = key
        self.servo_feedback.setText(self.tr(key))
        if changed and not self.gripper_close_source and self.gripper_goal is None:
            self._log(self.tr(key))

    def _clear_pending_servos(self, feedback: str | None = None) -> None:
        pending = self.pending_gripper is not None or self.pending_aux is not None
        self.pending_gripper = None
        self.pending_aux = None
        self.servo_sequence = None
        self.servo_deadline = 0.0
        if pending and feedback:
            self._set_servo_feedback(feedback)

    def _prepare_manual_control(self) -> bool:
        if self.controller is None or self.calibrating:
            self._set_servo_feedback("servo_unavailable")
            return False
        self.paused = False
        if not self.controller.armed:
            self._try_start_control()
        if not self.controller.armed:
            self._set_servo_feedback("servo_unavailable")
            return False
        return True

    def _mapping_matches(self, snapshot: GamepadSnapshot) -> bool:
        if (
            not snapshot.connected
            or not self.mapping.guid
            or self.mapping.simple_setup_version < 1
        ):
            return False
        if self.mapping.guid != snapshot.guid:
            return False
        return all(
            0 <= axis < len(snapshot.axes)
            for axis in (self.mapping.axis_x, self.mapping.axis_y, self.mapping.axis_z)
        )

    def _apply_default_mapping(self, snapshot: GamepadSnapshot) -> None:
        """Apply a ready-to-use layout; manual setup remains optional."""
        axis_count = len(snapshot.axes)
        button_count = len(snapshot.buttons)
        self.mapping = ControllerMapping(
            simple_setup_version=1,
            guid=snapshot.guid,
            name=snapshot.name,
            axis_x=0,
            axis_y=1 if axis_count > 1 else 0,
            axis_z=2 if axis_count > 2 else 0,
            invert_x=False,
            invert_y=True,
            invert_z=False,
            deadman_button=5 if button_count > 5 else 0,
            gripper_open_button=0,
            gripper_close_button=1 if button_count > 1 else 0,
            aux_decrease_button=2 if button_count > 2 else 0,
            aux_increase_button=3 if button_count > 3 else 0,
            precision_button=4 if button_count > 4 else 0,
            emergency_button=9 if button_count > 9 else max(0, button_count - 1),
            deadzone=0.20,
            expo=0.20,
            smoothing=0.15,
        )
        save_controller_mapping(self.mapping)
        self._log(self.tr("log_default_mapping", name=snapshot.name))

    def _axis(self, snapshot: GamepadSnapshot, index: int, inverted: bool) -> float:
        value = snapshot.axes[index] if 0 <= index < len(snapshot.axes) else 0.0
        if inverted:
            value = -value
        return shape_axis(value, self.mapping.deadzone, self.mapping.expo)

    def _controls_centered(self, snapshot: GamepadSnapshot) -> bool:
        if not snapshot.connected:
            return True
        if not self._mapping_matches(snapshot):
            return False
        values = (
            self._axis(snapshot, self.mapping.axis_x, self.mapping.invert_x),
            self._axis(snapshot, self.mapping.axis_y, self.mapping.invert_y),
            self._axis(snapshot, self.mapping.axis_z, self.mapping.invert_z),
        )
        return max(abs(value) for value in values) < 0.08

    def _candidate_urls(self) -> list[str]:
        urls: list[str] = []
        if self.current_url:
            urls.append(self.current_url)
        for device in discover_rovers(timeout=0.35):
            url = f"http://{device['ip']}"
            if url not in urls:
                urls.append(url)
        return urls

    def _attempt_connect(self) -> None:
        if not self.token:
            self._set_state(
                "status_setup_required", "#ff6b78", "detail_open_settings"
            )
            return
        self._set_state("status_searching", "#f4c95d", "status_check_controller")
        for url in self._candidate_urls():
            candidate: RoverController | None = None
            try:
                candidate = RoverController(url, self.token)
                status = candidate.connect()
                if status.get("armed"):
                    raise RoverAPIError("Rover is owned by another controller; stop that session first")
                candidate.api.configure(85, self.settings.motor_signs)
            except Exception as exc:
                if candidate is not None:
                    candidate.close(send_stop=False)
                self._log(self.tr("log_connect_wait", error=exc))
                continue
            if self.controller is not None:
                self.controller.close(send_stop=False)
            self.controller = candidate
            self.gripper_angle = int(status.get("gripper_angle", self.gripper_angle))
            self.gripper_target = self.gripper_angle
            candidate.start_stream()
            self.current_url = url
            self.last_telemetry_at = 0.0
            self._log(self.tr("log_connected", url=url))
            self._try_start_control()
            return
        self._set_state(
            "status_power",
            "#ff6b78",
            "detail_power",
        )

    def _connection_tick(self) -> None:
        if self.controller is None:
            now = time.monotonic()
            if now - self.last_connection_attempt >= 3.0:
                self.last_connection_attempt = now
                self._attempt_connect()
            return
        if not self.last_snapshot.connected:
            self.setup_button.hide()
            if not self.paused and not self.controller.armed:
                self._try_start_control()
            elif not self.paused and self.last_stop_reason not in (2, 3):
                self._set_state(
                    "status_ready",
                    "#63e6be",
                    "detail_screen",
                )
            return
        if not self._mapping_matches(self.last_snapshot):
            self._apply_default_mapping(self.last_snapshot)
        self.setup_button.hide()
        if not self.paused and not self.controller.armed:
            self._try_start_control()

    def _try_start_control(self) -> None:
        if self.controller is None:
            return
        snapshot = self.last_snapshot
        if snapshot.connected and not self._mapping_matches(snapshot):
            self._apply_default_mapping(snapshot)
        if self.paused:
            self._set_state("status_stopped", "#ff6b78", "detail_resume")
            return
        # An off-center gamepad must not block the on-screen controls.
        # Enable its axes only after a neutral sample in this control session.
        self.gamepad_ready = self._controls_centered(snapshot)
        try:
            self.controller.arm()
            self.controller.send(ControlInput(speed_limit=self.selected_speed))
        except (RoverAPIError, OSError) as exc:
            self._log(self.tr("log_control_wait", error=exc))
            return
        self.last_telemetry_at = time.monotonic()
        self._set_state(
            "status_ready",
            "#63e6be",
            "detail_pad" if snapshot.connected else "detail_screen",
            **({"name": snapshot.name} if snapshot.connected else {}),
        )
        self._log(self.tr("log_ready"))

    @staticmethod
    def _pressed(buttons: list[bool], index: int) -> bool:
        return 0 <= index < len(buttons) and buttons[index]

    def _rising(self, buttons: list[bool], index: int) -> bool:
        return self._pressed(buttons, index) and not self._pressed(
            self.last_buttons, index
        )

    def _handle_edges(self, snapshot: GamepadSnapshot) -> None:
        if self.settings_open or self.calibrating:
            self.last_buttons = list(snapshot.buttons)
            return
        if self._rising(snapshot.buttons, self.mapping.emergency_button):
            self.last_buttons = list(snapshot.buttons)
            self.toggle_pause()
            return
        if self._rising(snapshot.buttons, self.mapping.gripper_open_button):
            self.release_gripper()
        if self._rising(snapshot.buttons, self.mapping.gripper_close_button):
            self.start_gripper_close("gamepad")
        if not self._pressed(snapshot.buttons, self.mapping.gripper_close_button):
            self.stop_gripper_close("gamepad")
        if self.paused:
            self.last_buttons = list(snapshot.buttons)
            return
        hat = snapshot.hats[0] if snapshot.hats else (0, 0)
        speeds = list(SPEEDS.values())
        current = speeds.index(self.selected_speed)
        if hat[1] == 1 and self.last_hat[1] != 1:
            self.set_speed(speeds[min(len(speeds) - 1, current + 1)])
        elif hat[1] == -1 and self.last_hat[1] != -1:
            self.set_speed(speeds[max(0, current - 1)])
        self.last_hat = hat
        self.last_buttons = list(snapshot.buttons)

    def _control_tick(self) -> None:
        snapshot = self.gamepad.poll()
        first_sample = snapshot.connected and snapshot.guid != self.last_gamepad_guid
        disconnected = self.last_snapshot.connected and not snapshot.connected
        self.last_snapshot = snapshot
        if first_sample:
            self.gamepad_ready = False
            self.last_gamepad_guid = snapshot.guid
            if not self._mapping_matches(snapshot):
                self._apply_default_mapping(snapshot)
            self.last_buttons = list(snapshot.buttons)
            self.last_hat = snapshot.hats[0] if snapshot.hats else (0, 0)
            self._log(self.tr("log_controller_connected", name=snapshot.name))
            QTimer.singleShot(0, self._connection_tick)
        elif disconnected:
            self.stop_gripper_close("gamepad")
            self.gamepad_ready = False
            self.last_gamepad_guid = ""
            self._log(self.tr("log_controller_removed"))
            self.last_buttons = []
            self.last_hat = (0, 0)

        if self.calibrating:
            self.last_buttons = list(snapshot.buttons)
            return

        if snapshot.connected and not self.gamepad_ready:
            self.gamepad_ready = self._controls_centered(snapshot)

        if snapshot.connected:
            self._handle_edges(snapshot)
        if self.controller is None:
            return

        try:
            telemetry = self.controller.receive_telemetry()
        except (RoverAPIError, OSError) as exc:
            self._log(self.tr("log_disconnected", error=exc))
            self._drop_connection()
            return
        if telemetry is not None:
            self._accept_telemetry(telemetry)
        received_at = max(self.last_telemetry_at, self.controller.last_received_at)
        if received_at and time.monotonic() - received_at > 2.0:
            self._log(self.tr("log_no_response"))
            self._drop_connection()
            return
        if self.paused or not self.controller.armed:
            return

        drive_source = None

        if self.settings_open:
            command = ControlInput(speed_limit=self.selected_speed)
        elif self.screen_active:
            command = ControlInput(
                x=self.screen_x,
                y=self.screen_y,
                z=self.screen_z,
                deadman=True,
                speed_limit=self.selected_speed,
            )
        elif snapshot.connected and self.gamepad_ready:
            # Only immutable mapping/speed and the thread-safe reader enter the worker.
            mapping, speed, manager = replace(self.mapping), self.selected_speed, self.gamepad
            drive_source = lambda: manager.live_drive(mapping, speed)
            command = ControlInput(speed_limit=self.selected_speed)
        else:
            command = ControlInput(speed_limit=self.selected_speed)

        self.controller.set_drive_source(drive_source)
        if self.servo_deadline and time.monotonic() >= self.servo_deadline:
            self.cancel_gripper_motion()
            self._clear_pending_servos("servo_timeout")
        if not self.settings_open:
            self._advance_gripper()
        has_servo = self.pending_gripper is not None or self.pending_aux is not None
        if has_servo:
            command.deadman = True
            command.gripper_angle = self.pending_gripper
            command.aux_servo_angle = self.pending_aux
        try:
            sequence = self.controller.send(command)
            if has_servo and self.servo_sequence is None:
                self.servo_sequence = sequence
        except (RoverAPIError, OSError) as exc:
            self._log(self.tr("log_disconnected", error=exc))
            self._drop_connection()
            return
        self._render_gripper()

    def _accept_telemetry(self, telemetry) -> None:
        self.last_telemetry_at = time.monotonic()
        self.gripper_angle = telemetry.gripper_angle
        self.aux_angle = telemetry.aux_servo_angle
        reason = telemetry.stop_reason
        if reason != self.last_stop_reason:
            self.last_stop_reason = reason
            self._log(self.tr("log_stop_reason", reason=self.tr(f"reason_{reason}")))
        if not telemetry.armed:
            self.paused = True
            self.cancel_gripper_motion()
            self._clear_pending_servos("servo_interrupted")
            self._finish_screen_motion()
            self._set_state("status_stopped", "#ff6b78", "detail_stop_reason", reason=self.tr(f"reason_{reason}"))
            return
        if reason in (2, 3):
            self._set_state("status_link_wait", "#f4c95d", "detail_link_wait")
        elif not self.paused and self.state_key == "status_link_wait":
            self._set_state("status_ready", "#63e6be", "detail_screen")
        if self.servo_sequence is not None and telemetry.sequence >= self.servo_sequence:
            if telemetry.gripper_angle == self.pending_gripper:
                self.pending_gripper = None
            if telemetry.aux_servo_angle == self.pending_aux:
                self.pending_aux = None
            if self.pending_gripper is None and self.pending_aux is None:
                self._clear_pending_servos()
                self._set_servo_feedback("servo_received")
        if self.pending_gripper is None:
            self.gripper_target = self.gripper_angle
        self._render_gripper()

    def _drop_connection(self) -> None:
        self.paused = True
        self.cancel_gripper_motion()
        self._clear_pending_servos("servo_interrupted")
        self.gamepad_ready = False
        if self.controller is not None:
            self.controller.close(send_stop=True)
        self.controller = None
        self.last_telemetry_at = 0.0
        self._finish_screen_motion()
        self._set_state("status_reconnecting", "#f4c95d", "status_check_controller")

    def toggle_pause(self) -> None:
        if self.paused:
            self.paused = False
            self._try_start_control()
            return
        self.paused = True
        self.cancel_gripper_motion()
        self._clear_pending_servos("servo_interrupted")
        self.gamepad_ready = False
        self._finish_screen_motion()
        if self.controller is not None:
            try:
                self.controller.emergency_stop()
            except RoverAPIError as exc:
                self._log(self.tr("log_stop_error", error=exc))
                self.controller.armed = False
        self._set_state("status_stopped", "#ff6b78", "detail_resume")
        self._log(self.tr("log_stopped"))

    def _screen_pressed(self, x: float, y: float, z: float) -> None:
        if not self._prepare_manual_control():
            return
        self.screen_generation += 1
        self.screen_press_started = time.monotonic()
        self.screen_x = x
        self.screen_y = y
        self.screen_z = z
        self.screen_active = True

    def _screen_released(self) -> None:
        token = self.screen_generation
        elapsed = time.monotonic() - self.screen_press_started
        remaining_ms = max(0, round((0.35 - elapsed) * 1000))
        if remaining_ms:
            QTimer.singleShot(
                remaining_ms,
                lambda expected=token: self._finish_screen_motion(expected),
            )
        else:
            self._finish_screen_motion(token)

    def _finish_screen_motion(self, expected_generation: int | None = None) -> None:
        if (
            expected_generation is not None
            and expected_generation != self.screen_generation
        ):
            return
        self.screen_x = 0.0
        self.screen_y = 0.0
        self.screen_z = 0.0
        self.screen_active = False

    def set_speed(self, speed: int) -> None:
        self.selected_speed = speed
        self.settings.speed_limit = speed
        if speed in self.speed_buttons:
            self.speed_buttons[speed].setChecked(True)
        self._log(self.tr("log_speed", speed=self.tr(self.speed_keys[speed])))

    def queue_gripper(self, angle: int) -> None:
        if not self._prepare_manual_control():
            return
        self.pending_gripper = max(max(10, self.settings.gripper_min_angle), min(min(90, self.settings.gripper_max_angle), angle))
        self.gripper_target = self.pending_gripper
        self.servo_sequence = None
        self.servo_deadline = time.monotonic() + 2.0
        self._set_servo_feedback("servo_sending")

    def _render_gripper(self) -> None:
        self.gripper_position.setText(self.tr("gripper_position", angle=self.gripper_target))
        connected = self.controller is not None and not self.calibrating
        settled = self.pending_gripper is None and self.gripper_close_source is None and self.gripper_goal is None
        fresh = bool(self.last_telemetry_at and time.monotonic() - self.last_telemetry_at < 2.0)
        self.save_grip_button.setEnabled(connected and settled and fresh)
        self.recall_grip_button.setEnabled(connected and self.settings.gripper_saved_angle is not None)

    def cancel_gripper_motion(self) -> None:
        self.gripper_close_source = None
        self.gripper_goal = None

    def release_gripper(self) -> None:
        self.cancel_gripper_motion()
        self.queue_gripper(self.settings.gripper_open_angle)

    def start_gripper_close(self, source: str) -> None:
        if not self._prepare_manual_control():
            return
        self.gripper_goal = None
        self.gripper_close_source = source
        self.gripper_next_step = 0.0

    def stop_gripper_close(self, source: str) -> None:
        if self.gripper_close_source == source:
            self.gripper_close_source = None

    def _advance_gripper(self) -> None:
        if self.pending_gripper is not None or time.monotonic() < self.gripper_next_step:
            return
        goal = self.gripper_goal
        if goal is None and self.gripper_close_source is not None:
            goal = self.settings.gripper_closed_angle
        if goal is None:
            return
        goal = max(max(10, self.settings.gripper_min_angle), min(min(90, self.settings.gripper_max_angle), goal))
        if goal == self.gripper_target:
            self.gripper_goal = None
            return
        step = 1 if goal > self.gripper_target else -1
        self.queue_gripper(self.gripper_target + step)
        self.gripper_next_step = time.monotonic() + 0.08

    def loosen_gripper(self) -> None:
        self.cancel_gripper_motion()
        direction = 1 if self.settings.gripper_open_angle > self.settings.gripper_closed_angle else -1
        self.queue_gripper(self.gripper_target + direction * 3)

    def save_gripper_position(self) -> None:
        if (self.controller is None or self.pending_gripper is not None
                or self.gripper_close_source is not None or self.gripper_goal is not None
                or not self.last_telemetry_at or time.monotonic() - self.last_telemetry_at >= 2.0):
            return
        self.settings.gripper_saved_angle = self.gripper_angle
        save_rover_settings(self.settings)
        self._set_servo_feedback("gripper_saved")
        self._render_gripper()

    def recall_gripper_position(self) -> None:
        if self.settings.gripper_saved_angle is None or not self._prepare_manual_control():
            return
        self.cancel_gripper_motion()
        self.gripper_goal = self.settings.gripper_saved_angle
        self.gripper_next_step = 0.0

    def _suspend_inputs(self) -> None:
        self.cancel_gripper_motion()
        self._clear_pending_servos("servo_interrupted")
        self._finish_screen_motion()
        if self.controller is not None:
            self.controller.set_drive_source(None)
            self.controller.send(ControlInput())

    def queue_aux(self, angle: int) -> None:
        if not self._prepare_manual_control():
            return
        self.pending_aux = max(45, min(135, angle))
        self.servo_sequence = None
        self.servo_deadline = time.monotonic() + 2.0
        self._set_servo_feedback("servo_sending")

    def run_simple_setup(self) -> None:
        self._suspend_inputs()
        if not self.last_snapshot.connected:
            self._set_state(
                "status_connect_pad", "#f4c95d", "status_check_controller"
            )
            return
        was_paused = self.paused
        if self.controller is not None and self.controller.armed:
            try:
                self.controller.emergency_stop()
            except RoverAPIError:
                self.controller.armed = False
        self.paused = True
        self.calibrating = True
        dialog = SimpleControllerSetup(self.gamepad, self.mapping, self)
        try:
            if dialog.exec():
                self.mapping = dialog.mapping
                self.last_snapshot = self.gamepad.poll()
                self.last_buttons = list(self.last_snapshot.buttons)
                self.setup_button.hide()
                self._log(self.tr("log_setup_saved"))
        finally:
            self.calibrating = False
        self.paused = was_paused
        if not self.paused:
            self._try_start_control()
        else:
            self._set_state("status_stopped", "#ff6b78", "detail_resume")

    def run_number_setup(self) -> None:
        self._suspend_inputs()
        self.calibrating = True
        dialog = GamepadSetupDialog(self.gamepad, self.mapping, self)
        try:
            if dialog.exec():
                self.mapping = dialog.mapping
                self.last_buttons = list(self.gamepad.poll().buttons)
                self._log(self.tr("log_dev_setup_saved"))
        finally:
            self.calibrating = False

    def open_advanced(self) -> None:
        self._suspend_inputs()
        self.settings_open = True
        dialog = AdvancedDialog(self, self)
        dialog.exec()
        self.settings_open = False
        self.last_buttons = list(self.gamepad.poll().buttons)

    def closeEvent(self, event: QCloseEvent) -> None:
        self.settings.speed_limit = self.selected_speed
        save_rover_settings(self.settings)
        if self.controller is not None:
            self.controller.close(send_stop=True)
        self.gamepad.close()
        self.camera.close()
        event.accept()

    def configure_camera(self, value: str) -> None:
        url = stream_url(value)
        self.camera.configure(url)
        self.settings.camera_url = url
        save_rover_settings(self.settings)


def main() -> int:
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    handler = RotatingFileHandler(log_dir / "control.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    logger = logging.getLogger("rover.ui")
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    application = QApplication(sys.argv)
    application.setStyle("Fusion")
    window = MainWindow()
    window.show()
    return application.exec()


if __name__ == "__main__":
    raise SystemExit(main())
