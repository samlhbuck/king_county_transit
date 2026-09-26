"""Current Seattle zoning cache and actual polygon-area catchment summaries."""
from datetime import datetime, timezone
from pathlib import Path
import json

import geopandas as gpd
import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/raw/seattle_zoning.geojson'
URL = 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Current_Land_Use_Zoning_Detail_2/FeatureServer/0'


def download_zoning():
    features = []
    session = requests.Session()
    count_response = session.get(URL + '/query', params={'where': '1=1', 'returnCountOnly': 'true', 'f': 'json'}, timeout=60)
    count_response.raise_for_status()
    count = count_response.json()['count']
    for offset in range(0, count, 1000):
        response = session.get(URL + '/query', params={
            'where': '1=1', 'outFields': 'OBJECTID,ZONING,DETAIL_DESC,CLASS_DESC',
            'outSR': 4326, 'f': 'geojson', 'orderByFields': 'OBJECTID',
            'resultOffset': offset, 'resultRecordCount': 1000,
        }, timeout=90)
        response.raise_for_status()
        features.extend(response.json()['features'])
    if len(features) != count or len({f['properties']['OBJECTID'] for f in features}) != count:
        raise ValueError('Zoning download was incomplete or contained duplicate IDs; existing cache retained.')
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    temp = CACHE.with_suffix('.tmp')
    temp.write_text(json.dumps({'type': 'FeatureCollection', 'features': features,
                               'source': URL, 'retrieved_at': datetime.now(timezone.utc).isoformat()}))
    temp.replace(CACHE)
    return count


def summarize_area(zones, area):
    if area.is_empty or area.area == 0:
        return {'categories': [], 'coveredPercent': 0, 'overlap': False}
    subset = zones.iloc[list(zones.sindex.query(area, predicate='intersects'))].copy()
    if subset.empty:
        return {'categories': [], 'coveredPercent': 0, 'overlap': False}
    subset.geometry = subset.geometry.intersection(area)
    categories = []
    for name, group in subset.groupby('DETAIL_DESC', dropna=False):
        size = group.geometry.union_all().area
        if size > 0:
            categories.append({'name': str(name) if name else 'Unknown zoning', 'percent': size / area.area * 100})
    covered = subset.geometry.union_all().area / area.area * 100
    return {'categories': sorted(categories, key=lambda row: -row['percent']),
            'coveredPercent': min(100, covered),
            'overlap': sum(row['percent'] for row in categories) > covered + .1}


def route_zoning(stops, corridor, map_area, radius, assignment_areas=None, direction_areas=None):
    if not CACHE.exists():
        return None
    zones = gpd.read_file(CACHE).to_crs(stops.crs)
    zones.geometry = zones.geometry.make_valid()
    summary = {'all': summarize_area(zones, corridor)}
    areas = assignment_areas.set_index('id').geometry if assignment_areas is not None else None
    for row in stops.itertuples():
        region = areas.loc[row.id] if areas is not None else row.geometry.buffer(radius)
        summary[row.id] = summarize_area(zones, region)
    directional = {}
    for direction, regions in (direction_areas or {}).items():
        directional[direction] = {stop: summarize_area(zones, area) for stop, area in regions.items()}
        directional[direction]['all'] = summarize_area(zones, gpd.GeoSeries(list(regions.values()), crs=stops.crs).union_all())
    display = gpd.clip(zones, map_area)
    display.geometry = display.geometry.simplify(15)
    raw = json.loads(CACHE.read_text())
    return {'directionSummaries': directional, 'summaries': summary, 'source': URL, 'retrievedAt': raw.get('retrieved_at'),
            'features': json.loads(display[['DETAIL_DESC', 'geometry']].to_crs('EPSG:3857').to_json())['features']}


if __name__ == '__main__':
    print(f'Cached {download_zoning()} Seattle zoning polygons.')
