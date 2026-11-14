import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from shapely.geometry import box, mapping
from src.municipal_zoning import fetch_layer, normalize, download, legend_labels


def feature(id=1, geometry=None):
    return {'type': 'Feature', 'properties': {'OBJECTID': id, 'CODE': 'R'},
            'geometry': mapping(geometry or box(-122.3, 47.6, -122.29, 47.61))}


class MunicipalZoningTests(unittest.TestCase):
    def metadata(self):
        return {'geometryType': 'esriGeometryPolygon', 'maxRecordCount': 1,
            'fields': [{'name': 'OBJECTID', 'type': 'esriFieldTypeOID'}, {'name': 'CODE', 'type': 'esriFieldTypeString'}]}

    def test_batches_are_verified_by_id(self):
        responses = [self.metadata(), {'count': 2}, {'objectIds': [1, 2]},
                     {'features': [feature(1)]}, {'features': [feature(2)]}, {'objectIds': [1, 2]}]
        with patch('src.municipal_zoning.request_json', side_effect=responses):
            raw, _, _, oid = fetch_layer(None, 'https://test/layer', ['CODE'])
        self.assertEqual(oid, 'OBJECTID')
        self.assertEqual(len(raw['features']), 2)
        responses = [self.metadata(), {'count': 2}, {'objectIds': [1, 2]}, {'features': [feature(2)]}]
        with patch('src.municipal_zoning.request_json', side_effect=responses):
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                fetch_layer(None, 'https://test/layer', ['CODE'])

    def test_normalize_clips_and_keeps_native_labels(self):
        raw = {'features': [feature()]}
        boundary = {'features': [feature(2, box(-122.3, 47.6, -122.294, 47.61))]}
        metadata = {'drawingInfo': {'renderer': {'field1': 'CODE', 'uniqueValueGroups': [
            {'classes': [{'label': 'Residential', 'values': [['R']]}]}]}}}
        self.assertEqual(legend_labels(metadata, 'CODE'), {'R': 'Residential'})
        normalized, audit = normalize(raw, boundary, {'name': 'Test City', 'code': 'CODE', 'label': None}, metadata, 'OBJECTID')
        properties = normalized['features'][0]['properties']
        self.assertEqual(properties['source_id'], 'Test City:1')
        self.assertEqual(properties['native_label'], 'Residential')
        self.assertIn('Test City', properties['DETAIL_DESC'])
        self.assertAlmostEqual(audit['boundaryCoveredPercent'], 100, delta=.01)

    def test_failed_refresh_retains_previous_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            old = cache / 'shoreline.geojson'
            old.write_text('previous valid cache')
            with patch('src.municipal_zoning.fetch_layer', side_effect=ValueError('incomplete')):
                with self.assertRaises(ValueError):
                    download('shoreline', cache_dir=cache)
            self.assertEqual(old.read_text(), 'previous valid cache')
            self.assertEqual(list(cache.iterdir()), [old])
