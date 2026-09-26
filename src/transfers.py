"""Read-only transfer hints from cached boarding locations; no walk-time claims."""
import json
from src import oba, tod

MODES = {0:'Tram / light rail',1:'Metro',2:'Rail',3:'Bus',4:'Ferry',5:'Cable tram',6:'Aerial lift',7:'Funicular',11:'Trolleybus',12:'Monorail'}


def stop_transfers(route_data, physical_stops, catalog, nearby_feet=660):
    locations = {}
    metadata = {r['route_id']: dict(r) for r in catalog}
    destinations = {}
    cached = []
    for path in sorted(oba.ROUTE_DATA_DIR.glob('*.json')):
        try:
            cached.append(json.loads(path.read_text()))
        except (OSError, ValueError):
            continue
    for data in [*cached, route_data]:
        route = data['route_id']
        for reference in data.get('route_references', []):
            metadata.setdefault(reference['id'], {}).update(reference)
        for stop in data.get('stops', []):
            previous = locations.get(stop['id'], {})
            locations[stop['id']] = {**stop, 'routeIds': sorted(set(previous.get('routeIds', [])) | set(stop.get('routeIds', [])) | {route})}
        for grouping in data.get('stop_groupings', []):
            if grouping.get('type') != 'direction':
                continue
            for group in grouping.get('stopGroups', []):
                label = (group.get('name') or {}).get('name')
                if label:
                    for stop in group.get('stopIds', []):
                        destinations.setdefault((route, stop), set()).add(label)
    points = tod.make_stops_gdf(list(locations.values())).to_crs(tod.ANALYSIS_CRS)
    result = {}
    for physical in physical_stops.itertuples():
        source_ids = set(physical.oba_stop_ids)
        sources = points[points.id.isin(source_ids)]
        origin = sources.geometry.union_all()
        candidates = points.iloc[points.sindex.query(origin.buffer(nearby_feet), predicate='intersects')]
        matches = {}
        for stop in candidates.itertuples():
            distance = stop.geometry.distance(origin)
            for route in stop.routeIds:
                if route == route_data['route_id']:
                    continue
                same = stop.id in source_ids
                entry = matches.setdefault(route, {'routeId':route,'sameStop':False,'distanceFeet':float('inf'),'destinations':set(),'boardingStops':set(),'boardingLocations':[]})
                entry['sameStop'] |= same
                entry['distanceFeet'] = min(entry['distanceFeet'], distance)
                entry['destinations'].update(destinations.get((route,stop.id), set()))
                entry['boardingStops'].add(stop.name)
                entry['boardingLocations'].append({'id':stop.id, 'name':stop.name,
                    'sameStop':same, 'distanceFeet':round(distance),
                    'destinations':sorted(destinations.get((route,stop.id), set()))})
        rows=[]
        for route, entry in matches.items():
            info=metadata.get(route,{})
            entry.update(name=info.get('name') or info.get('shortName') or route,
                         description=info.get('description') or info.get('long_name') or info.get('longName') or '',
                         mode=MODES.get(info.get('type'), 'Type not cached'),
                         distanceFeet=round(entry['distanceFeet']),
                         destinations=sorted(entry['destinations']),boardingStops=sorted(entry['boardingStops']))
            entry['boardingLocations'].sort(key=lambda stop:(not stop['sameStop'],stop['distanceFeet'],stop['id']))
            rows.append(entry)
        result[physical.id]=sorted(rows,key=lambda row:(not row['sameStop'],row['distanceFeet'],row['name']))
    return {'stops':result,'note':'Other routes at these boarding stops or within 660 straight-line feet. Nearby results cover cached routes only; walking paths, access barriers and live service are not verified. Destinations are shown only when cached for those boarding stops.'}
