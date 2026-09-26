from __future__ import annotations

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QTextCursor
from PySide6.QtWidgets import (
    QDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QSlider,
    QTabWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


class AdvancedDialog(QDialog):
    def __init__(self, owner, parent=None) -> None:
        super().__init__(parent)
        self.owner = owner
        t = owner.tr
        self.setWindowTitle(t("advanced_title"))
        self.resize(720, 560)
        layout = QVBoxLayout(self)
        tabs = QTabWidget()
        layout.addWidget(tabs)

        status_page = QWidget()
        status_layout = QFormLayout(status_page)
        self.connection = QLabel("-")
        self.address = QLabel("-")
        self.wifi = QLabel("-")
        self.i2c = QLabel("-")
        self.motors = QLabel("[0, 0, 0, 0]")
        self.servos = QLabel("-")
        self.packet = QLabel("-")
        status_layout.addRow(t("connection"), self.connection)
        status_layout.addRow(t("ip_address"), self.address)
        status_layout.addRow("Wi-Fi", self.wifi)
        status_layout.addRow("I2C 0x38", self.i2c)
        status_layout.addRow(t("motor_command"), self.motors)
        status_layout.addRow(t("servo"), self.servos)
        status_layout.addRow(t("last_packet"), self.packet)
        tabs.addTab(status_page, t("tab_rover"))

        camera_page = QWidget()
        camera_layout = QFormLayout(camera_page)
        camera_address = QLineEdit(owner.settings.camera_url)
        camera_address.setPlaceholderText("http://rover-camera.local:81/stream")
        camera_result = QLabel()
        camera_apply = QPushButton(t("camera_connect"))
        def apply_camera():
            try:
                owner.configure_camera(camera_address.text())
                camera_result.setText(t("camera_waiting"))
            except ValueError as exc:
                camera_result.setText(str(exc))
        camera_apply.clicked.connect(apply_camera)
        camera_layout.addRow(t("camera_address"), camera_address)
        camera_layout.addRow(camera_apply)
        camera_layout.addRow(camera_result)
        tabs.addTab(camera_page, t("camera_title"))

        controller_page = QWidget()
        controller_layout = QVBoxLayout(controller_page)
        self.controller_name = QLabel(t("not_connected"))
        self.raw = QLabel("-")
        self.raw.setWordWrap(True)
        simple_setup = QPushButton(t("reset_controller"))
        simple_setup.clicked.connect(owner.run_simple_setup)
        number_setup = QPushButton(t("inspect_numbers"))
        number_setup.clicked.connect(owner.run_number_setup)
        controller_layout.addWidget(self.controller_name)
        controller_layout.addWidget(self.raw)
        controller_layout.addWidget(simple_setup)
        controller_layout.addWidget(number_setup)
        controller_layout.addStretch()
        tabs.addTab(controller_page, t("tab_controller"))

        servo_page = QWidget()
        servo_layout = QVBoxLayout(servo_page)
        group = QGroupBox(t("aux_servo"))
        row = QHBoxLayout(group)
        self.aux = QSlider(Qt.Orientation.Horizontal)
        self.aux.setRange(45, 135)
        self.aux.setValue(owner.aux_angle)
        self.aux_value = QLabel(str(owner.aux_angle))
        self.aux.valueChanged.connect(
            lambda value: self.aux_value.setText(f"{value}°")
        )
        apply_aux = QPushButton(t("move"))
        apply_aux.clicked.connect(lambda: owner.queue_aux(self.aux.value()))
        row.addWidget(self.aux, 1)
        row.addWidget(self.aux_value)
        row.addWidget(apply_aux)
        servo_layout.addWidget(group)
        servo_layout.addStretch()
        tabs.addTab(servo_page, t("tab_extension"))

        log_page = QWidget()
        log_layout = QVBoxLayout(log_page)
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        log_layout.addWidget(self.log)
        tabs.addTab(log_page, t("tab_log"))

        close_button = QPushButton(t("close"))
        close_button.clicked.connect(self.accept)
        layout.addWidget(close_button)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.timer.start(200)
        self.refresh()

    def refresh(self) -> None:
        owner = self.owner
        controller = owner.controller
        telemetry = controller.last_telemetry if controller is not None else None
        self.connection.setText(owner.simple_state)
        self.address.setText(owner.current_url or "-")
        if telemetry is not None:
            self.wifi.setText(f"RSSI {telemetry.rssi} dBm")
            self.i2c.setText("OK" if telemetry.i2c_ok else "ERROR")
            self.motors.setText(str(list(telemetry.motors)))
            self.servos.setText(
                f"gripper={telemetry.gripper_angle}°, aux={telemetry.aux_servo_angle}°"
            )
            self.packet.setText(f"{telemetry.packet_age_ms} ms")
        snapshot = owner.last_snapshot
        if snapshot.connected:
            self.controller_name.setText(snapshot.name)
            axes = "  ".join(
                f"A{index}:{value:+.2f}"
                for index, value in enumerate(snapshot.axes)
            )
            buttons = [str(i) for i, value in enumerate(snapshot.buttons) if value]
            self.raw.setText(
                f"{owner.tr('axes')}: {axes or '-'}\n"
                f"{owner.tr('pressed_buttons')}: {', '.join(buttons) or '-'}"
            )
        else:
            self.controller_name.setText(owner.tr("not_connected"))
            self.raw.setText("-")
        self.log.setPlainText("\n".join(owner.log_messages[-200:]))
        self.log.moveCursor(QTextCursor.MoveOperation.End)
