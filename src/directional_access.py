"""Straight-line access per feed direction; physical grouping stays independent."""
import geopandas as gpd
from shapely.geometry import Polygon
from shapely.ops import unary_union
from src.catchments import ownership_areas
from src import tod
from src.departure_access import departure_cells


def access_model(route_data, physical_stops, radius):
    raw = tod.make_stops_gdf(route_data['stops']).to_crs(tod.ANALYSIS_CRS)
    raw = raw.drop_duplicates('id').reset_index(drop=True)
    owners = {source: row.id for row in physical_stops.itertuples() for source in row.oba_stop_ids}
    groups = []
    covered = set()
    for grouping in route_data.get('stop_groupings', []):
        if grouping.get('type') != 'direction':
            continue
        for group in grouping.get('stopGroups', []):
            ids = list(dict.fromkeys(id for id in group.get('stopIds', []) if id in set(raw.id)))
            if not ids:
                continue
            covered.update(ids)
            name = group.get('name') or {}
            groups.append((str(group.get('id', len(groups))), name.get('name', 'Destination group'), ids))
        # Alternative grouping schemes must not duplicate the assignment universe.
        if groups:
            break
    missing = set(raw.id) - covered
    if missing:
        groups.append(('unclassified', 'Direction unavailable', sorted(missing)))
    directions, candidates, areas = [], {}, {}
    for index, (key, label, ids) in enumerate(groups):
        key = f'{index}:{key}'
        stops = raw.set_index('id', drop=False).loc[list(ids)].copy().reset_index(drop=True)
        corridor = unary_union(stops.geometry.buffer(radius, resolution=128))
        cells = ownership_areas(stops, corridor)
        if not key.endswith(':unclassified'):
            cells = departure_cells(stops, cells, radius)
        cells['physical'] = cells.id.map(owners)
        areas[key] = {stop: unary_union(list(part.geometry)) for stop, part in cells.groupby('physical')}
        directions.append({'id': key, 'name': label, 'stopOrder': list(dict.fromkeys(owners[id] for id in ids))})
        candidates[key] = stops
    combined = {stop: unary_union([a[stop] for a in areas.values() if stop in a]) for stop in physical_stops.id}
    areas['all'] = combined
    return {'directions': directions, 'candidates': candidates, 'areas': areas,
            'owners': owners, 'radius': radius,
            'note': 'Departure access prefers downstream boarding around substantial bends, within 330 extra straight-line feet and the existing radius. No walking paths or travel times are modeled. Assignments use cached destination groups; branches may have additional groups. '
                    + ('Direction coverage is incomplete or unclassified.' if len(groups) < 2 or missing else '')}


def assign_access(frame, model):
    result = frame.to_crs(tod.ANALYSIS_CRS).copy()
    assignments = [{} for _ in range(len(result))]
    for direction in model['candidates']:
        regions = model['areas'][direction]
        cells = gpd.GeoDataFrame({'id': list(regions)}, geometry=list(regions.values()), crs=tod.ANALYSIS_CRS)
        for assignment, point in zip(assignments, result.geometry):
            hits = cells.sindex.query(point, predicate='intersects')
            if len(hits):
                assignment[direction] = cells.iloc[min(hits)].id
    result['StopAssignments'] = assignments
    return result


def area_frame(model, physical_stops, direction='all'):
    return gpd.GeoDataFrame({'id': physical_stops.id.tolist()},
        geometry=[model['areas'][direction].get(id, Polygon()) for id in physical_stops.id],
        crs=tod.ANALYSIS_CRS)
