import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from src.departures import route_departures, scheduled_rows, trip_links, SEATTLE


class RouteDepartureTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 29, 18, tzinfo=SEATTLE)
        self.future = int((self.now + timedelta(days=1)).timestamp()*1000)

    def response(self, enabled=True):
        return {'data': {'entry': {'date': 1, 'stopRouteSchedules': [{'routeId': '43',
            'stopRouteDirectionSchedules': [{'tripHeadsign': 'UW', 'scheduleStopTimes': [
                {'tripId': 't', 'departureTime': self.future, 'departureEnabled': enabled}]}]}]}}}

    def test_sparse_route_gets_next_day_and_other_routes_remain(self):
        other = {'routeId': '10', 'departureTime': self.future-1000}
        empty = {'data': {'entry': {'stopRouteSchedules': []}}}
        def fetch(path, **kwargs):
            return self.response() if kwargs.get('date') == '2026-09-30' else empty
        with patch('src.departures.oba.get_departures', return_value=[other]), patch('src.departures.oba._get_oba', side_effect=fetch), patch('src.departures.trip_links', return_value=[]):
            result = route_departures(['s'], '43', self.now)
        self.assertEqual(result['selectedDepartures'][0]['departureTime'], self.future)
        self.assertEqual(result['otherDepartures'], [other])
        self.assertTrue(result['scheduleSearched'])

    def test_selected_live_route_is_not_lost_after_eight_other_departures(self):
        selected = {'routeId': '43', 'stopId': 's', 'tripId': 't', 'scheduledTime': self.future, 'departureTime': self.future, 'predicted': True}
        live = [{'routeId': '10', 'departureTime': self.future-1}]*10+[selected]
        with patch('src.departures.oba.get_departures', return_value=live), patch('src.departures.trip_links', return_value=[]) as links, patch('src.departures.oba._get_oba') as schedules:
            result = route_departures(['s'], '43', self.now)
        self.assertEqual(result['selectedDepartures'][0]['routeId'], '43')
        schedules.assert_not_called()
        self.assertEqual(len(result['otherDepartures']), 8)

    def test_dropoff_only_and_failed_schedule_are_not_false_departures(self):
        self.assertEqual(scheduled_rows(self.response(False), '43', 's', self.now.timestamp()*1000), [])
        with patch('src.departures.oba.get_departures', side_effect=RuntimeError()), patch('src.departures.oba._get_oba', side_effect=RuntimeError()):
            result = route_departures(['s'], '43', self.now, days=0)
        self.assertIn('could not be established', result['selectedMessage'])
        self.assertTrue(result['notes'])

    def test_only_explicit_cross_route_trip_links_are_shown(self):
        response = {'data': {'entry': {'schedule': {'nextTripId': 'next'}}, 'references': {
            'trips': [{'id': 'next', 'routeId': '44', 'tripHeadsign': 'Ballard'}],
            'routes': [{'id': '44', 'shortName': '44'}]}}}
        with patch('src.departures.oba._get_oba', return_value=response):
            links = trip_links({'tripId': '43trip', 'routeId': '43', 'serviceDate': 1})
        self.assertEqual(links[0]['route'], '44')
        self.assertEqual(links[0]['relation'], 'next')
