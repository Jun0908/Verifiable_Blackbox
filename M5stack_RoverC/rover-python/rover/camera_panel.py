import time

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QLabel, QSizePolicy, QVBoxLayout, QWidget

from .camera import CameraStream


class CameraPanel(QWidget):
    def __init__(self, stream: CameraStream, translate, parent=None):
        super().__init__(parent)
        self.stream = stream
        self.translate = translate
        self.last_received = 0.0
        self.pixmap = QPixmap()
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)
        self.video = QLabel()
        self.video.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.video.setMinimumSize(160, 160)
        self.video.setSizePolicy(QSizePolicy.Policy.Ignored, QSizePolicy.Policy.Expanding)
        self.video.setStyleSheet("background: #05080c; color: #8093a6; border-radius: 10px;")
        self.status = QLabel()
        self.status.setObjectName("sectionHint")
        layout.addWidget(self.video, 1)
        layout.addWidget(self.status)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.timer.start(100)
        self.refresh()

    def refresh(self):
        data, received, error, url = self.stream.snapshot()
        if not url or not data or time.monotonic() - received > 2.0:
            key = "camera_unconfigured" if not url else "camera_waiting"
            self.video.clear()
            self.video.setText(self.translate(key))
            self.status.setText(self.translate("camera_title"))
            self.status.setToolTip(error)
            return
        if received != self.last_received:
            candidate = QPixmap()
            if candidate.loadFromData(data, "JPEG"):
                self.pixmap = candidate
                self.last_received = received
            else:
                self.video.clear()
                self.video.setText(self.translate("camera_waiting"))
                self.status.setText(self.translate("camera_title"))
                return
        if not self.pixmap.isNull():
            self.video.setPixmap(self.pixmap.scaled(
                self.video.size(), Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation))
        self.status.setText(self.translate("camera_live"))
        self.status.setToolTip(url)
