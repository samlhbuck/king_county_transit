import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from src.origins import cached_boarding_stops


class OriginTests(unittest.TestCase):
    def test_cache_only_deduplication_and_invalid_coordinates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stop = {'id': 'a', 'name': 'Boarding stop', 'lat': 47.6, 'lon': -122.3}
            (root / 'one.json').write_text(json.dumps({'route_id': 'one', 'stops': [stop], 'stop_groupings': [{'type': 'direction', 'stopGroups': [{'id': 'out', 'name': {'name': 'Downtown'}, 'stopIds': ['a']}]}]}))
            (root / 'two.json').write_text(json.dumps({'route_id': 'two', 'stops': [stop, {**stop, 'id': 'bad', 'lat': 100}]}))
            (root / 'broken.json').write_text('{')
            with patch('src.origins.oba.ROUTE_DATA_DIR', root):
                result = cached_boarding_stops()
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]['routes'], ['one', 'two'])
            self.assertEqual(result[0]['lat'], 47.6)

            self.assertEqual(result[0]['directions']['one'], [{'id': '0:out', 'name': 'Downtown'}])
            self.assertEqual(result[0]['directions']['two'], [])
