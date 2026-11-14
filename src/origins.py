"""Public cached boarding locations for client-side origin discovery."""
import json
import math
from src import oba


def cached_boarding_stops():
    stops = {}
    for path in sorted(oba.ROUTE_DATA_DIR.glob('*.json')):
        try:
            data = json.loads(path.read_text())
            route = data['route_id']
            directions = {}
            valid_ids = {stop['id'] for stop in data.get('stops', [])}
            groups = []
            for grouping in data.get('stop_groupings', []):
                if grouping.get('type') != 'direction':
                    continue
                for group in grouping.get('stopGroups', []):
                    ids = [id for id in group.get('stopIds', []) if id in valid_ids]
                    if not ids:
                        continue
                    index = len(groups)
                    key = f"{index}:{group.get('id', index)}"
                    label = (group.get('name') or {}).get('name') or 'Destination unavailable'
                    groups.append(key)
                    for id in ids:
                        directions.setdefault(id, []).append({'id': key, 'name': label})
                if groups:
                    break
            for stop in data.get('stops', []):
                lat, lon = float(stop['lat']), float(stop['lon'])
                if not (math.isfinite(lat) and math.isfinite(lon) and -85 <= lat <= 85 and -180 <= lon <= 180):
                    continue
                entry = stops.setdefault(stop['id'], {'id': stop['id'], 'name': stop['name'],
                    'lat': lat, 'lon': lon, 'routes': [], 'directions': {}})
                if route not in entry['routes']:
                    entry['routes'].append(route)
                entry['directions'][route] = directions.get(stop['id'], [])
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return list(stops.values())
