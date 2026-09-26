from __future__ import annotations

from dataclasses import replace

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QLabel,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
)

from .config import ControllerMapping, save_controller_mapping
from .gamepad import GamepadManager


class SimpleControllerSetup(QDialog):
    """Guided controller setup that never exposes axis/button numbers."""

    STEPS = (
        ("axis", "y", "setup_forward"),
        ("axis", "x", "setup_right"),
        ("axis", "z", "setup_turn"),
        ("button", "open", "setup_open"),
        ("button", "close", "setup_close"),
        ("button", "stop", "setup_stop"),
    )

    def __init__(
        self,
        manager: GamepadManager,
        current: ControllerMapping,
        parent=None,
    ) -> None:
        super().__init__(parent)
        self.t = parent.tr if parent is not None and hasattr(parent, "tr") else lambda key: key
        self.setWindowTitle(self.t("simple_setup_title"))
        self.setModal(True)
        self.setMinimumSize(600, 340)
        self.manager = manager
        self.mapping = replace(current)
        self.mapping.deadzone = max(0.20, self.mapping.deadzone)
        self.mapping.expo = 0.20
        self.mapping.smoothing = 0.15
        self.step_index = 0
        self.baseline_axes: list[float] = []
        self.waiting_for_center = False
        self.waiting_for_release = False
        self.last_buttons: list[bool] = []

        layout = QVBoxLayout(self)
        self.device = QLabel(self.t("simple_device_check"))
        self.device.setStyleSheet("font-size: 16px; color: #aab4c0;")
        layout.addWidget(self.device)
        self.prompt = QLabel()
        self.prompt.setWordWrap(True)
        self.prompt.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.prompt.setStyleSheet(
            "font-size: 28px; font-weight: bold; padding: 30px;"
            "background: #26313d; border-radius: 12px;"
        )
        layout.addWidget(self.prompt, 1)
        self.progress = QProgressBar()
        self.progress.setRange(0, len(self.STEPS))
        layout.addWidget(self.progress)
        hint = QLabel(self.t("setup_hint"))
        hint.setStyleSheet("font-size: 15px;")
        layout.addWidget(hint)
        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton(self.t("setup_later"))
        cancel.clicked.connect(self.reject)
        buttons.addWidget(cancel)
        layout.addLayout(buttons)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self._poll)
        self.timer.start(40)
        self._show_step()

    def _show_step(self) -> None:
        if self.step_index >= len(self.STEPS):
            self.mapping.simple_setup_version = 1
            save_controller_mapping(self.mapping)
            self.prompt.setText(self.t("setup_done"))
            self.progress.setValue(len(self.STEPS))
            QTimer.singleShot(700, self.accept)
            return
        _, _, message_key = self.STEPS[self.step_index]
        self.prompt.setText(self.t(message_key))
        self.progress.setValue(self.step_index)
        snapshot = self.manager.poll()
        self.baseline_axes = list(snapshot.axes)
        self.last_buttons = list(snapshot.buttons)

    def _assign_axis(self, name: str, axis: int, delta: float) -> None:
        inverted = delta < 0
        if name == "x":
            self.mapping.axis_x = axis
            self.mapping.invert_x = inverted
        elif name == "y":
            self.mapping.axis_y = axis
            self.mapping.invert_y = inverted
        else:
            self.mapping.axis_z = axis
            self.mapping.invert_z = inverted

    def _assign_button(self, name: str, button: int) -> None:
        if name == "open":
            self.mapping.gripper_open_button = button
        elif name == "close":
            self.mapping.gripper_close_button = button
        else:
            self.mapping.emergency_button = button

    def _advance(self, wait_for_center: bool = False, wait_for_release: bool = False) -> None:
        self.step_index += 1
        self.waiting_for_center = wait_for_center
        self.waiting_for_release = wait_for_release
        self.prompt.setText(self.t("setup_center" if wait_for_center else "setup_release"))

    def _poll(self) -> None:
        snapshot = self.manager.poll()
        if not snapshot.connected:
            self.device.setText(self.t("connect_usb_pad"))
            return
        self.device.setText(snapshot.name)
        self.mapping.guid = snapshot.guid
        self.mapping.name = snapshot.name

        if self.waiting_for_center:
            if all(
                abs(value - (self.baseline_axes[index] if index < len(self.baseline_axes) else 0.0)) < 0.25
                for index, value in enumerate(snapshot.axes)
            ):
                self.waiting_for_center = False
                self._show_step()
            return
        if self.waiting_for_release:
            if not any(snapshot.buttons):
                self.waiting_for_release = False
                self._show_step()
            return
        if self.step_index >= len(self.STEPS):
            return

        kind, name, _ = self.STEPS[self.step_index]
        if kind == "axis":
            deltas = [
                value - (self.baseline_axes[index] if index < len(self.baseline_axes) else 0.0)
                for index, value in enumerate(snapshot.axes)
            ]
            if not deltas:
                return
            axis = max(range(len(deltas)), key=lambda index: abs(deltas[index]))
            if abs(deltas[axis]) >= 0.55:
                self._assign_axis(name, axis, deltas[axis])
                self._advance(wait_for_center=True)
        else:
            for index, pressed in enumerate(snapshot.buttons):
                was_pressed = index < len(self.last_buttons) and self.last_buttons[index]
                if pressed and not was_pressed:
                    self._assign_button(name, index)
                    self._advance(wait_for_release=True)
                    break
            self.last_buttons = list(snapshot.buttons)
