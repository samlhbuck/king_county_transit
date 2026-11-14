"""Create an isolated Railway upload directory including ignored public data.

Usage: python scripts/prepare_release.py /tmp/route-lens-release
The destination must not exist. Credentials and unrelated workspace files are excluded.
"""
from pathlib import Path
import argparse
import shutil

ROOT = Path(__file__).resolve().parents[1]


def prepare(destination):
    destination = Path(destination).resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError('Choose a release directory outside the repository.')
    for required in ('data/processed/development_permits.csv',
                     'data/reference/agency_route.json', 'data/raw/seattle_zoning.geojson'):
        if not (ROOT / required).is_file():
            raise ValueError(f'Missing required snapshot: {required}')
    destination.mkdir(parents=True, exist_ok=False)
    for name in ('app.py', 'requirements.txt', 'Dockerfile', '.dockerignore', 'railway.json'):
        shutil.copy2(ROOT / name, destination / name)
    for name in ('src', 'analysis', 'web', 'data'):
        shutil.copytree(ROOT / name, destination / name,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.env*', '*.tmp', '.DS_Store'))
    print(f'Release prepared: {destination}')
    print('No credentials included. Set OBA_API_KEY in Railway for live departures.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination')
    prepare(parser.parse_args().destination)
