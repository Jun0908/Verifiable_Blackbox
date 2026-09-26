"""Fetch pinned source revisions and model files, or verify local assets."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from settings import ROOT, MODEL_ROOT

LOCK = json.loads((ROOT / 'config/assets.lock.json').read_text(encoding='utf-8'))


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def verify(path, digest):
    if not path.is_file() or sha256(path) != digest:
        raise ValueError(f'Asset missing or hash mismatch: {path.name}')


def sources(check):
    for item in LOCK['sources']:
        target = ROOT / 'third_party' / item['name']
        if not target.exists() and not check:
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['git', 'clone', '--no-checkout', item['url'], str(target)], check=True)
            subprocess.run(['git', '-C', str(target), 'checkout', '--detach', item['revision']], check=True)
        revision = subprocess.check_output(['git', '-C', str(target), 'rev-parse', 'HEAD'], text=True).strip()
        if revision != item['revision']:
            raise ValueError(f'Source revision mismatch: {item["name"]}')
        patch = str(ROOT / 'patches' / item['patch'])
        applied = subprocess.run(['git', '-C', str(target), 'apply', '--reverse', '--check', patch], capture_output=True).returncode == 0
        if not applied:
            if check:
                raise ValueError(f'CPU patch missing: {item["name"]}')
            subprocess.run(['git', '-C', str(target), 'apply', '--check', patch], check=True)
            subprocess.run(['git', '-C', str(target), 'apply', patch], check=True)
        print(f'Source ready: {item["name"]} {revision}', flush=True)


def models(check):
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    item = LOCK['lfvsn']
    target = MODEL_ROOT / item['filename']
    if not target.is_file() and not check:
        import gdown
        temporary = target.with_suffix('.download')
        gdown.download(item['url'], str(temporary), quiet=False)
        verify(temporary, item['sha256'])
        temporary.replace(target)
    verify(target, item['sha256'])
    item = LOCK['xclip']
    target = MODEL_ROOT / 'xclip'
    if not check:
        executable = Path(sys.executable).parent / ('hf.exe' if sys.platform == 'win32' else 'hf')
        command = str(executable) if executable.exists() else shutil.which('hf')
        if not command:
            raise RuntimeError('Install the pinned requirements to provide hf')
        subprocess.run([command, 'download', item['repo'], *item['files'], '--revision', item['revision'],
                        '--local-dir', str(target)], check=True)
    for name, digest in item['files'].items():
        verify(target / name, digest)
    print('LF-VSN and X-CLIP model hashes verified', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--only', choices=['sources', 'models', 'all'], default='all')
    args = parser.parse_args()
    if args.only in ('sources', 'all'):
        sources(args.check)
    if args.only in ('models', 'all'):
        models(args.check)
