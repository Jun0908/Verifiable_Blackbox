"""Run official StegaVAR hiding + LF-VSN recovery on a tiny video sample.

Stages run as separate processes. In particular, `reveal` reads ONLY the
lossless stego movie and the public checkpoint, never the original secret.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import time

sys.dont_write_bytecode = True

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageOps

from settings import ROOT, SOURCE_ROOT, WORK_ROOT, MODEL_ROOT, TORCH_THREADS

SAMPLES = SOURCE_ROOT
OUTPUT = WORK_ROOT / "build"
WIDTH, HEIGHT, FPS = 256, 144, 10
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
CHECKPOINT = MODEL_ROOT / "LF-VSN_1video.pth"
SCENE = None
CASE = 'rover-moving'
SCENES = json.loads((ROOT / "config/scenes.json").read_text(encoding="utf-8"))
CASES = json.loads((ROOT / "config/cases.json").read_text(encoding="utf-8"))


def command(*args):
    return subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *map(str, args)], check=True, capture_output=True)


def write_json(name, value):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def read_frames(folder):
    return np.stack([np.asarray(Image.open(p).convert("RGB")) for p in sorted(folder.glob("*.png"))])


def save_frames(frames, folder):
    folder.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        Image.fromarray(frame).save(folder / f"{index:04d}.png")


def decode_movie(path):
    # Dimensions are a fixed, public property of this small sample, not a secret.
    result = command("-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1")
    return np.frombuffer(result.stdout, dtype=np.uint8).reshape(-1, HEIGHT, WIDTH, 3).copy()


def psnr(reference, actual):
    error = np.mean((reference.astype(np.float64) - actual.astype(np.float64)) ** 2)
    return float(10 * np.log10(255 ** 2 / max(error, 1e-12)))


def load_network():
    import torch
    import yaml

    torch.set_num_threads(TORCH_THREADS)
    torch.set_grad_enabled(False)
    sys.path.insert(0, str(ROOT / "third_party/LF-VSN/code"))
    from models.networks import define_G_v2
    from models.modules.common import DWT, IWT

    opt = yaml.safe_load((ROOT / "third_party/LF-VSN/code/options/train/train_LF-VSN_1video.yml").read_text())
    expected = "97dbc2d7115fb8ab7c8a219fca60c34f1bac39d1921291d1efbc98cf1d31d504"
    if hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest() != expected:
        raise ValueError("Checkpoint hash mismatch")
    weights = torch.load(CHECKPOINT, map_location="cpu", weights_only=True)
    blocks = sorted({int(key.split(".")[2]) for key in weights if key.startswith("irn.operations.")})
    if blocks != list(range(len(blocks))):
        raise ValueError("Checkpoint has non-contiguous invertible blocks")
    # Public YAML scale=2 instantiates just its first block_num entry (8).
    # The official one-video checkpoint contains 16 blocks. Use every weight.
    opt["network_G"]["block_num"] = [len(blocks)]
    net = define_G_v2(opt).eval()
    net.load_state_dict(weights, strict=True)
    print(f"Official LF-VSN: {len(blocks)} blocks, {sum(p.numel() for p in net.parameters()):,} parameters; strict load OK", flush=True)
    return net, DWT(), IWT()


def prepare():
    case = CASES[CASE]
    source = SAMPLES / case['file']
    if hashlib.sha256(source.read_bytes()).hexdigest() != case['source_sha256']:
        raise ValueError('Source recording hash mismatch')
    (OUTPUT / 'secret-original').mkdir(parents=True, exist_ok=True)
    command('-ss', case['start'], '-i', source,
            '-vf', f'fps={FPS},scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2',
            '-frames:v', case['frames'], '-start_number', 0, OUTPUT / 'secret-original/%04d.png')
    frames = read_frames(OUTPUT / 'secret-original')
    if len(frames) != case['frames']:
        raise ValueError('Wrong secret frame count')
    (OUTPUT / "cover").mkdir(parents=True, exist_ok=True)
    settings = SCENES[SCENE]
    provenance = json.loads((ROOT / 'config/cover-provenance.json').read_text(encoding='utf-8'))
    expected_cover = next(row['sha256'] for row in provenance if row['scene'] == SCENE)
    if hashlib.sha256((SAMPLES / settings['file']).read_bytes()).hexdigest() != expected_cover:
        raise ValueError('Cover source hash mismatch')
    command("-ss", settings["start"], "-i", SAMPLES / settings["file"],
            "-vf", f"fps={FPS},scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT}",
            "-frames:v", len(frames), "-start_number", 0, OUTPUT / "cover/%04d.png")
    command("-framerate", FPS, "-i", OUTPUT / "secret-original/%04d.png", "-c:v", "libx264", "-crf", 18, "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUTPUT / 'secret-reference-preview.mp4')
    if len(read_frames(OUTPUT / "cover")) != len(frames):
        raise ValueError("Sample cover does not contain enough frames")
    write_json("input.json", {"width": WIDTH, "height": HEIGHT, "fps": FPS, "frames": len(frames), "seconds": len(frames) / FPS,
                              "cover_kind": "live_action" if SCENE else "animated_ocean_illustration", "scene": SCENE,
                              "case": CASE, "recognition_profile": case['profile'],
                              "sample_annotation": case.get('annotation'),
                              "secret_source": case.get('source', 'https://github.com/huggingface/lerobot/blob/main/media/readme/so100_video.webp'),
                              "secret_source_start_seconds": case.get('start', 0),
                              "secret_frames_sha256": hashlib.sha256(frames.tobytes()).hexdigest()})
    print(f"Prepared {len(frames)} real motion frames at {WIDTH}x{HEIGHT}, {FPS}fps", flush=True)


def encode():
    import torch

    net, dwt, iwt = load_network()
    # Import and call the ORIGINAL StegaVAR hide_LF, with unused imports removed.
    spec = importlib.util.spec_from_file_location("stegavar_hide", ROOT / "third_party/StegaVAR/src/hide_vid.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    secret = read_frames(OUTPUT / "secret-original")
    cover = read_frames(OUTPUT / "cover")
    start = time.perf_counter()
    source = torch.from_numpy(secret.copy()).permute(0, 3, 1, 2).float().unsqueeze(0) / 255
    host = torch.from_numpy(cover.copy()).permute(0, 3, 1, 2).float().unsqueeze(0) / 255
    with torch.inference_mode():
        stego = module.hide_LF(source, host, net, dwt, iwt)
    output = stego[0].permute(0, 2, 3, 1).mul(255).round().clamp(0, 255).byte().numpy()
    save_frames(output, OUTPUT / "stego")
    command("-framerate", FPS, "-i", OUTPUT / "stego/%04d.png", "-c:v", "ffv1", "-level", 3, "-pix_fmt", "bgr0", OUTPUT / "stego-lossless.mkv")
    reread = decode_movie(OUTPUT / "stego-lossless.mkv")
    if not np.array_equal(output, reread):
        raise ValueError("FFV1 save/reload changed RGB pixels")
    metrics = {"cover_psnr_db": psnr(cover, reread), "encode_seconds": time.perf_counter() - start, "lossless_roundtrip": True, "checkpoint_sha256": hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest(), "checkpoint_blocks": 16, "device": "cpu", "parameters": sum(p.numel() for p in net.parameters()), "stegovar_commit": "ef9d7f56568f205d60f47b06e3154338d0fe6c5b", "lfvsn_commit": "cc05d16665122bfcd11522c74e8e1253d0bd9d51"}
    write_json("encode.json", metrics)
    print(json.dumps(metrics), flush=True)


def reveal(stego_path):
    import torch

    net, dwt, iwt = load_network()
    frames = decode_movie(stego_path)
    folder = OUTPUT / "recovered"
    folder.mkdir(parents=True, exist_ok=True)
    start = time.perf_counter()
    with torch.inference_mode():
        for index, frame in enumerate(frames):
            tensor = torch.from_numpy(frame.copy()).permute(2, 0, 1).float().unsqueeze(0) / 255
            # Match official LFVSN.py test(): repeat the stored center frame
            # across GOP=3 and predict latent information using net.pm.
            _, secrets, _ = net(x=dwt(tensor.repeat(1, 3, 1, 1)), rev=True)
            result = iwt(secrets[0]).reshape(1, 3, 3, HEIGHT, WIDTH)[:, 1]
            output = result[0].permute(1, 2, 0).mul(255).round().clamp(0, 255).byte().numpy()
            Image.fromarray(output).save(folder / f"{index:04d}.png")
            if index % 4 == 0:
                print(f"Recovered {index+1}/{len(frames)} frames from saved MKV", flush=True)
    write_json("reveal.json", {"decode_seconds": time.perf_counter() - start, "recovery_input": "stego-lossless.mkv + public LF-VSN checkpoint", "original_secret_used_for_recovery": False, "frames": len(frames)})


def package():
    original = read_frames(OUTPUT / "secret-original")
    recovered = read_frames(OUTPUT / "recovered")
    cover = read_frames(OUTPUT / "cover")
    stego = decode_movie(OUTPUT / "stego-lossless.mkv")
    # Compute the diagnostic in original RGB bytes, avoiding browser GPU/CPU
    # color-rounding differences during per-frame canvas readback.
    amplified = np.clip(np.abs(stego.astype(np.int16) - cover.astype(np.int16)) * 12, 0, 255).astype(np.uint8)
    save_frames(amplified, OUTPUT / "difference")
    data = json.loads((OUTPUT / "input.json").read_text(encoding="utf-8"))
    data.update(json.loads((OUTPUT / "encode.json").read_text()))
    data.update(json.loads((OUTPUT / "reveal.json").read_text()))
    data["secret_psnr_db"] = psnr(original, recovered)
    data['recovered_frames_sha256'] = hashlib.sha256(recovered.tobytes()).hexdigest()
    data["unique_stego_frames"] = len({hashlib.sha256(frame.tobytes()).hexdigest() for frame in stego})
    data["unique_recovered_frames"] = len({hashlib.sha256(frame.tobytes()).hexdigest() for frame in recovered})
    data["sources"] = {"cover": SCENES[SCENE]["source"] if SCENE else "Generated ocean illustration; see docs/OCEAN_ASSET.md", "secret": "https://github.com/huggingface/lerobot/blob/main/media/readme/so100_video.webp"}
    data['sources']['secret'] = data.get('secret_source', data['sources']['secret'])
    data["stego_sha256"] = hashlib.sha256((OUTPUT / "stego-lossless.mkv").read_bytes()).hexdigest()
    write_json("manifest.json", data)
    Image.fromarray(stego[0]).save(OUTPUT / "thumbnail.jpg", quality=92)
    # Portable files for viewing only. Inference always used the lossless MKV.
    for folder, name in [("recovered", "recovered-preview.mp4"), ("cover", "cover-preview.mp4")]:
        command("-framerate", FPS, "-i", OUTPUT / folder / "%04d.png", "-c:v", "libx264", "-crf", 16, "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUTPUT / name)
    for index in [0, len(original)//2, len(original)-1]:
        montage = np.concatenate([cover[index], stego[index], original[index], recovered[index]], axis=1)
        Image.fromarray(montage).save(OUTPUT / f"validation-frame-{index:02d}.png")
    print(json.dumps(data, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["prepare", "encode", "reveal", "package"])
    parser.add_argument("--stego", type=Path)
    parser.add_argument("--scene", choices=SCENES.keys(), required=True)
    parser.add_argument('--case', choices=CASES.keys(), default='rover-moving')
    args = parser.parse_args()
    CASE = args.case
    SCENE = args.scene
    OUTPUT = OUTPUT / CASE / SCENE
    WIDTH, HEIGHT = 384, 216
    if args.stage == "reveal":
        reveal(args.stego or OUTPUT / "stego-lossless.mkv")
    else:
        globals()[args.stage]()
