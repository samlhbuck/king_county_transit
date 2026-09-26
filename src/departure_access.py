"""Bounded downstream preference at route bends, without claiming travel times."""
from shapely.geometry import Polygon
from shapely.ops import unary_union

EXTRA_WALK_FEET = 330
MIN_DETOUR_FEET = 660
MAX_STOPS_AHEAD = 4
# Sub-millimetre snap grid avoids GEOS overlay failures on near-coincident edges.
OVERLAY_GRID_FEET = 0.000001


def preference_halfplane(bounds, upstream, downstream):
    """d_down² - d_up² <= extra * separation implies d_down-d_up <= extra.

    A conservative linear bound, because d_down+d_up >= separation. Coordinates
    relative to the midpoint avoid cancellation with state-plane coordinates.
    """
    dx, dy = downstream.x-upstream.x, downstream.y-upstream.y
    distance = upstream.distance(downstream)
    mx, my = (upstream.x+downstream.x)/2, (upstream.y+downstream.y)/2
    def signed(p):
        return -2*((p[0]-mx)*dx+(p[1]-my)*dy)-EXTRA_WALK_FEET*distance
    x0,y0,x1,y1 = bounds
    vertices = [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]
    clipped = []
    for a,b in zip(vertices,vertices[1:]+vertices[:1]):
        da,db = signed(a),signed(b)
        if da <= 0:
            clipped.append(a)
        if (da<=0) != (db<=0):
            t=da/(da-db)
            clipped.append((a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])))
    return Polygon(clipped) if len(clipped)>=3 else Polygon()


def departure_cells(stops, cells, radius):
    """Reallocate portions of nearest-stop cells; no overlap or added coverage.

    Use only locally ordered destination groups. Never wrap terminal-to-origin.
    The sum of consecutive stop distances is a conservative route-length proxy.
    """
    points = list(stops.geometry)
    cumulative = [0]
    for a,b in zip(points,points[1:]):
        cumulative.append(cumulative[-1]+a.distance(b))
    pieces = [[] for _ in points]
    for i, cell in enumerate(cells.geometry):
        # Edge-only contacts are not access areas; strip lower-dimensional parts.
        remaining = cell.buffer(0)
        for j in range(min(len(points)-1,i+MAX_STOPS_AHEAD),i,-1):
            direct = points[i].distance(points[j])
            along = cumulative[j]-cumulative[i]
            if direct == 0 or along < direct*1.5 or along-direct < MIN_DETOUR_FEET:
                continue
            if remaining.is_empty:
                break
            preferred = remaining.intersection(points[j].buffer(radius,resolution=128), grid_size=OVERLAY_GRID_FEET).buffer(0).intersection(
                preference_halfplane(cell.bounds,points[i],points[j]), grid_size=OVERLAY_GRID_FEET).buffer(0)
            pieces[j].append(preferred)
            remaining = remaining.difference(preferred, grid_size=OVERLAY_GRID_FEET).buffer(0)
        pieces[i].append(remaining)
    result = cells.copy()
    result.geometry = [unary_union(part) for part in pieces]
    return result
