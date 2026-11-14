import unittest
from src.traveltime_pilot import build_request


class TravelTimePilotTests(unittest.TestCase):
    def test_walk_toward_each_boarding_stop(self):
        cases = {'locations': [{'id': x, 'coords': {'lat': 47.64, 'lng': -122.32}}
                               for x in ['address', '49-platform', '70-platform']],
                 'origins': ['address'], 'stops': ['49-platform', '70-platform']}
        payload = build_request(cases, '2026-09-30T12:00:00-07:00', 15)
        searches = payload['arrival_searches']
        self.assertEqual(len(searches), 2)
        self.assertEqual(searches[0]['arrival_location_id'], '49-platform')
        self.assertEqual(searches[0]['departure_location_ids'], ['address'])
        self.assertEqual(searches[0]['transportation'], {'type': 'walking'})
        self.assertEqual(searches[0]['travel_time'], 900)
        with self.assertRaises(ValueError):
            build_request(cases, '2026-09-30T12:00:00')
        cases['stops'] = ['missing']
        with self.assertRaises(ValueError):
            build_request(cases, '2026-09-30T12:00:00-07:00')
