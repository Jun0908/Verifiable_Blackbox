"""Filesystem configuration shared by the service and offline builders."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = ROOT.parents[1]


def configured_path(name, default):
    value = Path(os.environ.get(name, default))
    return (APP_ROOT / value).resolve() if not value.is_absolute() else value.resolve()


DATA_ROOT = configured_path('STEGAVAR_DATA_ROOT', 'apps/web/public/stegavar')
WORK_ROOT = configured_path('STEGAVAR_WORK_ROOT', 'services/stegavar/work')
MODEL_ROOT = configured_path('STEGAVAR_MODEL_ROOT', 'services/stegavar/checkpoints')
SOURCE_ROOT = configured_path('STEGAVAR_SOURCE_ROOT', 'services/stegavar/work/sources')
TORCH_THREADS = int(os.environ.get('STEGAVAR_TORCH_THREADS', '4'))
if not 1 <= TORCH_THREADS <= 32:
    raise ValueError('STEGAVAR_TORCH_THREADS must be between 1 and 32')


def within(root, *parts):
    candidate = root.joinpath(*parts).resolve()
    if not candidate.is_relative_to(root.resolve()):
        raise ValueError('Path is outside the configured directory')
    return candidate
