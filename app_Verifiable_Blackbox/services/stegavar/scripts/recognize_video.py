"""Zero-shot video baseline, explicitly AFTER LF-VSN reconstruction.

Compares a fixed set of candidate descriptions with eight ordered recovered
video frames using X-CLIP. Scores are relative softmax scores, not calibrated confidence.
No original secret images or user-supplied ground-truth labels are read.
"""
from __future__ import annotations

import hashlib
import argparse
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image
import torch
from transformers import XCLIPModel, XCLIPProcessor

from settings import ROOT, DATA_ROOT, MODEL_ROOT, TORCH_THREADS
DATA = DATA_ROOT / "rover-moving/surf"
MODEL = "microsoft/xclip-base-patch32"
REVISION = "a2e27a78a2b5d802e894b8a1ef14f3a8ce490963"
# Fixed before evaluating the sample. All robot alternatives use the same
# subject and comparable wording; the ocean/traffic labels are controls.
CANDIDATES = [
    ("HANDOFF_OBJECT", "ロボット間で物を受け渡す", "A video of two robot arms passing an object from one gripper to the other."),
    ("GRASP_OBJECT", "物を掴み上げる", "A video of two robot arms picking up an object from a table."),
    ("PLACE_OBJECT", "物を置く", "A video of two robot arms putting an object down on a table."),
    ("MOVE_EMPTY", "アームを動かす", "A video of two robot arms moving their empty grippers without holding an object."),
    ("IDLE", "停止している", "A video of two robot arms staying still without moving."),
    ("OCEAN", "海の波", "A video of ocean waves washing onto a sandy beach."),
    ("TRAFFIC", "車の往来", "A video of cars driving along a road."),
    ("SURFING", "サーフィンを楽しむ", "A video of a person surfing and riding an ocean wave."),
    ("HIKING", "山を登る", "A video of a person hiking up a mountain with a backpack."),
    ("CAMPING", "焚き火でマシュマロを焼く", "A video of a person roasting marshmallows over a campfire."),
]


def load_sample(folder, indices, data_path=DATA):
    return [np.asarray(Image.open(data_path / folder / f"{index:04d}.png").convert("RGB")) for index in indices]


class VideoRecognizer:
    def __init__(self, local_files_only=False):
        from setup_assets import LOCK, verify
        for name, digest in LOCK['xclip']['files'].items():
            verify(MODEL_ROOT / 'xclip' / name, digest)
        torch.set_num_threads(TORCH_THREADS)
        print(f"Loading {MODEL} at {REVISION}; CPU, 8 frames", flush=True)
        self.processor = XCLIPProcessor.from_pretrained(str(MODEL_ROOT / "xclip"), local_files_only=local_files_only)
        self.model = XCLIPModel.from_pretrained(str(MODEL_ROOT / "xclip"), use_safetensors=True, local_files_only=local_files_only).eval()
        print("Public weights loaded", flush=True)

    def predict(self, frames, candidates=None):
        start = time.perf_counter()
        candidates = candidates if candidates is not None else CANDIDATES
        inputs = self.processor.tokenizer([row[2] for row in candidates], return_tensors="pt", padding=True)
        inputs.update(self.processor.image_processor([frames], return_tensors="pt"))
        with torch.inference_mode():
            logits = self.model(**inputs).logits_per_video[0]
        scores = logits.softmax(dim=-1).tolist()
        ranking = sorted([{"label": row[0], "description_ja": row[1], "prompt": row[2], "score": score, "logit": logit}
                          for row, score, logit in zip(candidates, scores, logits.tolist())], key=lambda x: x["score"], reverse=True)
        return {"ranking": ranking, "inference_seconds": time.perf_counter() - start}

def main(data_path=None, recognizer=None, controls=True, save=True):
    data = Path(data_path) if data_path else DATA
    meta = json.loads((data / "manifest.json").read_text(encoding="utf-8"))
    stego_hash = hashlib.sha256((data / "stego-lossless.mkv").read_bytes()).hexdigest()
    if stego_hash != meta["stego_sha256"]:
        raise ValueError("Stego does not match the manifest")
    indices = np.linspace(0, meta["frames"] - 1, 8).round().astype(int).tolist()
    all_frames = load_sample("recovered", range(meta["frames"]), data)
    digest = hashlib.sha256(b"".join(frame.tobytes() for frame in all_frames)).hexdigest()
    if digest != meta["recovered_frames_sha256"]:
        raise ValueError("Recovered frames do not match manifest")
    recovered = [all_frames[index] for index in indices]
    engine = recognizer or VideoRecognizer()
    profile = meta.get('recognition_profile', 'robot_actions_v1')
    if profile not in ['robot_actions_v1', 'handover_v1']:
        raise ValueError('Unknown recognition profile')
    candidates = json.loads((ROOT / 'config/handover_candidates.json').read_text(encoding='utf-8')) if profile == 'handover_v1' else CANDIDATES
    results = {}
    samples = [("recovered", recovered)]
    if controls:
        samples += [("stego_visible_control", load_sample("stego", indices, data)), ("frozen_recovered_control", [recovered[0]] * 8)]
    for name, sample in samples:
        results[name] = engine.predict(sample, candidates)
        print(f"{name}: {results[name]['ranking'][0]['label']} ({results[name]['inference_seconds']:.2f}s)", flush=True)
    output = {
        "model": MODEL, "model_revision": REVISION, "device": "cpu",
        'case': meta.get('case', 'handoff'), 'recognition_profile': profile,
        "mode": "reconstructed_video_zero_shot", "direct_stego_recognition": False,
        "score_kind": "relative_candidate_softmax_not_calibrated_probability",
        "sampled_frame_indices": indices,
        "stego_sha256": stego_hash,
        "recovered_frames_sha256": digest,
        "original_secret_used": False, "results": results,
    }
    if save:
        (data / "recognition.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Saved {data / 'recognition.json'}", flush=True)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path)
    main(parser.parse_args().data)
