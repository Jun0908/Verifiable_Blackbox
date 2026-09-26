"""Measure visible motion in recovered frames; never read source footage at runtime."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / 'config/rover_motion.json'


def measure(frames, policy):
    start = time.perf_counter()
    if len(frames) < max(8, policy['reference_frames']):
        raise ValueError('Insufficient frames for motion analysis')
    height, width = frames[0].shape[:2]
    x0, y0, x1, y1 = policy['roi']
    bounds = [round(x0 * width), round(y0 * height), round(x1 * width), round(y1 * height)]
    left, top, right, bottom = bounds
    gray = np.stack([np.asarray(Image.fromarray(frame).convert('L').filter(
        ImageFilter.GaussianBlur(policy['blur_radius'])), dtype=np.float32)[top:bottom, left:right]
        for frame in frames])
    reference = np.median(gray[:policy['reference_frames']], axis=0)
    delta = gray - reference
    delta -= np.median(delta, axis=(1, 2), keepdims=True)
    areas = np.mean(np.abs(delta) > policy['pixel_delta'], axis=(1, 2)) * 100
    value = float(np.percentile(areas, 90))
    active = areas >= policy['moving_area_percent']
    longest = current = 0
    for item in active:
        current = current + 1 if item else 0
        longest = max(longest, current)
    if value >= policy['moving_area_percent'] and longest >= policy['minimum_active_frames']:
        label = 'ROVER_MOVING'
    elif float(areas.max()) <= policy['still_area_percent']:
        label = 'ROVER_STILL'
    else:
        label = 'ROVER_UNCERTAIN'
    return {
        'label': label, 'changed_area_percent': value,
        'peak_changed_area_percent': float(areas.max()),
        'per_frame_changed_area_percent': areas.tolist(),
        'longest_active_run': longest, 'roi_pixels': bounds,
        'inference_seconds': time.perf_counter() - start,
    }


def read_frames(folder, count):
    return [np.asarray(Image.open(folder / f'{index:04d}.png').convert('RGB')) for index in range(count)]


def main(data_path, save=True):
    data = Path(data_path)
    meta = json.loads((data / 'manifest.json').read_text(encoding='utf-8'))
    if meta.get('recognition_profile') != 'rover_motion_v1':
        raise ValueError('Not a rover motion case')
    stego_hash = hashlib.sha256((data / 'stego-lossless.mkv').read_bytes()).hexdigest()
    if stego_hash != meta['stego_sha256']:
        raise ValueError('Stego does not match manifest')
    policy_bytes = POLICY_PATH.read_bytes()
    policy = json.loads(policy_bytes)
    frames = read_frames(data / 'recovered', meta['frames'])
    digest = hashlib.sha256(b''.join(frame.tobytes() for frame in frames)).hexdigest()
    if digest != meta['recovered_frames_sha256']:
        raise ValueError('Recovered frames do not match manifest')
    output = {
        'model': 'ROI frame difference', 'model_revision': policy['version'], 'device': 'cpu',
        'mode': 'reconstructed_video_motion', 'recognition_profile': 'rover_motion_v1',
        'case': meta['case'], 'direct_stego_recognition': False,
        'score_kind': 'changed_roi_area_percent_not_probability',
        'sampled_frame_indices': list(range(meta['frames'])),
        'stego_sha256': stego_hash, 'recovered_frames_sha256': digest,
        'original_secret_used': False, 'policy': policy,
        'policy_sha256': hashlib.sha256(policy_bytes).hexdigest(),
        'results': {'recovered': measure(frames, policy)},
    }
    if save:
        (data / 'recognition.json').write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', type=Path, required=True)
    print(json.dumps(main(parser.parse_args().data)['results'], ensure_ascii=False))
