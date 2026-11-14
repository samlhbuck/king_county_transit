"""Validated, atomic imports of municipal base zoning from public ArcGIS layers."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile

import geopandas as gpd
import requests

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / 'data/reference/zoning_sources.json'
CACHE_DIR = ROOT / 'data/raw/municipal_zoning'


def sources():
    return json.loads(REGISTRY.read_text())


def request_json(session, url, params):
    response = session.get(url, params=params, timeout=90)
    response.raise_for_status()
    result = response.json()
    if 'error' in result:
        raise ValueError(f"ArcGIS request failed: {result['error'].get('message', 'unknown error')}")
    return result


def fetch_layer(session, url, fields=None):
    metadata = request_json(session, url, {'f': 'json'})
    if 'layers' in metadata:
        polygons = []
        for layer in metadata['layers']:
            candidate = f"{url}/{layer['id']}"
            info = request_json(session, candidate, {'f': 'json'})
            if info.get('geometryType') == 'esriGeometryPolygon':
                polygons.append(candidate)
        if len(polygons) != 1:
            raise ValueError('Boundary service must identify exactly one polygon layer.')
        return fetch_layer(session, polygons[0], fields)
    if metadata.get('geometryType') != 'esriGeometryPolygon':
        raise ValueError('Expected a polygon layer.')
    available = {field['name'] for field in metadata['fields']}
    oid = next(field['name'] for field in metadata['fields'] if field['type'] == 'esriFieldTypeOID')
    if fields and not set(fields) <= available:
        raise ValueError(f'Missing source fields: {set(fields) - available}')
    query = url + '/query'
    count = request_json(session, query, {'where': '1=1', 'returnCountOnly': 'true', 'f': 'json'})['count']
    ids = request_json(session, query, {'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'}).get('objectIds') or []
    if not count or count != len(ids) or len(set(ids)) != count:
        raise ValueError('Empty or inconsistent source ID inventory; old cache retained.')
    features = []
    size = min(200, metadata.get('maxRecordCount', 200))
    for offset in range(0, len(ids), size):
        batch = ids[offset:offset+size]
        result = request_json(session, query, {'objectIds': ','.join(map(str, batch)),
            'outFields': ','.join(dict.fromkeys([oid, *(fields or [])])),
            'outSR': 4326, 'returnGeometry': 'true', 'f': 'geojson'})
        chunk = result.get('features', [])
        returned = [feature['properties'].get(oid) for feature in chunk]
        if result.get('exceededTransferLimit') or len(returned) != len(batch) or set(returned) != set(batch):
            raise ValueError('Incomplete or duplicated source batch; old cache retained.')
        features.extend(chunk)
    final_ids = request_json(session, query, {'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'}).get('objectIds') or []
    if set(final_ids) != set(ids):
        raise ValueError('Source changed during retrieval; retry refresh.')
    if any(not feature.get('geometry') or feature['geometry']['type'] not in ('Polygon', 'MultiPolygon') for feature in features):
        raise ValueError('Missing or non-polygon source geometry.')
    return {'type': 'FeatureCollection', 'features': features}, metadata, url, oid


def legend_labels(metadata, code_field):
    renderer = metadata.get('drawingInfo', {}).get('renderer', {})
    if renderer.get('field1') != code_field:
        return {}
    labels = {str(item['value']): item['label'] for item in renderer.get('uniqueValueInfos', [])}
    for group in renderer.get('uniqueValueGroups', []):
        for item in group.get('classes', []):
            for value in item.get('values', []):
                if len(value) == 1:
                    labels[str(value[0])] = item['label']
    return labels


def normalize(raw, boundary, spec, metadata, oid):
    zones = gpd.GeoDataFrame.from_features(raw['features'], crs='EPSG:4326').to_crs('EPSG:2285')
    limits = gpd.GeoDataFrame.from_features(boundary['features'], crs='EPSG:4326').to_crs(zones.crs)
    zones.geometry = zones.geometry.make_valid()
    limits.geometry = limits.geometry.make_valid()
    city = limits.geometry.union_all()
    if city.is_empty or city.area <= 0:
        raise ValueError('Empty city boundary.')
    # Reject mismatched jurisdictions/geographic systems, rather than caching no coverage.
    original_area = zones.geometry.union_all().area
    zones.geometry = zones.geometry.intersection(city)
    zones = zones[~zones.geometry.is_empty & zones.geometry.geom_type.isin(['Polygon', 'MultiPolygon'])].copy()
    if zones.empty or zones.geometry.union_all().area < original_area * .5:
        raise ValueError('Zoning and jurisdiction boundary disagree materially.')
    labels = legend_labels(metadata, spec['code'])
    zones['native_code'] = zones[spec['code']].fillna('Unknown').astype(str)
    zones['native_label'] = [str(value).strip() if value is not None and str(value).strip() and str(value) != 'nan'
                             else labels.get(code, code)
                             for value, code in zip(zones[spec['label']] if spec.get('label') else [None]*len(zones), zones.native_code)]
    zones['jurisdiction'] = spec['name']
    zones['source_id'] = zones[oid].map(lambda value: f"{spec['name']}:{value}")
    zones['DETAIL_DESC'] = zones.native_label + ' [' + zones.native_code + '] · ' + spec['name']
    covered = zones.geometry.union_all().area
    audit = {'sourceFeatures': len(raw['features']), 'importedFeatures': len(zones),
             'boundaryCoveredPercent': covered/city.area*100,
             'overlapSquareFeet': max(0, zones.geometry.area.sum()-covered)}
    columns = ['source_id', 'jurisdiction', 'native_code', 'native_label', 'DETAIL_DESC', 'geometry']
    return json.loads(zones[columns].to_crs('EPSG:4326').to_json()), audit


def download(key, session=None, cache_dir=CACHE_DIR):
    spec = sources()[key]
    session = session or requests.Session()
    raw, metadata, url, oid = fetch_layer(session, spec['url'], [field for field in (spec['code'], spec.get('label')) if field])
    boundary, boundary_metadata, boundary_url, _ = fetch_layer(session, spec['boundary'])
    normalized, audit = normalize(raw, boundary, spec, metadata, oid)
    normalized.update(jurisdiction=spec['name'], source=url, boundary_source=boundary_url,
        retrieved_at=datetime.now(timezone.utc).isoformat(), effective_date=None,
        source_editing_info=metadata.get('editingInfo'), copyright=metadata.get('copyrightText'),
        audit=audit, raw_source=raw, raw_boundary=boundary,
        source_metadata=metadata, boundary_metadata=boundary_metadata)
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f'{key}.geojson'
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=cache_dir, suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(normalized, stream, allow_nan=False)
        temporary.replace(target)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('jurisdictions', nargs='+', choices=list(sources()))
    args = parser.parse_args()
    for key in args.jurisdictions:
        print(key, download(key), flush=True)
