"""Publish selected case artifacts after full frame/hash verification."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from analyze_rover import main as analyze, read_frames
from settings import ROOT, DATA_ROOT, WORK_ROOT, within

CASES = json.loads((ROOT / 'config/cases.json').read_text(encoding='utf-8'))
SCENES = json.loads((ROOT / 'config/scenes.json').read_text(encoding='utf-8'))
KINDS = ['cover', 'stego', 'difference', 'recovered']


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def publish(source, destination):
    catalog = {'version': 1, 'defaultCase': 'rover-moving', 'defaultScene': 'surf', 'cases': []}
    destination.mkdir(parents=True, exist_ok=True)
    for case, definition in CASES.items():
        row = {'id': case, 'titleEn': 'Moving rover' if case == 'rover-moving' else 'Stationary rover',
               'titleJa': '\u52d5\u4f5c\u3059\u308bRover' if case == 'rover-moving' else '\u9759\u6b62\u3059\u308bRover', 'scenes': []}
        for scene, cover in SCENES.items():
            original = within(source, case, scene)
            meta = json.loads((original / 'manifest.json').read_text(encoding='utf-8'))
            if meta.get('case') != case or meta.get('scene') != scene or meta.get('frames') != 40:
                raise ValueError('Manifest identity or frame count mismatch')
            result = analyze(original, save=False)
            target = within(destination, case, scene)
            target.mkdir(parents=True, exist_ok=True)
            files = {}
            for kind in KINDS:
                paths = sorted((original / kind).glob('*.png'))
                expected = [f'{index:04d}.png' for index in range(meta['frames'])]
                if [p.name for p in paths] != expected:
                    raise ValueError(f'Frame sequence mismatch: {case}/{scene}/{kind}')
                pixels = read_frames(original / kind, meta['frames'])
                if any(f.shape != (meta['height'], meta['width'], 3) for f in pixels):
                    raise ValueError('Frame dimensions mismatch')
                (target / kind).mkdir(exist_ok=True)
                for path in paths:
                    relative = f'{kind}/{path.name}'
                    shutil.copy2(path, target / relative)
                    files[relative] = digest(target / relative)
            shutil.copy2(original / 'stego-lossless.mkv', target / 'stego-lossless.mkv')
            files['stego-lossless.mkv'] = digest(target / 'stego-lossless.mkv')
            result.update({'scene': scene, 'execution': 'saved'})
            write(target / 'recognition.json', result)
            files['recognition.json'] = digest(target / 'recognition.json')
            meta['files_sha256'] = files
            write(target / 'manifest.json', meta)
            row['scenes'].append({'id': scene, 'titleEn': {'surf': 'Surfing', 'hike': 'Hiking', 'camp': 'Camping'}[scene],
                                  'titleJa': cover['short'], 'creator': cover['creator'], 'source': cover['source'],
                                  'base': f'/stegavar/{case}/{scene}', 'manifest': meta,
                                  'savedAnalysis': result})
            print(f'Published {case}/{scene}: {meta["frames"]} frames', flush=True)
        catalog['cases'].append(row)
    shutil.copy2(ROOT / 'SOURCES.md', destination / 'SOURCES.md')
    write(destination / 'catalog.json', catalog)
    verify(destination)


def verify(root):
    catalog = json.loads((root / 'catalog.json').read_text(encoding='utf-8'))
    if {row['id'] for row in catalog['cases']} != set(CASES):
        raise ValueError('Missing case')
    for row in catalog['cases']:
        if {scene['id'] for scene in row['scenes']} != set(SCENES):
            raise ValueError('Missing scene')
        for scene in row['scenes']:
            folder = within(root, row['id'], scene['id'])
            meta = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
            if meta != scene['manifest']:
                raise ValueError('Catalog/manifest mismatch')
            expected = {f'{kind}/{i:04d}.png' for kind in KINDS for i in range(meta['frames'])}
            expected.update({'stego-lossless.mkv', 'recognition.json'})
            if set(meta['files_sha256']) != expected:
                raise ValueError('Incomplete file hash list')
            for name, checksum in meta['files_sha256'].items():
                if digest(within(folder, name)) != checksum:
                    raise ValueError(f'File hash mismatch: {row["id"]}/{scene["id"]}/{name}')
            result = analyze(folder, save=False)
            saved = json.loads((folder / 'recognition.json').read_text(encoding='utf-8'))
            if saved != scene['savedAnalysis'] or saved['recovered_frames_sha256'] != result['recovered_frames_sha256']:
                raise ValueError('Saved result mismatch')
            if saved['results']['recovered']['label'] != result['results']['recovered']['label']:
                raise ValueError('Saved motion label mismatch')
    print('Verified 2 cases / 6 scenes / 960 display frames and saved results', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=WORK_ROOT / 'build')
    parser.add_argument('--output', type=Path, default=DATA_ROOT)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.check:
        verify(args.output.resolve())
    else:
        publish(args.source.resolve(), args.output.resolve())
