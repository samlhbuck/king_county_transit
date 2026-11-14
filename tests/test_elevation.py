import json
import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from src import elevation


class ElevationTests(unittest.TestCase):
    def profile(self):
        return {'id':'a','lengthFeet':300,'vertices':[
            {'x':-13620000,'y':6040000,'distanceFeet':0},
            {'x':-13619900,'y':6040000,'distanceFeet':100},
            {'x':-13619000,'y':6040000,'distanceFeet':100,'breakBefore':True},
            {'x':-13618800,'y':6040000,'distanceFeet':300}],
            'stops':[{'id':'stop','distanceFeet':175}]}

    def test_sampling_includes_stop_and_never_bridges_gap(self):
        points, step=elevation.sample_locations(self.profile())
        self.assertEqual(step,100)
        self.assertIn(175,[p['distanceFeet'] for p in points])
        self.assertEqual(sum(p['breakBefore'] for p in points),1)
        self.assertEqual([p['distanceFeet'] for p in points].count(100),2)
        self.assertTrue(all(-123<p['lon']<-122 for p in points))

    def test_missing_and_invalid_elevation_stay_null_including_real_zero(self):
        for raw, expected in [('0',0),('-1000000',None),('NaN',None),('bad',None),(None,None)]:
            response=Mock();response.json.return_value={'value':raw}
            with patch.object(elevation.requests,'get',return_value=response):
                result=elevation.query_point({'lon':-122,'lat':47})
            self.assertEqual(result['elevationMeters'],expected)

    def test_cache_is_offline_and_invalidated_by_stop_or_geometry_change(self):
        p=self.profile()
        with tempfile.TemporaryDirectory() as folder, patch.object(elevation,'CACHE',Path(folder)),patch.object(elevation.requests,'get',side_effect=AssertionError('Network forbidden')):
            record={'version':elevation.VERSION,'geometryHash':elevation.signature(p),'samples':[]}
            elevation.cache_file('route',p).write_text(json.dumps(record))
            self.assertEqual(elevation.load_cached('route',p),record)
            p['stops'][0]['distanceFeet']=176
            self.assertIsNone(elevation.load_cached('route',p))

    def test_failed_refresh_preserves_old_snapshot(self):
        p=self.profile()
        with tempfile.TemporaryDirectory() as folder,patch.object(elevation,'CACHE',Path(folder)):
            path=elevation.cache_file('route',p);path.write_text('old snapshot')
            with patch.object(elevation,'query_locations',side_effect=RuntimeError('Service failure')):
                with self.assertRaises(RuntimeError):elevation.prepare_profile('route',p,refresh=True)
            self.assertEqual(path.read_text(),'old snapshot')

    def test_cache_survives_cross_platform_projection_roundoff(self):
        original = self.profile()
        linux = copy.deepcopy(original)
        linux['vertices'][0]['y'] += 4e-9
        linux['stops'][0]['distanceFeet'] += 6e-9
        self.assertEqual(elevation.signature(original), elevation.signature(linux))
        linux['vertices'][0]['y'] += 0.1
        self.assertNotEqual(elevation.signature(original), elevation.signature(linux))

    def test_legacy_snapshot_upgrades_without_network_or_changed_provenance(self):
        p = self.profile()
        with tempfile.TemporaryDirectory() as folder, patch.object(elevation, 'CACHE', Path(folder)), patch.object(elevation.requests, 'get', side_effect=AssertionError('Network forbidden')):
            digest = elevation.signature(p, legacy=True)
            key = hashlib.sha256(('route' + digest).encode()).hexdigest()
            record = {'version': elevation.VERSION, 'geometryHash': digest,
                      'retrievedAt': 'original date', 'samples': [{'elevationMeters': 42}]}
            (Path(folder) / (key + '.json')).write_text(json.dumps(record))
            upgraded = elevation.prepare_profile('route', p)
            self.assertEqual(upgraded['retrievedAt'], record['retrievedAt'])
            self.assertEqual(upgraded['samples'], record['samples'])
            self.assertEqual(upgraded['geometryHash'], elevation.signature(p))
            self.assertTrue(elevation.cache_file('route', p).exists())
            linux = copy.deepcopy(p)
            linux['vertices'][0]['y'] += 4e-9
            self.assertEqual(elevation.load_cached('route', linux), upgraded)

    def test_batch_continues_after_failure_and_resumes_completed_profiles(self):
        p = self.profile()
        def build(route):
            if route == 'broken':
                raise ValueError('No geometry')
            return {'zoning': {'frontage': {'paths': [p]}}}
        with tempfile.TemporaryDirectory() as folder, patch.object(elevation, 'CACHE', Path(folder)):
            record = {'version': elevation.VERSION, 'geometryHash': elevation.signature(p),
                      'samples': [{'elevationMeters': 0}]}
            elevation.cache_file('good', p).write_text(json.dumps(record))
            with patch.object(elevation.requests, 'get', side_effect=AssertionError('Network forbidden')):
                results = elevation.prepare_routes(['broken', 'good', 'good'], build=build,
                                                    report=Path(folder) / 'report.json')
            self.assertEqual([r['status'] for r in results], ['failed', 'cached'])
            self.assertEqual(results[1]['availableSamples'], 1)
            self.assertEqual(len(json.loads((Path(folder) / 'report.json').read_text())['profiles']), 2)

    def test_batch_dry_run_does_not_fetch_elevation(self):
        build = lambda route: {'zoning': {'frontage': {'paths': [self.profile()]}}}
        with tempfile.TemporaryDirectory() as folder, patch.object(elevation, 'CACHE', Path(folder)), patch.object(elevation, 'prepare_profile', side_effect=AssertionError('Retrieval forbidden')):
            result = elevation.prepare_routes(['route'], build=build, dry_run=True)
            self.assertEqual(result[0]['status'], 'pending')
            self.assertGreater(result[0]['sampleCount'], 0)

    def test_multipoint_matches_by_location_id_and_preserves_missing_coverage(self):
        points = [{'lon': -122.32, 'lat': 47.61, 'distanceFeet': x} for x in [0, 100, 200]]
        response = Mock()
        response.json.return_value = {'samples': [
            {'locationId': 2, 'location': {'x': -122.32, 'y': 47.61}, 'value': '-1000000'},
            {'locationId': 0, 'location': {'x': -122.32, 'y': 47.61}, 'value': '0'}]}
        with patch.object(elevation.requests, 'post', return_value=response):
            result = elevation.query_batch(points)
            self.assertEqual([p['elevationMeters'] for p in result], [0, None, None])
            response.json.return_value['samples'][0]['locationId'] = 0
            with self.assertRaises(ValueError): elevation.query_batch(points)

    def test_multipoint_retries_transient_service_errors(self):
        point = {'lon': -122.32, 'lat': 47.61}
        failed = Mock(status_code=502)
        error = elevation.requests.HTTPError(response=failed)
        success = Mock()
        success.json.return_value = {'samples': []}
        with patch.object(elevation.requests, 'post', side_effect=[error, success]) as get, patch.object(elevation.time, 'sleep'):
            self.assertIsNone(elevation.query_batch([point])[0]['elevationMeters'])
            self.assertEqual(get.call_count, 2)

    def test_multipoint_provenance_avoids_redundant_model_requests(self):
        sample = {'elevationMeters': 12, 'rasterId': 7,
                  'modelAttributes': {'Name': 'DEM', 'VerticalDatum': 'NAVD88'}}
        with tempfile.TemporaryDirectory() as folder, patch.object(elevation, 'CACHE', Path(folder)), patch.object(elevation, 'query_locations', return_value=[sample]), patch.object(elevation.requests, 'get', side_effect=AssertionError('Redundant query')):
            result = elevation.prepare_profile('route', self.profile())
            self.assertEqual(result['models'], [{'rasterId': 7, 'Name': 'DEM', 'VerticalDatum': 'NAVD88'}])
            self.assertNotIn('modelAttributes', result['samples'][0])

    def test_geographic_raster_resolution_is_not_labelled_metres(self):
        result = elevation.parse_sample({'lon': -122, 'lat': 47},
                                        {'value': '12', 'resolution': 1 / 10800})
        self.assertNotIn('resolutionMeters', result)
        self.assertEqual(result['sourceResolution'], 1 / 10800)
        self.assertEqual(result['resolutionUnits'], 'source raster units')

    def test_redundant_vertices_reuse_only_identical_query_locations(self):
        original = self.profile()
        redundant = copy.deepcopy(original)
        redundant['vertices'].insert(1, {'x': -13619950, 'y': 6040000, 'distanceFeet': 50})
        points, _ = elevation.sample_locations(original)
        with tempfile.TemporaryDirectory() as folder, patch.object(elevation, 'CACHE', Path(folder)), patch.object(elevation.requests, 'get', side_effect=AssertionError('Network forbidden')):
            record = {'version': elevation.VERSION, 'routeId': 'route', 'profileId': original['id'],
                      'geometryHash': elevation.signature(original), 'samples': points,
                      'stopTicks': original['stops']}
            elevation.cache_file('route', original).write_text(json.dumps(record))
            self.assertNotEqual(elevation.signature(original), elevation.signature(redundant))
            self.assertIsNotNone(elevation.load_cached('route', redundant))
            redundant['stops'][0]['id'] = 'another stop'
            self.assertIsNone(elevation.load_cached('route', redundant))
            redundant['stops'] = copy.deepcopy(original['stops'])
            redundant['vertices'][2]['y'] += 1
            self.assertIsNone(elevation.load_cached('route', redundant))
