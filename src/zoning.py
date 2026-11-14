"""Current Seattle zoning cache and actual polygon-area catchment summaries."""
from datetime import datetime, timezone
from pathlib import Path
import json

import pandas as pd
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


def route_zoning(stops, corridor, map_area, radius, assignment_areas=None, direction_areas=None, route_data=None, development_frames=(), continuation_data=None):
    from src.municipal_zoning import sources, CACHE_DIR
    frames, provenance = [], []
    inputs = [('Seattle', CACHE, URL)] + [(spec['name'], CACHE_DIR / f'{key}.geojson', spec['url']) for key, spec in sources().items()]
    for name, path, source in inputs:
        if not path.exists():
            provenance.append({'name': name, 'source': source, 'available': False})
            continue
        raw = json.loads(path.read_text())
        frame = gpd.GeoDataFrame.from_features(raw['features'], crs='EPSG:4326').to_crs(stops.crs)
        frame.geometry = frame.geometry.make_valid()
        # Identify Yesler by its official district code, not the generic MPC label.
        if name == 'Seattle' and 'ZONING' in frame.columns:
            nc = frame.ZONING.fillna('').str.match(r'^NC[123]P?(?:-| |$)')
            frame.loc[nc, 'DETAIL_DESC'] = frame.loc[nc, 'DETAIL_DESC'] + ' [' + frame.loc[nc, 'ZONING'] + ']'
            frame.loc[frame.ZONING.eq('MPC-YT'), 'DETAIL_DESC'] = 'Master Planned Community — Yesler Terrace (MPC-YT)'
        frame['jurisdiction'] = name
        in_view = bool(frame.intersects(map_area).any())
        provenance.append({'name': name, 'source': source, 'available': True, 'inView': in_view,
                           'retrievedAt': raw.get('retrieved_at'), 'effectiveDate': raw.get('effective_date'),
                           'audit': raw.get('audit')})
        # Only nearby polygons are needed by the map, corridor summaries and route samples.
        frames.append(frame.loc[frame.intersects(map_area), ['DETAIL_DESC', 'jurisdiction', 'geometry']])
    if not frames:
        for frame in development_frames:
            frame["CurrentZoning"] = "Unknown / unmapped"
        return None
    zones = gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs=stops.crs)
    for frame in development_frames:
        projected = frame.to_crs(zones.crs)
        labels = []
        for point in projected.geometry:
            matches = zones.iloc[list(zones.sindex.query(point, predicate='intersects'))] if point is not None and not point.is_empty else zones.iloc[:0]
            names = sorted(set(matches.DETAIL_DESC.dropna().astype(str)))
            labels.append(names[0] if len(names) == 1 else 'Overlapping zoning' if names else 'Unknown / unmapped')
        frame['CurrentZoning'] = labels
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
    from src.frontage import main_route_profile
    frontage = main_route_profile(route_data, zones, stops, continuation_data) if route_data else None
    return {'frontage': frontage, 'directionSummaries': directional, 'summaries': summary, 'sources': provenance, 'source': URL, 'retrievedAt': next((s.get('retrievedAt') for s in provenance if s['name']=='Seattle'), None),
            'features': json.loads(display[['DETAIL_DESC', 'geometry']].to_crs('EPSG:3857').to_json())['features']}


if __name__ == '__main__':
    print(f'Cached {download_zoning()} Seattle zoning polygons.')
