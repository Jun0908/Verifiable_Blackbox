from __future__ import annotations

import os
import threading
import time
from dataclasses import replace

os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
os.environ.setdefault("SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS", "1")

import pygame

from .config import ControllerMapping
from .mixer import shape_axis
from .models import ControlInput, GamepadSnapshot


def _item(values: list, index: int, default=0):
    return values[index] if 0 <= index < len(values) else default


class _GamepadReader:
    def __init__(self) -> None:
        pygame.display.init()
        pygame.joystick.init()
        self._joystick: pygame.joystick.JoystickType | None = None
        self._selected_index = 0
        self._last_count = -1
        self._filtered_axes = [0.0, 0.0, 0.0]
        self.refresh()

    def refresh(self) -> list[str]:
        pygame.event.pump()
        count = pygame.joystick.get_count()
        names: list[str] = []
        for index in range(count):
            joystick = pygame.joystick.Joystick(index)
            names.append(joystick.get_name())
        if count != self._last_count or self._joystick is None:
            self._last_count = count
            self.select(min(self._selected_index, max(0, count - 1)))
        return names

    def select(self, index: int) -> None:
        if self._joystick is not None:
            self._joystick.quit()
        self._joystick = None
        count = pygame.joystick.get_count()
        if not 0 <= index < count:
            return
        self._selected_index = index
        joystick = pygame.joystick.Joystick(index)
        joystick.init()
        self._joystick = joystick

    def poll(self) -> GamepadSnapshot:
        pygame.event.pump()
        self.refresh()
        joystick = self._joystick
        if joystick is None or not joystick.get_init():
            return GamepadSnapshot()
        try:
            return GamepadSnapshot(
                connected=True,
                name=joystick.get_name(),
                guid=joystick.get_guid(),
                axes=[joystick.get_axis(i) for i in range(joystick.get_numaxes())],
                buttons=[
                    bool(joystick.get_button(i))
                    for i in range(joystick.get_numbuttons())
                ],
                hats=[joystick.get_hat(i) for i in range(joystick.get_numhats())],
            )
        except pygame.error:
            self._joystick = None
            return GamepadSnapshot()

    def control_input(
        self,
        snapshot: GamepadSnapshot,
        mapping: ControllerMapping,
        normal_speed: int,
        precision_speed: int,
    ) -> ControlInput:
        if not snapshot.connected:
            return ControlInput()
        raw_x = float(_item(snapshot.axes, mapping.axis_x, 0.0))
        raw_y = float(_item(snapshot.axes, mapping.axis_y, 0.0))
        raw_z = float(_item(snapshot.axes, mapping.axis_z, 0.0))
        if mapping.invert_x:
            raw_x = -raw_x
        if mapping.invert_y:
            raw_y = -raw_y
        if mapping.invert_z:
            raw_z = -raw_z
        smoothing = max(0.0, min(0.95, mapping.smoothing))
        shaped = [
            shape_axis(raw_x, mapping.deadzone, mapping.expo),
            shape_axis(raw_y, mapping.deadzone, mapping.expo),
            shape_axis(raw_z, mapping.deadzone, mapping.expo),
        ]
        for index, value in enumerate(shaped):
            self._filtered_axes[index] = (
                smoothing * self._filtered_axes[index] + (1.0 - smoothing) * value
            )
        precision = bool(
            _item(snapshot.buttons, mapping.precision_button, False)
        )
        return ControlInput(
            x=self._filtered_axes[0],
            y=self._filtered_axes[1],
            z=self._filtered_axes[2],
            deadman=bool(_item(snapshot.buttons, mapping.deadman_button, False)),
            speed_limit=precision_speed if precision else normal_speed,
            emergency_stop=bool(
                _item(snapshot.buttons, mapping.emergency_button, False)
            ),
        )

    def close(self) -> None:
        if self._joystick is not None:
            self._joystick.quit()
        pygame.joystick.quit()
        pygame.quit()


class GamepadManager:
    """Sample SDL on its initialization thread, independently of Qt rendering."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._filter_lock = threading.Lock()
        self._filtered_axes = [0.0, 0.0, 0.0]
        self._snapshot = GamepadSnapshot()
        self._sampled_at = 0.0
        self._names: list[str] = []
        self._selection: int | None = None
        self.error = ""
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, name="rover-gamepad", daemon=True)
        self._thread.start()
        self._ready.wait(1.0)

    def _run(self) -> None:
        reader = None
        try:
            reader = _GamepadReader()
            while not self._stop.is_set():
                with self._lock:
                    selection, self._selection = self._selection, None
                if selection is not None:
                    reader.select(selection)
                names = reader.refresh()
                snapshot = reader.poll()
                # Drain SDL events rather than letting its event queue fill up.
                pygame.event.clear()
                with self._lock:
                    self._snapshot = snapshot
                    self._sampled_at = time.monotonic()
                    self._names = names
                self._ready.set()
                self._stop.wait(0.02)
        except Exception as exc:
            self.error = str(exc)
        finally:
            if reader is not None:
                reader.close()
            self._ready.set()

    def poll(self) -> GamepadSnapshot:
        with self._lock:
            if time.monotonic() - self._sampled_at > 0.25:
                return GamepadSnapshot()
            state = self._snapshot
            return replace(state, axes=list(state.axes), buttons=list(state.buttons), hats=list(state.hats))

    def refresh(self) -> list[str]:
        with self._lock:
            return list(self._names)

    def select(self, index: int) -> None:
        with self._lock:
            self._selection = index

    def control_input(self, snapshot, mapping, normal_speed, precision_speed) -> ControlInput:
        with self._filter_lock:
            return _GamepadReader.control_input(self, snapshot, mapping, normal_speed, precision_speed)

    def live_drive(self, mapping: ControllerMapping, speed: int) -> ControlInput:
        command = self.control_input(self.poll(), mapping, speed, speed)
        command.deadman = max(abs(command.x), abs(command.y), abs(command.z)) >= 0.015
        return command

    def close(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2.0)
