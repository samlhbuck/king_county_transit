"""Run: .venv/bin/python -m unittest discover -s tests"""
import contextlib
import importlib
import io
import json
import unittest
from unittest.mock import patch

import pandas as pd

from analysis import first_hill
from src import oba, permits, tod
from src.route_explorer import build_dashboard_data, refresh_sources


class DashboardDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = build_dashboard_data()
        cls.results = tod.analyze_route(first_hill.ROUTE_ID, first_hill.CATCHMENT_DISTANCE_FEET,
                                       first_hill.START_DATE, first_hill.END_DATE)

    def test_import_does_not_execute_analysis(self):
        with patch.object(tod, 'analyze_route') as analyze, contextlib.redirect_stdout(io.StringIO()):
            importlib.reload(first_hill)
        analyze.assert_not_called()

    def test_valid_json_and_unique_assignments(self):
        json.dumps(self.data, allow_nan=False)
        ids = {s['id'] for s in self.data['stops']}
        self.assertEqual(len(ids), 10)
        for kind in ('projects', 'permits'):
            self.assertTrue(all(row['NearestStopId'] in ids for row in self.data[kind]))
        self.assertEqual(len(self.data['projects']), len(self.results['consolidated_projects_gdf']))
        self.assertEqual(len(self.data['permits']), len(self.results['corridor_permits_gdf']))

    def test_default_totals_match_existing_stop_profiles(self):
        projects = pd.DataFrame(self.data['projects'])
        projects['IssuedDate'] = pd.to_datetime(projects.IssuedDate)
        projects = projects.loc[projects.IssuedDate.ge(first_hill.START_DATE) & projects.IssuedDate.lt(first_hill.END_DATE)]
        profiles = self.results['stop_profiles_gdf'].set_index('NearestStopId')
        for stop_id, profile in profiles.iterrows():
            selected = projects.loc[projects.NearestStopId.eq(stop_id)]
            self.assertEqual(len(selected), profile.development_projects)
            for field, metric in [('HousingUnitsAdded', 'gross_units_added'), ('HousingUnitsRemoved', 'units_removed'),
                                  ('HousingUnitsNet', 'net_units'), ('EstProjectCostNumeric', 'estimated_value')]:
                self.assertAlmostEqual(selected[field].sum(), profile[metric])

    def test_no_permits_in_corridor(self):
        empty = permits.load_development_permits().iloc[:0]
        with patch.object(permits, 'load_development_permits', return_value=empty):
            data = build_dashboard_data()
        self.assertEqual(data['projects'], [])
        self.assertEqual(data['permits'], [])
        self.assertIsNone(data['minDate'])

    def test_empty_route_is_explained(self):
        with patch.object(oba, 'load_route_data', return_value={'stops': [], 'stop_groupings': []}):
            with self.assertRaisesRegex(ValueError, 'no stops'):
                build_dashboard_data('unsupported')

    def test_route_history_defaults_and_unknown_date(self):
        from src.route_history import load_route_history
        self.assertEqual(load_route_history('1_102745')['service_start_date'], '2024-09-14')
        self.assertIsNone(load_route_history('unknown'))
        self.assertEqual(self.data['defaultStart'], '2016-01-23')
        self.assertEqual(self.data['defaultPreset'], 'life')
        self.assertTrue(self.data['routeHistory']['source_url'].startswith('https://'))

    def test_refresh_reuses_existing_retrievers(self):
        with patch.object(oba, 'load_route_data') as load:
            refresh_sources('23_102638', 'transit')
            load.assert_called_once_with('23_102638', refresh=True)
        with patch.object(permits, 'fetch_and_save_permits') as fetch, patch.object(permits, 'save_development_permits') as save:
            refresh_sources('23_102638', 'permits')
            fetch.assert_called_once_with(refresh=True)
            save.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
