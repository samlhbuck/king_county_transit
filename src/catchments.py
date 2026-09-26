"""Nearest-stop ownership polygons, clipped to the existing analysis corridor.

Uses projected half-plane intersections (Voronoi cells), not walking isochrones.
Coincident stations and equidistant project points follow source stop order,
matching tod.assign_nearest_stop's first-minimum tie break.
"""
import geopandas as gpd
from shapely.geometry import Polygon


def ownership_areas(stops, corridor):
    if stops.empty:
        raise ValueError('Ownership areas require at least one stop.')
    bounds = corridor.bounds
    envelope = [(bounds[0], bounds[1]), (bounds[2], bounds[1]),
                (bounds[2], bounds[3]), (bounds[0], bounds[3])]
    locations = [(point.x, point.y) for point in stops.geometry]
    areas = []
    for i, (x, y) in enumerate(locations):
        vertices = list(envelope)
        for j, (other_x, other_y) in enumerate(locations):
            if i == j:
                continue
            dx, dy = other_x - x, other_y - y
            if dx == 0 and dy == 0:
                if j < i:
                    vertices = []
                    break
                continue
            mx, my = (x + other_x) / 2, (y + other_y) / 2
            # Signed distance without normalization, computed relative to the
            # bisector midpoint to avoid cancellation in state-plane coordinates.
            def signed(point):
                return (point[0] - mx) * dx + (point[1] - my) * dy
            clipped = []
            for a, b in zip(vertices, vertices[1:] + vertices[:1]):
                da, db = signed(a), signed(b)
                if da <= 0:
                    clipped.append(a)
                if (da <= 0) != (db <= 0):
                    t = da / (da - db)
                    clipped.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
            vertices = clipped
            if len(vertices) < 3:
                break
        polygon = Polygon(vertices).intersection(corridor) if len(vertices) >= 3 else Polygon()
        areas.append(polygon)
    return gpd.GeoDataFrame({'id': stops['id'].tolist()}, geometry=areas, crs=stops.crs)
