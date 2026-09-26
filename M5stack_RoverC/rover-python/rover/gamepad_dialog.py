from __future__ import annotations

from dataclasses import replace

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFormLayout,
    QLabel,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from .config import ControllerMapping, save_controller_mapping
from .gamepad import GamepadManager


class GamepadSetupDialog(QDialog):
    def __init__(
        self,
        manager: GamepadManager,
        mapping: ControllerMapping,
        parent=None,
    ) -> None:
        super().__init__(parent)
        self.t = parent.tr if parent is not None and hasattr(parent, "tr") else lambda key, **values: key
        self.setWindowTitle(self.t("gamepad_setup_title"))
        self.resize(560, 560)
        self.manager = manager
        self.mapping = replace(mapping)
        layout = QVBoxLayout(self)
        tabs = QTabWidget()
        layout.addWidget(tabs)

        raw_page = QWidget()
        raw_layout = QVBoxLayout(raw_page)
        self.device_combo = QComboBox()
        self.device_combo.currentIndexChanged.connect(self.manager.select)
        self.device_label = QLabel(self.t("not_connected"))
        self.raw_label = QLabel(self.t("move_axes_buttons"))
        self.raw_label.setWordWrap(True)
        raw_layout.addWidget(self.device_combo)
        raw_layout.addWidget(self.device_label)
        raw_layout.addWidget(self.raw_label)
        raw_layout.addStretch()
        tabs.addTab(raw_page, self.t("input_diagnostics"))

        map_page = QWidget()
        form = QFormLayout(map_page)
        self.axis_x = self._index_combo(16, mapping.axis_x)
        self.axis_y = self._index_combo(16, mapping.axis_y)
        self.axis_z = self._index_combo(16, mapping.axis_z)
        self.invert_x = QCheckBox(self.t("invert"))
        self.invert_y = QCheckBox(self.t("invert"))
        self.invert_z = QCheckBox(self.t("invert"))
        self.invert_x.setChecked(mapping.invert_x)
        self.invert_y.setChecked(mapping.invert_y)
        self.invert_z.setChecked(mapping.invert_z)
        form.addRow(self.t("axis_side"), self.axis_x)
        form.addRow(self.t("axis_direction", axis="X"), self.invert_x)
        form.addRow(self.t("axis_forward"), self.axis_y)
        form.addRow(self.t("axis_direction", axis="Y"), self.invert_y)
        form.addRow(self.t("axis_turn"), self.axis_z)
        form.addRow(self.t("axis_direction", axis="Z"), self.invert_z)

        self.deadman = self._index_combo(32, mapping.deadman_button)
        self.open_button = self._index_combo(32, mapping.gripper_open_button)
        self.close_button = self._index_combo(32, mapping.gripper_close_button)
        self.aux_dec = self._index_combo(32, mapping.aux_decrease_button)
        self.aux_inc = self._index_combo(32, mapping.aux_increase_button)
        self.precision = self._index_combo(32, mapping.precision_button)
        self.emergency = self._index_combo(32, mapping.emergency_button)
        form.addRow(self.t("deadman"), self.deadman)
        form.addRow(self.t("gripper_open_map"), self.open_button)
        form.addRow(self.t("gripper_close_map"), self.close_button)
        form.addRow(self.t("aux_decrease"), self.aux_dec)
        form.addRow(self.t("aux_increase"), self.aux_inc)
        form.addRow(self.t("precision"), self.precision)
        form.addRow(self.t("emergency"), self.emergency)
        self.deadzone = QDoubleSpinBox()
        self.deadzone.setRange(0.0, 0.8)
        self.deadzone.setSingleStep(0.01)
        self.deadzone.setValue(mapping.deadzone)
        self.expo = QDoubleSpinBox()
        self.expo.setRange(0.0, 1.0)
        self.expo.setSingleStep(0.05)
        self.expo.setValue(mapping.expo)
        self.smoothing = QDoubleSpinBox()
        self.smoothing.setRange(0.0, 0.95)
        self.smoothing.setSingleStep(0.05)
        self.smoothing.setValue(mapping.smoothing)
        form.addRow(self.t("deadzone"), self.deadzone)
        form.addRow("Expo", self.expo)
        form.addRow(self.t("smoothing"), self.smoothing)
        tabs.addTab(map_page, self.t("mapping"))

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Save
            | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        buttons.button(QDialogButtonBox.StandardButton.Save).setText(self.t("save"))
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText(self.t("cancel"))
        layout.addWidget(buttons)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._update_raw)
        self.timer.start(60)

    @staticmethod
    def _index_combo(count: int, current: int) -> QComboBox:
        combo = QComboBox()
        for index in range(count):
            combo.addItem(str(index), index)
        combo.setCurrentIndex(max(0, min(count - 1, current)))
        return combo

    def _update_raw(self) -> None:
        names = self.manager.refresh()
        if [self.device_combo.itemText(i) for i in range(self.device_combo.count())] != names:
            self.device_combo.blockSignals(True)
            self.device_combo.clear()
            self.device_combo.addItems(names)
            self.device_combo.blockSignals(False)
        snapshot = self.manager.poll()
        if not snapshot.connected:
            self.device_label.setText(self.t("gamepad_missing"))
            self.raw_label.setText(self.t("connect_usb_pad"))
            return
        self.device_label.setText(f"{snapshot.name}\nGUID: {snapshot.guid}")
        axes = "  ".join(f"A{i}={v:+.3f}" for i, v in enumerate(snapshot.axes))
        pressed = [str(i) for i, value in enumerate(snapshot.buttons) if value]
        hats = "  ".join(f"H{i}={value}" for i, value in enumerate(snapshot.hats))
        self.raw_label.setText(
            f"{self.t('axes')}:\n{axes or '-'}\n\n"
            f"{self.t('pressed')}: {', '.join(pressed) or '-'}"
            f"\n\n{self.t('dpad')}: {hats or '-'}"
        )

    def _save(self) -> None:
        snapshot = self.manager.poll()
        self.mapping = ControllerMapping(
            guid=snapshot.guid,
            name=snapshot.name,
            axis_x=self.axis_x.currentData(),
            axis_y=self.axis_y.currentData(),
            axis_z=self.axis_z.currentData(),
            invert_x=self.invert_x.isChecked(),
            invert_y=self.invert_y.isChecked(),
            invert_z=self.invert_z.isChecked(),
            deadman_button=self.deadman.currentData(),
            gripper_open_button=self.open_button.currentData(),
            gripper_close_button=self.close_button.currentData(),
            aux_decrease_button=self.aux_dec.currentData(),
            aux_increase_button=self.aux_inc.currentData(),
            precision_button=self.precision.currentData(),
            emergency_button=self.emergency.currentData(),
            deadzone=self.deadzone.value(),
            expo=self.expo.value(),
            smoothing=self.smoothing.value(),
        )
        save_controller_mapping(self.mapping)
        self.accept()
