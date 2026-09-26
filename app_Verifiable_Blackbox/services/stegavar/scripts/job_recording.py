"""CPU motion analysis of the Raw JPEG sequence uploaded for one Rover session."""
import base64
import hashlib
import io
import json
import re
from datetime import datetime, timezone
import uuid

import numpy as np
from PIL import Image, ImageOps

from analyze_rover import measure


def analyze(request):
    required = {"version", "source", "chainId", "core", "jobId", "sessionId", "recordingSha256", "policyHash", "policy", "rawBase64"}
    if not isinstance(request, dict) or set(request) != required or request["version"] != 1 or request["source"] != "job-recording":
        raise ValueError("invalid_request")
    if (type(request["chainId"]) is not int or request["chainId"] <= 0
            or not re.fullmatch(r"0x[0-9a-fA-F]{40}", str(request["core"]))
            or not re.fullmatch(r"[1-9][0-9]{0,77}", str(request["jobId"]))
            or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", str(request["sessionId"]))
            or not re.fullmatch(r"[0-9a-f]{64}", str(request["recordingSha256"]))
            or not re.fullmatch(r"0x[0-9a-f]{64}", str(request["policyHash"]))):
        raise ValueError("invalid_identity")
    raw = base64.b64decode(request["rawBase64"], validate=True)
    if not raw or len(raw) > 64 * 1024 * 1024 or hashlib.sha256(raw).hexdigest() != request["recordingSha256"]:
        raise ValueError("recording_integrity_failed")
    result = {key: request[key] for key in ("version", "source", "chainId", "core", "jobId", "sessionId", "recordingSha256", "policyHash")}
    result.update(execution="ANALYZED", judgment="INCONCLUSIVE", reason=None,
                  executionId=str(uuid.uuid4()), analyzedAt=datetime.now(timezone.utc).isoformat())
    try:
        frames, cursor = [], 0
        while cursor < len(raw):
            if raw[cursor:cursor+2] != b"\xff\xd8" or len(frames) >= 200:
                raise ValueError("invalid_frames")
            end = raw.find(b"\xff\xd9", cursor+2)
            if end == -1:
                raise ValueError("invalid_frames")
            with Image.open(io.BytesIO(raw[cursor:end+2])) as picture:
                if picture.width * picture.height > 2_000_000:
                    raise ValueError("frame_too_large")
                frames.append(np.asarray(ImageOps.pad(picture.convert("RGB"), (384, 216))))
            cursor = end + 2
        measured = measure(frames, request["policy"])
        result["judgment"] = {"ROVER_MOVING": "MOVING", "ROVER_STILL": "STILL", "ROVER_UNCERTAIN": "INCONCLUSIVE"}[measured["label"]]
        if result["judgment"] == "INCONCLUSIVE":
            result["reason"] = "MOTION_UNCERTAIN"
        result["frameCount"] = len(frames)
    except Exception:
        result["reason"] = "FRAMES_UNREADABLE_OR_INSUFFICIENT"
    return result
