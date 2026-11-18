"""Read-only contextual geometry from existing OBA caches; no network requests."""
import json
import math
from functools import lru_cache
from pathlib import Path

import polyline
from src import oba


def decode_paths(data):
    shapes = list(data.get('polylines', []))
    for grouping in data.get('stop_groupings', []):
        for group in grouping.get('stopGroups', []):
            shapes.extend(group.get('polylines', []))
    seen, paths = set(), []
    for shape in shapes:
        encoded = shape.get('points')
        if not encoded or encoded in seen:
            continue
        seen.add(encoded)
        try:
            coordinates = polyline.decode(encoded)
            if any(not (-85 <= lat <= 85 and -180 <= lon <= 180) for lat, lon in coordinates):
                continue
            points = [[6378137 * math.radians(lon),
                       6378137 * math.log(math.tan(math.pi/4 + math.radians(lat)/2))]
                      for lat, lon in coordinates]
        except (ValueError, IndexError, TypeError, OverflowError):
            continue
        if len(points) >= 2:
            paths.append(points)
    return paths


@lru_cache(maxsize=1)
def _read_inventory(signature):
    routes = []
    for filename, _, _ in signature:
        try:
            data = json.loads(Path(filename).read_text())
            paths = decode_paths(data)
            if paths and data.get('route_id'):
                routes.append({'id': data['route_id'], 'paths': paths})
        except (OSError, ValueError, TypeError):
            continue
    return {'routes': routes, 'source': 'Cached OneBusAway polylines',
            'note': 'Each encoded polyline evaluated separately; missing caches are omitted.'}


def cached_context_routes():
    signature = tuple((str(p), p.stat().st_mtime_ns, p.stat().st_size)
                      for p in sorted(oba.ROUTE_DATA_DIR.glob('*.json')))
    return _read_inventory(signature)
