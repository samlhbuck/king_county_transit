"""Departure preference must preserve coverage and bounded walking distances."""
import unittest
import geopandas as gpd
from shapely.geometry import Point
from shapely.ops import unary_union
from src import oba, tod
from src.catchments import ownership_areas
from src.departure_access import departure_cells, EXTRA_WALK_FEET
from src.directional_access import access_model, assign_access


class DepartureAccessTests(unittest.TestCase):
    def cells(self, coordinates, radius=1760):
        stops = gpd.GeoDataFrame({'id':list(map(str,range(len(coordinates))))},
            geometry=[Point(*p) for p in coordinates], crs=tod.ANALYSIS_CRS)
        corridor = unary_union(stops.geometry.buffer(radius, resolution=128))
        nearest = ownership_areas(stops, corridor)
        return stops, nearest, departure_cells(stops, nearest, radius)

    def test_bend_prefers_downstream_without_coverage_loss(self):
        stops, nearest, cells = self.cells([(0,0),(0,1000),(1000,1000),(1000,0)])
        self.assertTrue(nearest.geometry.iloc[0].covers(Point(450,0)))
        self.assertTrue(cells.geometry.iloc[3].covers(Point(450,0)))
        self.assertTrue(cells.geometry.iloc[0].covers(Point(0,0)))
        self.assertLess(unary_union(nearest.geometry).symmetric_difference(unary_union(cells.geometry)).area, .01)
        for i, cell in enumerate(cells.geometry):
            for other in cells.geometry.iloc[i+1:]:
                self.assertLess(cell.intersection(other).area,.01)
        for x in range(-1700,2800,100):
            for y in range(-1700,2800,100):
                point=Point(x,y)
                distances=stops.distance(point)
                for i,cell in enumerate(cells.geometry):
                    if cell.covers(point):
                        self.assertLessEqual(distances.iloc[i],1760+.001)
                        self.assertLessEqual(distances.iloc[i]-distances.min(),EXTRA_WALK_FEET+.001)

    def test_straight_route_and_terminal_do_not_reassign(self):
        _, nearest, cells = self.cells([(0,0),(1000,0),(2000,0)])
        for before, after in zip(nearest.geometry,cells.geometry):
            self.assertTrue(before.equals(after))
        _, _, cells = self.cells([(0,0),(0,1000),(1000,1000),(1000,0)])
        self.assertTrue(cells.geometry.iloc[3].covers(Point(600,0)))

    def test_coincident_stops_and_empty_cells(self):
        _, nearest, cells = self.cells([(0,0),(0,0),(0,1000),(1000,1000),(1000,0)])
        self.assertTrue(cells.geometry.iloc[1].is_empty)
        self.assertLess(unary_union(nearest.geometry).symmetric_difference(unary_union(cells.geometry)).area,.01)

    def test_209_12th_avenue_departures(self):
        route=oba.load_route_data('23_102638')
        physical=tod.make_physical_stops_gdf(route)
        model=access_model(route,physical,1760)
        project=gpd.GeoDataFrame(geometry=[Point(-122.31756917,47.6006899)],crs=4326)
        assignments=assign_access(project,model).StopAssignments.iloc[0]
        names=physical.set_index('id').name
        actual={d['name']:names[assignments[d['id']]] for d in model['directions']}
        self.assertEqual(actual,{'Capitol Hill':'Yesler & Broadway','Pioneer Square':'12th & Jackson'})

    def test_cached_route_geometry_partitions_including_route_8(self):
        for route_id in ['1_100275','1_102745','1_100089','40_100479','40_2LINE']:
            with self.subTest(route=route_id):
                route=oba.load_route_data(route_id)
                physical=tod.make_physical_stops_gdf(route)
                model=access_model(route,physical,1760)
                for direction,stops in model['candidates'].items():
                    regions=list(model['areas'][direction].values())
                    expected=unary_union(stops.geometry.buffer(1760,resolution=128))
                    # A millionth-foot overlay grid can move shared edges slightly.
                    self.assertLess(unary_union(regions).symmetric_difference(expected).area,1)
                    self.assertTrue(all(region.is_valid for region in regions))
                    self.assertLess(sum(region.area for region in regions)-unary_union(regions).area,1)
