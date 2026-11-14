"""Experimental distance-weighted adjacent zoning samples, not parcel frontage."""
import math
import geopandas as gpd
from shapely.geometry import Point
from src import tod

SAMPLE_FEET = 100
OFFSET_FEET = 60


def sample_profile(line, zones, stops):
    """Sample both sides in a feet-based projected CRS; preserve unknown/overlap."""
    if line.is_empty or line.length <= 0:
        return None
    count = min(1200, max(1, math.ceil(line.length / SAMPLE_FEET)))
    step = line.length / count
    index = zones.sindex
    def category(point):
        matches = zones.iloc[list(index.query(point, predicate='intersects'))]
        names = sorted({str(name) for name in matches.DETAIL_DESC.dropna() if str(name).strip()})
        return names[0] if len(names) == 1 else 'Overlapping zoning' if names else 'Unknown / unmapped'
    samples = []
    totals = {}
    for i in range(count):
        distance = (i + .5) * step
        point = line.interpolate(distance)
        before = line.interpolate(max(0, distance - 5))
        after = line.interpolate(min(line.length, distance + 5))
        dx, dy = after.x - before.x, after.y - before.y
        length = math.hypot(dx, dy)
        if length:
            left = category(Point(point.x - dy / length * OFFSET_FEET, point.y + dx / length * OFFSET_FEET))
            right = category(Point(point.x + dy / length * OFFSET_FEET, point.y - dx / length * OFFSET_FEET))
        else:
            left = right = 'Unknown / unmapped'
        samples.append({'left': left, 'right': right})
        for name in (left, right):
            totals[name] = totals.get(name, 0) + step
    display = gpd.GeoSeries([line], crs=zones.crs).to_crs('EPSG:3857').iloc[0]
    distance = 0
    vertices = []
    coords = list(line.coords)
    for i, (x, y) in enumerate(display.coords):
        if i:
            distance += math.dist(coords[i-1], coords[i])
        vertices.append({'distanceFeet': distance, 'x': x, 'y': y})
    ticks = []
    for stop in stops.itertuples():
        if line.distance(stop.geometry) <= 200:
            ticks.append({'id': stop.id, 'name': stop.name, 'distanceFeet': line.project(stop.geometry)})
    return {'lengthFeet': line.length, 'samples': samples, 'vertices': vertices,
            'stops': sorted(ticks, key=lambda tick: tick['distanceFeet']),
            'mix': [{'name': name, 'percent': value / (2 * line.length) * 100}
                    for name, value in sorted(totals.items(), key=lambda pair: -pair[1])]}


def connected_lines(shapes, crs):
    """Join exact endpoint-connected fragments; never bridge gaps or branches."""
    from shapely.ops import linemerge
    lines = list(tod.make_route_lines_gdf(shapes).to_crs(crs).geometry)
    if not lines:
        return []
    merged = linemerge(lines)
    return [merged] if merged.geom_type == 'LineString' else list(merged.geoms)


def ordered_stop_line(shapes, stops, with_distances=False):
    """Trace ordered stops along noded feed geometry, without bridging gaps."""
    import heapq
    from collections import defaultdict
    from shapely.geometry import LineString
    from shapely.ops import unary_union, substring

    if len(stops) < 2 or not shapes:
        return None
    network = unary_union(list(tod.make_route_lines_gdf(shapes).to_crs(stops.crs).geometry))
    edges = [network] if network.geom_type == 'LineString' else list(network.geoms)
    splits = defaultdict(list)
    waypoints = []
    for point in stops.geometry:
        index = min(range(len(edges)), key=lambda i: edges[i].distance(point))
        edge = edges[index]
        if edge.distance(point) > 200:
            return None
        distance = edge.project(point)
        waypoint = tuple(edge.interpolate(distance).coords[0])
        splits[index].append((distance, waypoint))
        waypoints.append(waypoint)
    graph = defaultdict(list)
    for index, edge in enumerate(edges):
        cuts = sorted(set([(0, tuple(edge.coords[0])), (edge.length, tuple(edge.coords[-1]))]
                          + splits[index]))
        for (start, a), (end, b) in zip(cuts, cuts[1:]):
            if end <= start:
                continue
            coordinates = list(substring(edge, start, end).coords)
            graph[a].append((b, end-start, coordinates))
            graph[b].append((a, end-start, coordinates[::-1]))
    coordinates = []
    stop_distances = [0]
    total = 0
    for start, end in zip(waypoints, waypoints[1:]):
        if start == end:
            stop_distances.append(total)
            continue
        queue = [(0, start)]
        distances, previous = {start: 0}, {}
        while queue:
            distance, node = heapq.heappop(queue)
            if distance != distances[node]:
                continue
            if node == end:
                break
            for neighbor, length, geometry in graph[node]:
                cost = distance + length
                if cost < distances.get(neighbor, math.inf):
                    distances[neighbor] = cost
                    previous[neighbor] = (node, geometry)
                    heapq.heappush(queue, (cost, neighbor))
        if end not in previous:
            return None
        total += distances[end]
        stop_distances.append(total)
        pieces, node = [], end
        while node != start:
            node, geometry = previous[node]
            pieces.append(geometry)
        for piece in reversed(pieces):
            coordinates.extend(piece[1:] if coordinates else piece)
    if len(coordinates) < 2:
        return None
    line = LineString(coordinates)
    return (line, stop_distances) if with_distances else line


def retraced_halves(line, distances):
    """Split a feed round trip only when substantial halves retrace a corridor.

    Distances and geometry must use the analysis CRS (feet). Ordinary loops,
    short terminal turns, and remote endpoints are intentionally left alone.
    """
    from shapely.ops import substring
    if len(distances) < 6 or line.length < 4000:
        return None
    start = Point(line.coords[0])
    if start.distance(Point(line.coords[-1])) > 1000:
        return None
    pivot = max(range(1, len(distances)-1),
                key=lambda i: start.distance(line.interpolate(distances[i])))
    distance = distances[pivot]
    if not .25 * line.length < distance < .75 * line.length:
        return None
    a, b = substring(line, 0, distance), substring(line, distance, line.length)
    overlap = min(a.intersection(b.buffer(200)).length/a.length,
                  b.intersection(a.buffer(200)).length/b.length)
    return (pivot, a, b) if overlap >= .7 else None


def route_frontage(route_data, zones):
    raw_stops = tod.make_stops_gdf(route_data['stops']).to_crs(zones.crs)
    paths = []
    path_lines = []
    for grouping in route_data.get('stop_groupings', []):
        if grouping.get('type') != 'direction':
            continue
        for group in grouping.get('stopGroups', []):
            ids = group.get('stopIds', [])
            selected = raw_stops[raw_stops.id.isin(ids)]
            shapes = [shape for shape in group.get('polylines', []) if shape.get('points')]
            lines = connected_lines(shapes, zones.crs)
            ordered = raw_stops.set_index('id').reindex(ids).dropna(subset=['geometry'])
            repeated = len(ids) != len(set(ids))
            trace = ordered_stop_line(shapes, ordered, with_distances=True) if grouping.get('ordered') and (len(lines) > 1 or repeated) else None
            traced = trace[0] if trace is not None else None
            if traced is not None:
                lines = [traced]
            halves = retraced_halves(trace[0], trace[1]) if trace is not None else None
            parts = [(line, selected, trace, '') for line in lines]
            if halves:
                pivot, outbound, inbound = halves
                parts = [(outbound, ordered.iloc[:pivot+1].reset_index(), None, ':outbound'),
                         (inbound, ordered.iloc[pivot:].reset_index(), None, ':return')]
            for line, selected, part_trace, suffix in parts:
                # Match orientation to the feed's stop order when its endpoints distinguish it.
                if not halves and len(ordered) > 1 and grouping.get('ordered'):
                    first, last = ordered.geometry.iloc[0], ordered.geometry.iloc[-1]
                    start, end = Point(line.coords[0]), Point(line.coords[-1])
                    if start.distance(last) + end.distance(first) < start.distance(first) + end.distance(last):
                        from shapely.geometry import LineString
                        line = LineString(list(line.coords)[::-1])
                profile = sample_profile(line, zones, selected)
                if profile:
                    if part_trace is not None and repeated:
                        profile['stops'] = [{'id': stop_id, 'name': row['name'], 'distanceFeet': distance, 'occurrence': index}
                            for index, ((stop_id, row), distance) in enumerate(zip(ordered.iterrows(), part_trace[1]))]
                    label = (group.get('name') or {}).get('name') or 'Feed path'
                    endpoints = []
                    for coordinate in (line.coords[0], line.coords[-1]):
                        distances = raw_stops.distance(Point(coordinate))
                        endpoints.append(str(raw_stops.loc[distances.idxmin(), 'name']) if len(distances) and distances.min() <= 600 else 'Unidentified endpoint')
                    profile.update(id=str(len(paths)), name=f'{endpoints[0]} → {endpoints[1]} · {line.length/5280:.1f} mi',
                                   feedName=label, directionId=str(group.get('id', '')), endpoints=endpoints, traversalPart=suffix,
                                   geographicOrientation=bool(grouping.get('ordered')))
                    path_lines.append(line)
                    paths.append(profile)
        if paths:
            break
    # Keep each shape separate when the feed has no directional shape association.
    if not paths:
        for i, shape in enumerate(route_data.get('polylines', [])):
            if not shape.get('points'):
                continue
            line = tod.make_route_lines_gdf([shape]).to_crs(zones.crs).geometry.iloc[0]
            profile = sample_profile(line, zones, raw_stops)
            if profile:
                profile.update(id=str(i), name=f'Feed shape {i+1} · direction unverified')
                paths.append(profile)
                path_lines.append(line)
    for i, profile in enumerate(paths):
        line = path_lines[i]
        shares = [(line.intersection(other.buffer(60)).length / line.length, j) for j, other in enumerate(path_lines) if j != i and line.length]
        best = max(shares, default=(0, -1))
        profile['relationship'] = ('Mostly shares geometry with another piece' if best[0] >= .8 else 'Partly shares geometry with another piece' if best[0] >= .25 else 'Distinct route section')
        profile['sharedPercent'] = round(best[0]*100)
        profile['relatedPathId'] = paths[best[1]]['id'] if best[1] >= 0 else None
    return {'paths': paths, 'offsetFeet': OFFSET_FEET,
            'method': 'Experimental adjacent-zoning profile: samples 60 ft to each side of the route centerline, about every 100 ft (coarser on long paths). Percentages weight both sides by path distance. This is not measured parcel frontage or observed building use. Unknown areas and overlapping zoning are retained. Ordered stops are traced along connected feed geometry when overlapping fragments are available; disconnected paths are never bridged. Other variants may remain outside the selected profile. Left/right follow the strip from start to end.'}


def combined_route_profiles(primary, continuation):
    """Concatenate directional profiles, retaining an explicit feed join (no invented road)."""
    from shapely.geometry import Point
    combined = []
    for first in primary:
        if not first['vertices']:
            continue
        choices = []
        for other in continuation:
            a, b = first['vertices'], other['vertices']
            forward = Point(a[-1]['x'], a[-1]['y']).distance(Point(b[0]['x'], b[0]['y']))
            backward = Point(b[-1]['x'], b[-1]['y']).distance(Point(a[0]['x'], a[0]['y']))
            choices.extend([(forward, first, other, '43', '44'), (backward, other, first, '44', '43')])
        if not choices:
            continue
        gap, a, b, route_a, route_b = min(choices, key=lambda item: item[0])
        # Web-Mercator metres, deliberately bounded to nearby U District endpoints.
        if gap > 600:
            continue
        total = a['lengthFeet'] + b['lengthFeet']
        samples, vertices, stops, mix = [], [], [], {}
        for part, route, offset in [(a, route_a, 0), (b, route_b, a['lengthFeet'])]:
            for i, sample in enumerate(part['samples']):
                samples.append({**sample, 'startFeet': offset+i*part['lengthFeet']/len(part['samples']),
                                'endFeet': offset+(i+1)*part['lengthFeet']/len(part['samples'])})
            for i, vertex in enumerate(part['vertices']):
                vertices.append({**vertex, 'distanceFeet': offset+vertex['distanceFeet'],
                                 'breakBefore': bool(offset and i == 0)})
            stops.extend({**stop, 'route': route, 'distanceFeet': offset+stop['distanceFeet']} for stop in part['stops'])
            for item in part['mix']:
                mix[item['name']] = mix.get(item['name'], 0)+item['percent']*part['lengthFeet']/total
        combined.append({'id': 'through-'+first['id'], 'name': f'{route_a} → {route_b} · '+('Ballard' if route_b=='44' else 'Capitol Hill / Downtown'),
            'directionId': first.get('directionId'), 'lengthFeet': total, 'samples': samples,
            'vertices': vertices, 'stops': stops, 'mix': [{'name': k, 'percent': v} for k,v in sorted(mix.items(), key=lambda item:-item[1])],
            'sections': [{'route': route_a, 'startFeet': 0, 'endFeet': a['lengthFeet']},
                         {'route': route_b, 'startFeet': a['lengthFeet'], 'endFeet': total}],
            'relationship': '43/44 corridor overview · feed join in U District; trip-specific routing may differ'})
    return combined


def route_overview(route_data, zones, continuation=None):
    """One scrub axis for all unique feed geometry; breaks are not travel links."""
    from shapely.geometry import LineString
    from shapely.ops import unary_union, linemerge
    datasets = [route_data] + ([continuation] if continuation else [])
    shapes = [s for data in datasets for s in data.get('polylines', []) if s.get('points')]
    for data in datasets:
        for grouping in data.get('stop_groupings', []):
            for group in grouping.get('stopGroups', []):
                shapes.extend(s for s in group.get('polylines', []) if s.get('points'))
    if not shapes:
        return {'paths': [], 'missingStopIds': [s['id'] for d in datasets for s in d['stops']]}
    lines = tod.make_route_lines_gdf(shapes).to_crs(zones.crs)
    network = unary_union(list(lines.geometry))
    # Keep the longest feed chain intact; add only geometry it does not cover.
    candidates = list(lines.geometry)
    candidates.sort(key=lambda line: line.length, reverse=True)
    remaining = []
    covered = None
    for line in candidates:
        unique = line if covered is None else line.difference(covered)
        parts = [unique] if unique.geom_type == 'LineString' else list(getattr(unique, 'geoms', []))
        remaining.extend(p for p in parts if p.geom_type == 'LineString' and p.length>0)
        covered = line if covered is None else unary_union([covered,line])
    raw = tod.make_stops_gdf(list({s['id']: s for d in datasets for s in d['stops']}.values())).to_crs(zones.crs)
    # Start with the longest connected chain, then visit the closest remaining end.
    remaining.sort(key=lambda line: line.length, reverse=True)
    ordered = [remaining.pop(0)]
    c = list(ordered[0].coords)
    dx, dy = c[-1][0]-c[0][0], c[-1][1]-c[0][1]
    if (dx if abs(dx)>=abs(dy) else dy)<0:
        ordered[0] = LineString(c[::-1])
    while remaining:
        end = Point(ordered[-1].coords[-1])
        _, index, reverse = min((end.distance(Point(line.coords[-1 if reverse else 0])), i, reverse)
                                for i,line in enumerate(remaining) for reverse in (False,True))
        line = remaining.pop(index)
        ordered.append(LineString(list(line.coords)[::-1]) if reverse else line)
    samples, vertices, stops, sections, totals = [], [], [], [], {}
    offset = 0
    for index,line in enumerate(ordered):
        part = sample_profile(line, zones, raw)
        if not part:
            continue
        length = part['lengthFeet']
        for i,sample in enumerate(part['samples']):
            samples.append({**sample,'startFeet':offset+i*length/len(part['samples']),
                            'endFeet':offset+(i+1)*length/len(part['samples'])})
        vertices.extend({**v,'distanceFeet':offset+v['distanceFeet'], 'breakBefore':i==0 and bool(vertices)}
                        for i,v in enumerate(part['vertices']))
        stops.extend({**s,'distanceFeet':offset+s['distanceFeet']} for s in part['stops'])
        sections.append({'label': 'Section '+str(index+1), 'startFeet':offset,'endFeet':offset+length})
        for item in part['mix']:
            totals[item['name']] = totals.get(item['name'],0)+item['percent']*length
        offset += length
    missing = raw.loc[raw.geometry.distance(network)>200,'id'].tolist()
    profile = {'id':'overview','name':'Route overview','lengthFeet':offset,'vertices':vertices,
               'samples':samples,'stops':stops,'sections':sections if len(sections)>1 else [],
               'mix':[{'name':k,'percent':v/offset} for k,v in totals.items()],
               'relationship':'Unique route geometry; section breaks are not continuous trips',
               'geographicOrientation':True}
    return {'paths':[profile], 'missingStopIds':missing,
            'method':'All unique cached route geometry. Shared segments count once; separate sections have explicit breaks and no invented connecting line. Nearby boarding stops are projected within 200 feet. This is a network overview, not a trip itinerary.'}


def main_route_profile(route_data, zones, physical_stops, continuation=None):
    """One directional spine, never an end-to-end concatenation of variants."""
    from shapely.geometry import LineString
    from shapely.ops import unary_union
    primary = route_frontage(route_data, zones)
    candidates = primary['paths']
    if continuation:
        linked = route_frontage(continuation, zones)
        through = combined_route_profiles(candidates, linked['paths'])
        candidates = through or candidates
    if not candidates:
        return {'paths': [], 'method': 'No continuous cached path available.'}
    candidates = sorted(candidates, key=lambda p:p['lengthFeet'], reverse=True)
    profile = candidates[0].copy()
    owners = {source:stop.id for stop in physical_stops.itertuples() for source in stop.oba_stop_ids}
    seen = set()
    ticks = []
    for tick in sorted(profile['stops'], key=lambda s:s['distanceFeet']):
        owner = owners.get(tick['id'], tick['id'])
        identity = (owner, tick.get('occurrence'))
        if identity in seen:
            continue
        seen.add(identity)
        ticks.append(tick)
    profile['stops'] = ticks
    profile['relationship'] = 'Main directional path; other alignments remain on the map'
    pieces, points = [], []
    for v in profile['vertices']:
        if v.get('breakBefore') and points:
            if len(points)>1:pieces.append(LineString(points))
            points=[]
        points.append((v['x'],v['y']))
    if len(points)>1:pieces.append(LineString(points))
    spine = unary_union(pieces)
    projected = physical_stops.to_crs('EPSG:3857')
    # Coverage disclosure uses geometry, not tick membership: parallel platforms
    # may be represented by a single physical-stop tick.
    outside = projected.loc[projected.distance(spine)>100,'id'].tolist()
    alternatives = []
    for candidate in candidates[1:]:
        seen = set()
        ticks = []
        for tick in candidate['stops']:
            owner = owners.get(tick['id'], tick['id'])
            identity = (owner, tick.get('occurrence'))
            if identity not in seen:
                seen.add(identity)
                ticks.append(tick)
        alternatives.append({**candidate, 'stops': ticks})
    return {'paths':[profile, *alternatives], 'offSpineStopIds':outside,
            'method':'A main directional path with available alternative directions; each physical stop tick is shown once per path. Opposite directions and branches remain visible on the map and in route-wide analysis, but are not appended to scrub distance. A 43/44 overview retains its explicit feed join; it is not a dated trip itinerary.'}
