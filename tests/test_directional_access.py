import unittest
import geopandas as gpd
from shapely.geometry import Point
from shapely.ops import unary_union
from src import tod
from src.directional_access import access_model, assign_access


class DirectionalAccessTests(unittest.TestCase):
    def model(self, coincident=False):
        # Two sides of a U: one reachable boarding location per direction.
        points = gpd.GeoSeries([Point(0, 0), Point(2000, 0), Point(0 if coincident else 1000, 0)], crs=tod.ANALYSIS_CRS).to_crs(4326)
        stops = [{'id': str(i), 'name': f'Stop {i}', 'lon': p.x, 'lat': p.y} for i, p in enumerate(points)]
        route = {'stops': stops, 'stop_groupings': [{'type': 'direction', 'stopGroups': [
            {'id':'out','name':{'name':'Outbound'},'stopIds':['0','1']},
            {'id':'back','name':{'name':'Inbound'},'stopIds':['2']}]}]}
        physical = gpd.GeoDataFrame({'id':['a','b','c'], 'oba_stop_ids':[['0'],['1'],['2']]}, geometry=[Point(0,0),Point(2000,0),Point(1000,0)], crs=tod.ANALYSIS_CRS)
        return access_model(route, physical, 1320)

    def test_u_shape_two_assignments_and_cutoff(self):
        model = self.model()
        projects = gpd.GeoDataFrame(geometry=[Point(500,0),Point(-1000,0),Point(9000,0)], crs=tod.ANALYSIS_CRS)
        assignments = assign_access(projects, model).StopAssignments.tolist()
        self.assertEqual(set(assignments[0].values()), {'a','c'})
        self.assertEqual(set(assignments[1].values()), {'a'})
        self.assertEqual(assignments[2], {})
        for point, assignment in zip(projects.geometry, assignments):
            for direction, stop in assignment.items():
                self.assertTrue(model['areas'][direction][stop].buffer(.01).covers(point))

    def test_direction_cells_partition_reachable_area(self):
        model = self.model()
        for direction, stops in model['candidates'].items():
            cells = list(model['areas'][direction].values())
            expected = unary_union(stops.geometry.buffer(1320, resolution=128))
            self.assertLess(unary_union(cells).symmetric_difference(expected).area, .01)
            for i, cell in enumerate(cells):
                for other in cells[i+1:]:
                    self.assertLess(cell.intersection(other).area, .01)

    def test_colocated_opposite_directions_remain_available(self):
        model = self.model(coincident=True)
        project = gpd.GeoDataFrame(geometry=[Point(10,0)], crs=tod.ANALYSIS_CRS)
        self.assertEqual(len(assign_access(project,model).StopAssignments.iloc[0]), 2)

    def test_near_radius_edge_matches_polygon(self):
        model = self.model()
        projects = gpd.GeoDataFrame(geometry=[Point(-1319.99, 0), Point(-1320.01, 0)], crs=tod.ANALYSIS_CRS)
        rows = assign_access(projects, model).StopAssignments.tolist()
        self.assertEqual(set(rows[0].values()), {'a'})
        self.assertEqual(rows[1], {})

    def test_missing_group_is_explicit(self):
        route = {'stops':[{'id':'x','name':'X','lat':47.6,'lon':-122.3}], 'stop_groupings':[]}
        physical = tod.make_stops_gdf([{'id':'p','name':'X','lat':47.6,'lon':-122.3,'oba_stop_ids':['x']}])
        model = access_model(route, physical, 1320)
        self.assertEqual(model['directions'][0]['name'], 'Direction unavailable')
        self.assertIn('incomplete', model['note'])
