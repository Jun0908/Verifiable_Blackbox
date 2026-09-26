# StegaVAR CPU service

Provides recovered-frame motion measurement, lazy X-CLIP classification, and offline LF-VSN video embedding/recovery. Public case data is shared with the Web application through `apps/web/public/stegavar`.

## Setup

From the application root, use Python 3.11.9:

```powershell
py -3.11 -m venv services/stegavar/.venv
services/stegavar/.venv/Scripts/python.exe -m pip install --require-hashes --extra-index-url https://download.pytorch.org/whl/cpu -r services/stegavar/requirements.txt
services/stegavar/.venv/Scripts/python.exe services/stegavar/scripts/setup_assets.py
services/stegavar/.venv/Scripts/python.exe services/stegavar/scripts/setup_assets.py --check
services/stegavar/.venv/Scripts/python.exe services/stegavar/scripts/inference_server.py
```

On Linux, use `.venv/bin/python` for the service interpreter. The dependency lock targets Python 3.11 and CPU PyTorch. It includes transitive versions and distribution hashes. Regenerate with `uv pip compile services/stegavar/requirements.in --python-version 3.11 --index-strategy unsafe-best-match --generate-hashes --output-file services/stegavar/requirements.txt`.

The service binds to `127.0.0.1:4176`. `GET /health` reports readiness, available case/scene pairs, model loading and active analysis. `POST /analyze` accepts only `{"case":"rover-moving","scene":"surf"}`-shaped requests using configured IDs. Motion cases run without loading X-CLIP. Models are loaded locally and reused. The browser uses the Next.js adapter; direct browser origins are rejected.

Analysis verifies the lossless stego hash and all recovered RGB frames against the manifest. A concurrent request receives 409. Missing data/model returns 503, input integrity failure 422 and processing failure 500. HTTP disconnection does not cancel CPU processing or release its lock early. Live results are returned to the caller; public assets are not overwritten.

## Configuration

| Variable | Default, relative to application root |
|---|---|
| `STEGAVAR_DATA_ROOT` | `apps/web/public/stegavar` |
| `STEGAVAR_MODEL_ROOT` | `services/stegavar/checkpoints` |
| `STEGAVAR_WORK_ROOT` | `services/stegavar/work` |
| `STEGAVAR_SOURCE_ROOT` | `services/stegavar/work/sources` |
| `STEGAVAR_TORCH_THREADS` | `4` |
| `STEGAVAR_PORT` | `4176` |

Absolute paths are accepted for these filesystem settings. The standalone Python command reads process environment variables. Web and Python must reference the same published manifest and recovered frames. Source recordings, models, downloaded source repositories, Python environments and intermediate build files are ignored by Git.

## Offline video generation

Place the two user-provided recordings listed in `config/cases.json` and the three cover videos in `STEGAVAR_SOURCE_ROOT`. Filenames and source hashes are recorded in `config/cases.json` and `config/cover-provenance.json`. Run each stage sequentially:

```powershell
services/stegavar/.venv/Scripts/python.exe services/stegavar/scripts/video_poc.py prepare --case rover-moving --scene surf
services/stegavar/.venv/Scripts/python.exe services/stegavar/scripts/video_poc.py encode --case rover-moving --scene surf
services/stegavar/.venv/Scripts/python.exe services/stegavar/scripts/video_poc.py reveal --case rover-moving --scene surf
services/stegavar/.venv/Scripts/python.exe services/stegavar/scripts/video_poc.py package --case rover-moving --scene surf
```

Repeat for `rover-still` and covers `hike`/`camp`. Builds go to `work/build/<case>/<scene>`; publication of selected display assets is a separate step. Reveal reconstruction consumes the lossless stego and verified LF-VSN checkpoint. Runtime analysis consumes the recovered PNG frames, not preview movies or source recordings.

Attribution and source details: [SOURCES.md](SOURCES.md).
