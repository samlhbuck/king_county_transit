import unittest
import geopandas as gpd
from shapely.geometry import LineString, box, Point
from src.frontage import sample_profile


class FrontageTests(unittest.TestCase):
    def setUp(self):
        self.zones = gpd.GeoDataFrame({'DETAIL_DESC': ['North', 'South']},
            geometry=[box(-10, 20, 300, 100), box(-10, -100, 300, -20)], crs='EPSG:2285')
        self.stops = gpd.GeoDataFrame({'id': ['a', 'b'], 'name': ['Start', 'End']},
            geometry=[Point(0, 0), Point(250, 0)], crs=self.zones.crs)

    def test_sides_distance_and_reverse(self):
        line = LineString([(0, 0), (250, 0)])
        profile = sample_profile(line, self.zones, self.stops)
        self.assertEqual(len(profile['samples']), 3)
        self.assertTrue(all(s == {'left': 'North', 'right': 'South'} for s in profile['samples']))
        self.assertEqual(profile['vertices'][-1]['distanceFeet'], 250)
        self.assertAlmostEqual(sum(row['percent'] for row in profile['mix']), 100)
        reverse = sample_profile(LineString(list(line.coords)[::-1]), self.zones, self.stops)
        self.assertEqual(reverse['samples'][0]['left'], 'South')
        self.assertEqual(reverse['stops'][0]['id'], 'b')

    def test_unknown_and_overlap_are_not_silently_assigned(self):
        line = LineString([(0, 0), (250, 0)])
        empty = self.zones.iloc[:0]
        mix = sample_profile(line, empty, self.stops)['mix']
        self.assertEqual(mix[0]['name'], 'Unknown / unmapped')
        self.assertAlmostEqual(mix[0]['percent'], 100)
        overlap = self.zones.copy()
        overlap.geometry = [box(-10, -100, 300, 100)] * 2
        self.assertEqual(sample_profile(line, overlap, self.stops)['samples'][0]['left'], 'Overlapping zoning')

    def test_cached_route_sections_are_not_presented_as_complete_trips(self):
        import json
        from pathlib import Path
        from src.frontage import route_frontage
        source=Path('data/raw/oba/routes/1_100089.json')
        if not source.exists():
            self.skipTest('Route cache unavailable')
        paths=route_frontage(json.loads(source.read_text()),self.zones.iloc[:0])['paths']
        self.assertEqual(len(paths),2)
        self.assertTrue(all(' → ' in p['name'] and ' mi' in p['name'] for p in paths))
        self.assertTrue(all(p['directionId'] in ('0','1') for p in paths))
        self.assertTrue(all(p['lengthFeet']>0 for p in paths))
        self.assertTrue(all(0 <= p['sharedPercent'] <= 100 for p in paths))

    def test_combined_profile_preserves_distances_and_join(self):
        from src.frontage import combined_route_profiles
        a=sample_profile(LineString([(0,0),(100,0)]),self.zones,self.stops)
        b=sample_profile(LineString([(100,0),(300,0)]),self.zones,self.stops)
        a.update(id='a',directionId='out');b.update(id='b')
        profiles=combined_route_profiles([a],[b])
        self.assertEqual(len(profiles),1)
        p=profiles[0]
        self.assertEqual(p['lengthFeet'],300)
        self.assertEqual(p['sections'][1]['startFeet'],100)
        self.assertTrue(any(v['breakBefore'] for v in p['vertices']))
        self.assertAlmostEqual(sum(x['percent'] for x in p['mix']),100)
        self.assertEqual(p['samples'][-1]['endFeet'],300)

class ConnectedFragmentTests(unittest.TestCase):
    def test_ordered_trace_retains_repeated_stop_occurrences(self):
        from src.frontage import ordered_stop_line
        from unittest.mock import patch
        lines=gpd.GeoDataFrame(geometry=[LineString([(0,0),(300,0)])],crs='EPSG:2285')
        stops=gpd.GeoDataFrame(geometry=[Point(0,0),Point(100,0),Point(0,0),Point(300,0)],crs=lines.crs)
        with patch('src.frontage.tod.make_route_lines_gdf',return_value=lines):
            line, distances=ordered_stop_line([{}],stops,with_distances=True)
        self.assertEqual(distances,[0,100,200,500])
        self.assertEqual(line.length,500)

    def test_ordered_stops_trace_overlaps_and_leave_short_branch(self):
        from src.frontage import ordered_stop_line
        from unittest.mock import patch
        lines = gpd.GeoDataFrame(geometry=[LineString([(0,0),(150,0)]),
            LineString([(100,0),(300,0)]), LineString([(150,0),(150,40)])], crs='EPSG:2285')
        stops = gpd.GeoDataFrame(geometry=[Point(0,0),Point(200,0),Point(300,0)],crs=lines.crs)
        with patch('src.frontage.tod.make_route_lines_gdf',return_value=lines):
            result=ordered_stop_line([{}],stops)
        self.assertAlmostEqual(result.length,300)
        self.assertEqual(list(result.coords)[0],(0,0))
        self.assertEqual(list(result.coords)[-1],(300,0))

    def test_ordered_stops_do_not_bridge_disconnected_geometry(self):
        from src.frontage import ordered_stop_line
        from unittest.mock import patch
        lines=gpd.GeoDataFrame(geometry=[LineString([(0,0),(100,0)]),
            LineString([(110,0),(300,0)])],crs='EPSG:2285')
        stops=gpd.GeoDataFrame(geometry=[Point(0,0),Point(300,0)],crs=lines.crs)
        with patch('src.frontage.tod.make_route_lines_gdf',return_value=lines):
            self.assertIsNone(ordered_stop_line([{}],stops))

    def test_connected_fragments_join_without_inventing_gap(self):
        from src.frontage import connected_lines
        from unittest.mock import patch
        from shapely.geometry import LineString
        lines = gpd.GeoDataFrame(geometry=[LineString([(1,0),(2,0)]),LineString([(0,0),(1,0)]),LineString([(5,0),(6,0)])],crs='EPSG:2285')
        with patch('src.frontage.tod.make_route_lines_gdf',return_value=lines):
            result=connected_lines([],lines.crs)
        self.assertEqual(sorted(line.length for line in result),[1,2])

class OverviewCoverageTests(unittest.TestCase):
    def test_cached_routes_retain_all_geometry(self):
        from src import oba, tod
        from src.frontage import route_overview
        from shapely.ops import unary_union
        from pathlib import Path
        zones=gpd.GeoDataFrame({'DETAIL_DESC':[]},geometry=[],crs=tod.ANALYSIS_CRS)
        for route in ['1_100161','1_100447','1_100223']:
            if not Path('data/raw/oba/routes/'+route+'.json').exists():
                continue
            data=oba.load_route_data(route)
            linked=oba.load_route_data('1_100224') if route=='1_100223' else None
            overview=route_overview(data,zones,linked)
            profile=overview['paths'][0]
            segments=[];chain=[]
            for v in profile['vertices']:
                if v.get('breakBefore') and chain:
                    if len(chain)>1:segments.append(LineString(chain))
                    chain=[]
                chain.append((v['x'],v['y']))
            if len(chain)>1:segments.append(LineString(chain))
            actual=unary_union(segments)
            expected=tod.make_route_lines_gdf(data['polylines']+(linked['polylines'] if linked else [])).to_crs('EPSG:3857')
            self.assertLess(unary_union(list(expected.geometry)).difference(actual.buffer(.01)).length,.1)
            self.assertEqual(overview['missingStopIds'],[])
            self.assertAlmostEqual(sum(s['endFeet']-s['startFeet'] for s in profile['samples']),profile['lengthFeet'])

class MainSpineTests(unittest.TestCase):
    def test_217_main_path_spans_its_ordered_stops(self):
        from pathlib import Path
        from src import oba,tod
        from src.frontage import route_frontage
        if not Path('data/raw/oba/routes/20_217.json').exists():
            self.skipTest('Route 217 cache unavailable')
        data=oba.load_route_data('20_217')
        zones=gpd.GeoDataFrame({'DETAIL_DESC':[]},geometry=[],crs=tod.ANALYSIS_CRS)
        paths=route_frontage(data,zones)['paths']
        self.assertEqual(len(paths),2)
        for profile,group in zip(paths,data['stop_groupings'][0]['stopGroups']):
            self.assertGreater(profile['lengthFeet'],45000)
            self.assertEqual({s['id'] for s in profile['stops']},set(group['stopIds']))
            self.assertEqual(profile['stops'][0]['id'],group['stopIds'][0])
            self.assertEqual(profile['stops'][-1]['id'],group['stopIds'][-1])

    def test_43_through_spine_has_unique_physical_stops(self):
        from pathlib import Path
        from src import oba,tod
        from src.frontage import main_route_profile
        from src.route_explorer import analysis_route_data
        if not Path('data/raw/oba/routes/1_100223.json').exists():
            self.skipTest('Route cache unavailable')
        primary=oba.load_route_data('1_100223');linked=oba.load_route_data('1_100224')
        stops=tod.make_physical_stops_gdf(analysis_route_data(primary,linked))
        zones=gpd.GeoDataFrame({'DETAIL_DESC':[]},geometry=[],crs=tod.ANALYSIS_CRS)
        profile=main_route_profile(primary,zones,stops,linked)['paths'][0]
        owners={source:s.id for s in stops.itertuples() for source in s.oba_stop_ids}
        ticks=[owners[s['id']] for s in profile['stops']]
        self.assertEqual(len(ticks),len(set(ticks)))
        self.assertTrue(profile['id'].startswith('through-'))
        self.assertEqual({s['route'] for s in profile['sections']},{'43','44'})


class RetracedTraversalTests(unittest.TestCase):
    def test_out_and_back_is_split_but_loop_is_not(self):
        from src.frontage import retraced_halves
        line=LineString([(0,0),(6000,0),(6000,100),(0,100)])
        result=retraced_halves(line,[0,2000,4000,6000,8100,10100,12100])
        self.assertIsNotNone(result)
        self.assertEqual(result[0],3)
        loop=LineString([(0,0),(6000,0),(6000,6000),(0,6000),(0,0)])
        self.assertIsNone(retraced_halves(loop,[0,4000,8000,12000,16000,20000,24000]))

    def test_cached_g_line_does_not_append_return_trip(self):
        from src import oba, tod
        from src.frontage import route_frontage
        zones=gpd.GeoDataFrame({'DETAIL_DESC':[]},geometry=[],crs=tod.ANALYSIS_CRS)
        paths=route_frontage(oba.load_route_data('1_102745'),zones)['paths']
        self.assertEqual(len(paths),2)
        for path in paths:
            self.assertGreater(path['lengthFeet'],10000)
            self.assertLess(path['lengthFeet'],14000)
            self.assertEqual(len(path['stops']),11)
