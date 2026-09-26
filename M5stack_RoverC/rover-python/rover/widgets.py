from __future__ import annotations

from PySide6.QtCore import QPointF, Qt, Signal
from PySide6.QtGui import QColor, QMouseEvent, QPainter, QPen
from PySide6.QtWidgets import QWidget


class VirtualJoystick(QWidget):
    changed = Signal(float, float, bool)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setMinimumSize(190, 190)
        self._x = 0.0
        self._y = 0.0
        self._active = False

    def _update_from_position(self, position: QPointF) -> None:
        center = QPointF(self.width() / 2, self.height() / 2)
        radius = max(1.0, min(self.width(), self.height()) / 2 - 18)
        dx = (position.x() - center.x()) / radius
        dy = (position.y() - center.y()) / radius
        length = (dx * dx + dy * dy) ** 0.5
        if length > 1.0:
            dx /= length
            dy /= length
        self._x = dx
        self._y = -dy
        self.changed.emit(self._x, self._y, self._active)
        self.update()

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._active = True
            self._update_from_position(event.position())

    def mouseMoveEvent(self, event: QMouseEvent) -> None:
        if self._active:
            self._update_from_position(event.position())

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._active = False
            self._x = self._y = 0.0
            self.changed.emit(0.0, 0.0, False)
            self.update()

    def paintEvent(self, event) -> None:
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        center = QPointF(self.width() / 2, self.height() / 2)
        radius = min(self.width(), self.height()) / 2 - 18
        painter.setPen(QPen(QColor("#5f6b7a"), 2))
        painter.setBrush(QColor("#202833"))
        painter.drawEllipse(center, radius, radius)
        painter.setPen(QPen(QColor("#44515f"), 1))
        painter.drawLine(
            QPointF(center.x() - radius, center.y()),
            QPointF(center.x() + radius, center.y()),
        )
        painter.drawLine(
            QPointF(center.x(), center.y() - radius),
            QPointF(center.x(), center.y() + radius),
        )
        knob = QPointF(
            center.x() + self._x * radius,
            center.y() - self._y * radius,
        )
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QColor("#ff9500") if self._active else QColor("#8290a0"))
        painter.drawEllipse(knob, 17, 17)
