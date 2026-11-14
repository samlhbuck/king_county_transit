"""Offline route-aligned USGS 3DEP terrain profiles; explicit CLI refresh only."""
import bisect
import hashlib
import json
import math
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from pyproj import Transformer
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/raw/elevation'
ENDPOINT = 'https://epqs.nationalmap.gov/v1/json'
MODEL = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'
STEP_FEET = 100
MAX_SAMPLES = 1800
BATCH_SIZE = 250
VERSION = 1


def signature(profile, *, legacy=False):
    payload = [VERSION, STEP_FEET, profile['vertices'], profile['stops']]
    def normalize(value):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            # PROJ/GEOS differ by nanometres across macOS and Linux. Keep
            # millimetre precision (and 0.001 feet of chainage), far below
            # the terrain raster's one-metre resolution.
            return float(round(value, 3)) + 0.0
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items()}
        if isinstance(value, list):
            return [normalize(item) for item in value]
        return value
    if not legacy:
        payload = normalize(payload)
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def cache_file(route_id, profile):
    key = hashlib.sha256((route_id + signature(profile)).encode()).hexdigest()
    return CACHE / (key + '.json')


def sample_locations(profile):
    """Regular chainage plus exact stop ticks; never interpolate a section gap."""
    sections, section = [], []
    for vertex in profile['vertices']:
        if vertex.get('breakBefore') and section:
            sections.append(section)
            section = []
        section.append(vertex)
    if section:
        sections.append(section)
    length = profile['lengthFeet']
    step = max(STEP_FEET, length / MAX_SAMPLES)
    points = []
    transform = Transformer.from_crs('EPSG:3857', 'EPSG:4269', always_xy=True)
    for section_index, vertices in enumerate(sections):
        if len(vertices) < 2:
            continue
        start, end = vertices[0]['distanceFeet'], vertices[-1]['distanceFeet']
        distances = {start, end}
        distances.update(i * step for i in range(math.ceil(start / step), math.floor(end / step) + 1))
        distances.update(s['distanceFeet'] for s in profile['stops'] if start <= s['distanceFeet'] <= end)
        chainage = [v['distanceFeet'] for v in vertices]
        for index, distance in enumerate(sorted(distances)):
            i = max(1, min(len(vertices)-1, bisect.bisect_left(chainage, distance)))
            a, b = vertices[i-1], vertices[i]
            t = (distance-a['distanceFeet']) / (b['distanceFeet']-a['distanceFeet'] or 1)
            lon, lat = transform.transform(a['x']+t*(b['x']-a['x']), a['y']+t*(b['y']-a['y']))
            points.append({'distanceFeet': distance, 'lon': lon, 'lat': lat,
                           'breakBefore': bool(section_index and index == 0)})
    return points, step


def query_point(point):
    response = requests.get(ENDPOINT, params={'x': point['lon'], 'y': point['lat'],
        'wkid': 4269, 'units': 'Meters', 'includeDate': 'true'}, timeout=30)
    response.raise_for_status()
    return parse_sample(point, response.json())


def parse_sample(point, raw):
    # -1000000 is the service's no-data value; invalid responses stay unavailable.
    value = raw.get('value')
    try:
        value = float(value)
    except (ValueError, TypeError):
        value = None
    if value is not None and (not math.isfinite(value) or value <= -1000000):
        value = None
    # ImageServer can return angular pixel sizes for geographic rasters.
    # Preserve the native number without asserting that every resolution is metres.
    return {**point, 'elevationMeters': value, 'sourceResolution': raw.get('resolution'),
            'resolutionUnits': 'source raster units',
            'rasterId': raw.get('rasterId'), 'acquisitionDate': raw.get('attributes', {}).get('AcquisitionDate')}


def query_batch(points):
    parameters = {
        'geometry': json.dumps({'points': [[p['lon'], p['lat']] for p in points],
                                'spatialReference': {'wkid': 4269}}, separators=(',', ':')),
        'geometryType': 'esriGeometryMultipoint', 'returnFirstValueOnly': 'true',
        'interpolation': 'RSP_NearestNeighbor',
        'outFields': 'Name,VerticalDatum,AcquisitionDate', 'f': 'json'}
    for attempt in range(3):
        try:
            response = requests.post(MODEL + '/getSamples', data=parameters, timeout=60)
            response.raise_for_status()
            break
        except requests.RequestException as error:
            status = error.response.status_code if error.response is not None else None
            if attempt == 2 or (status is not None and status != 429 and status < 500):
                raise RuntimeError(f'USGS multipoint request failed ({status or type(error).__name__})') from error
            time.sleep(2 ** attempt)
    raw = response.json()
    if 'samples' not in raw or not isinstance(raw['samples'], list):
        raise ValueError('Invalid USGS multipoint response')
    by_id = {}
    for sample in raw['samples']:
        index = sample.get('locationId')
        if not isinstance(index, int) or index < 0 or index >= len(points) or index in by_id:
            raise ValueError('Invalid or duplicate USGS sample location ID')
        location = sample.get('location', {})
        if abs(location.get('x', float('inf')) - points[index]['lon']) > 1e-7 or abs(location.get('y', float('inf')) - points[index]['lat']) > 1e-7:
            raise ValueError('USGS sample location does not match query')
        by_id[index] = sample
    # Missing coverage is a gap, never an invented elevation or shifted index.
    return [{**parse_sample(point, by_id.get(index, {})),
             'modelAttributes': {key: value for key, value in
                                 by_id.get(index, {}).get('attributes', {}).items()
                                 if key in ('Name', 'VerticalDatum')}}
            for index, point in enumerate(points)]


def query_locations(locations):
    from concurrent.futures import ThreadPoolExecutor
    batches = [locations[i:i+BATCH_SIZE] for i in range(0, len(locations), BATCH_SIZE)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        return [sample for batch in pool.map(query_batch, batches) for sample in batch]


def prepare_profile(route_id, profile, refresh=False):
    destination = cache_file(route_id, profile)
    if not refresh:
        cached = load_cached(route_id, profile)
        if cached is not None:
            # Upgrade an exact-number snapshot offline, preserving provenance.
            if cached['geometryHash'] != signature(profile):
                cached = {**cached, 'geometryHash': signature(profile)}
                temporary = destination.with_suffix('.tmp')
                temporary.write_text(json.dumps(cached, allow_nan=False))
                temporary.replace(destination)
            return cached
    locations, step = sample_locations(profile)
    # Bounded retrieval. Any transport/schema failure leaves the old cache intact.
    samples = query_locations(locations)
    if not any(s['elevationMeters'] is not None for s in samples):
        raise ValueError('No elevation coverage returned; cache unchanged.')
    raster_ids = sorted({s['rasterId'] for s in samples if s['rasterId'] is not None})
    models = []
    inline_models = {}
    for sample in samples:
        attributes = sample.pop('modelAttributes', {})
        if sample['rasterId'] is not None and attributes.get('Name'):
            inline_models[sample['rasterId']] = attributes
    for raster_id in raster_ids:
        if raster_id in inline_models:
            models.append({'rasterId': raster_id, **inline_models[raster_id]})
            continue
        response = requests.get(MODEL+'/query', params={'f': 'json', 'objectIds': raster_id,
            'outFields': 'Name,VerticalDatum', 'returnGeometry': 'false'}, timeout=30)
        response.raise_for_status()
        features = response.json().get('features', [])
        if not features:
            raise ValueError('Source model metadata unavailable; cache unchanged.')
        models.extend({'rasterId': raster_id, **f['attributes']} for f in features)
    payload = {'version': VERSION, 'routeId': route_id, 'profileId': profile['id'],
        'geometryHash': signature(profile), 'source': MODEL + '/getSamples', 'sourceName': 'USGS 3DEP terrain',
        'stopTicks': profile['stops'],
        'interpolation': 'nearest neighbor',
        'license': 'Public domain', 'horizontalDatum': 'NAD83 (EPSG:4269)',
        'retrievedAt': datetime.now(timezone.utc).isoformat(), 'sampleStepFeet': step,
        'models': models, 'samples': samples}
    CACHE.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(payload, allow_nan=False))
    temporary.replace(destination)
    return payload


def load_cached(route_id, profile):
    """No requests on application startup, route switching, or scrub input."""
    for digest in (signature(profile), signature(profile, legacy=True)):
        key = hashlib.sha256((route_id + digest).encode()).hexdigest()
        try:
            payload = json.loads((CACHE / (key + '.json')).read_text())
            if payload.get('geometryHash') == digest and payload.get('version') == VERSION:
                return payload
        except (OSError, ValueError):
            pass
    # Noded paths can contain different redundant vertices across GEOS builds.
    # Reuse terrain only when every actual query location, chainage and break
    # matches; never attach samples by route/direction identity alone.
    expected = None
    for source in cache_index(str(CACHE)).get((route_id, profile['id']), []):
        try:
            payload = json.loads(source.read_text())
            if payload.get('version') != VERSION:
                continue
            ticks = payload.get('stopTicks')
            if ticks is not None and not matching_ticks(ticks, profile['stops']):
                continue
            if expected is None:
                expected, _ = sample_locations(profile)
            if matching_samples(expected, payload.get('samples', [])):
                return {**payload, 'geometryMatch': 'sample locations'}
        except (OSError, ValueError, TypeError, KeyError):
            pass
    return None


def matching_ticks(a, b):
    return len(a) == len(b) and all(
        {k: v for k, v in x.items() if k != 'distanceFeet'} ==
        {k: v for k, v in y.items() if k != 'distanceFeet'} and
        abs(x['distanceFeet'] - y['distanceFeet']) <= .001 for x, y in zip(a, b))


def matching_samples(expected, samples):
    return bool(expected) and len(expected) == len(samples) and all(
        abs(a['distanceFeet'] - b['distanceFeet']) <= .001 and
        abs(a['lon'] - b['lon']) <= 1e-8 and abs(a['lat'] - b['lat']) <= 1e-8 and
        bool(a.get('breakBefore')) == bool(b.get('breakBefore'))
        for a, b in zip(expected, samples))


@lru_cache(maxsize=1)
def cache_index(folder):
    """Index filenames once; do not retain all terrain payloads in server RAM."""
    index = {}
    for source in Path(folder).glob('*.json'):
        try:
            payload = json.loads(source.read_text())
            if payload.get('version') == VERSION and 'routeId' in payload and 'profileId' in payload:
                index.setdefault((payload['routeId'], payload['profileId']), []).append(source)
        except (OSError, ValueError, TypeError):
            pass
    return index


def prepare_routes(routes, *, refresh=False, dry_run=False, build=None, report=None):
    """Resume from completed snapshots; isolate failures by route/profile."""
    if build is None:
        from src.route_explorer import build_dashboard_data
        build = build_dashboard_data
    results = []
    for route_id in dict.fromkeys(routes):
        try:
            profiles = build(route_id)['zoning']['frontage']['paths']
            if not profiles:
                raise ValueError('No usable route profiles')
        except Exception as error:
            results.append({'routeId': route_id, 'status': 'failed', 'error': str(error)})
            print(f'{route_id}: failed: {error}', flush=True)
            if report:
                write_report(report, results)
            continue
        for profile in profiles:
            entry = {'routeId': route_id, 'profileId': profile['id'],
                     'geometryHash': signature(profile)}
            try:
                cached = load_cached(route_id, profile)
                locations, _ = sample_locations(profile)
                entry['sampleCount'] = len(locations)
                if dry_run:
                    entry['status'] = 'cached' if cached is not None and not refresh else 'pending'
                else:
                    print(f"{route_id} profile {profile['id']}: "
                          f"{'using cache' if cached is not None and not refresh else 'retrieving'} "
                          f"{len(locations)} samples", flush=True)
                    payload = prepare_profile(route_id, profile, refresh)
                    entry['status'] = 'cached' if cached is not None and not refresh else 'prepared'
                    entry['availableSamples'] = sum(s['elevationMeters'] is not None for s in payload['samples'])
            except Exception as error:
                entry.update(status='failed', error=str(error))
            results.append(entry)
            print(f"{route_id} profile {profile['id']}: {entry['status']}" +
                  (f" ({entry['error']})" if 'error' in entry else ''), flush=True)
            if report:
                write_report(report, results)
    return results


def write_report(path, results):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps({'updatedAt': datetime.now(timezone.utc).isoformat(),
                                     'profiles': results}, indent=2))
    temporary.replace(destination)


def main():
    import argparse
    from src import oba
    from src.route_explorer import route_catalog
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('routes', nargs='*')
    parser.add_argument('--all', action='store_true', help='Prepare the route catalog')
    parser.add_argument('--cached-only', action='store_true', help='Skip routes without local transit geometry')
    parser.add_argument('--exclude', action='append', default=['1_102745'], help='Exclude a route; G Line is excluded pending its geometry fix')
    parser.add_argument('--dry-run', action='store_true', help='Count samples without querying elevation')
    parser.add_argument('--report', default=str(CACHE / 'batch-report.json'))
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    if bool(args.routes) == args.all:
        parser.error('Supply route IDs or --all')
    routes = [r['route_id'] for r in route_catalog()] if args.all else args.routes
    selected, skipped = [], []
    for route_id in dict.fromkeys(routes):
        reason = ('Excluded pending geometry review' if route_id in args.exclude else
                  'Transit geometry not cached' if args.cached_only and not oba._route_data_file(route_id).exists() else None)
        if reason:
            skipped.append({'routeId': route_id, 'status': 'skipped', 'reason': reason})
        else:
            selected.append(route_id)
    print(f'{len(selected)} routes selected; {len(skipped)} skipped', flush=True)
    results = prepare_routes(selected, refresh=args.refresh, dry_run=args.dry_run, report=args.report)
    write_report(args.report, results + skipped)
    counts = {status: sum(r['status'] == status for r in results + skipped)
              for status in ['cached', 'prepared', 'pending', 'failed', 'skipped']}
    print(json.dumps(counts), flush=True)
    print(f"Pending elevation queries: {sum(r.get('sampleCount', 0) for r in results if r['status'] == 'pending')}", flush=True)
    return int(bool(counts['failed']))


if __name__ == '__main__':
    raise SystemExit(main())
