"""Regression coverage for asymmetric, branching and ungrouped stop patterns."""
import json
import unittest

import geopandas as gpd
from shapely.geometry import Point

from src import oba, tod


def stop(id, x=0, name='Main St & 1st Ave', direction='', parent=None):
    point = gpd.GeoSeries([Point(1270000 + x, 220000)], crs=tod.ANALYSIS_CRS).to_crs(tod.SOURCE_CRS).iloc[0]
    return dict(id=id, lat=point.y, lon=point.x, name=name, direction=direction, parent=parent)


def route(stops, groups=()):
    return {'route_id': 'test', 'stops': stops, 'stop_groupings': [
        {'type': 'direction', 'stopGroups': [{'stopIds': ids} for ids in groups]}
    ] if groups else []}


class PhysicalStopTests(unittest.TestCase):
    def groups(self, data):
        result = tod.make_physical_stops_gdf(data)
        members = result.oba_stop_ids.tolist()
        flattened = [id for group in members for id in group]
        self.assertCountEqual(flattened, set(s['id'] for s in data['stops']))
        self.assertEqual(len(flattened), len(set(flattened)))
        return {frozenset(group) for group in members}

    def test_unequal_directions_keep_unmatched(self):
        data = route([stop('a'), stop('b', 100), stop('extra', 1000)], [['a', 'extra'], ['b']])
        self.assertEqual(self.groups(data), {frozenset(['a', 'b']), frozenset(['extra'])})

    def test_single_direction_merges_same_named_platforms(self):
        data = route([stop('a'), stop('b', 30)], [['a', 'b']])
        self.assertEqual(self.groups(data), {frozenset(['a', 'b'])})

    def test_no_groups_uses_opposite_directions(self):
        data = route([stop('a', direction='N'), stop('b', 60, direction='S'), stop('c', 1200)])
        self.assertEqual(self.groups(data), {frozenset(['a', 'b']), frozenset(['c'])})

    def test_distance_and_name_prevent_wrong_pairing(self):
        data = route([stop('a'), stop('far', 1200), stop('different', 350, name='Main & 2nd')],
                     [['a'], ['far', 'different']])
        self.assertEqual(len(self.groups(data)), 3)

    def test_intersection_name_order_is_normalized(self):
        data = route([stop('a'), stop('b', 40, name='1st Ave AND Main St')], [['a'], ['b']])
        self.assertEqual(self.groups(data), {frozenset(['a', 'b'])})

    def test_branches_and_shared_terminal_keep_all_ids_once(self):
        data = route([stop('a'), stop('b', 60), stop('branch', 1400), stop('ungrouped', 2000)],
                     [['a', 'branch', 'a'], ['b'], ['a', 'b', 'branch']])
        self.assertEqual(len(self.groups(data)), 3)

    def test_shared_parent_can_group_platforms_with_different_names(self):
        data = route([stop('a', parent='station'), stop('b', 100, name='Bay 2', parent='station')])
        self.assertEqual(self.groups(data), {frozenset(['a', 'b'])})

    def test_parent_station_cannot_chain_distant_platforms(self):
        data = route([stop('a', parent='station'), stop('b', 400, parent='station'),
                      stop('c', 800, parent='station')])
        self.assertEqual(len(self.groups(data)), 2)

    def test_closest_match_wins(self):
        data = route([stop('a'), stop('far', -400), stop('near', 300)], [['a'], ['far', 'near']])
        self.assertEqual(self.groups(data), {frozenset(['a', 'near']), frozenset(['far'])})

    def test_abbreviations_and_missing_qualifiers(self):
        data = route([stop('a', name='E Yesler Way & 27th'),
                      stop('b', 350, name='East Yesler Way & 27th Avenue S')])
        self.assertEqual(self.groups(data), {frozenset(['a', 'b'])})
        name = tod.make_physical_stops_gdf(data).iloc[0]['name']
        self.assertIn('27th', name)
        self.assertIn('27th Avenue S', name)

    def test_conflicting_explicit_street_qualifiers_are_not_equivalent(self):
        data = route([stop('a', name='Main St & 27th Ave N'),
                      stop('b', 350, name='Main St & 27th Ave S')])
        self.assertEqual(len(self.groups(data)), 2)

    def test_different_names_nearby_opposing_platforms(self):
        data = route([stop('a', name='MLK & Hill', direction='S'),
                      stop('b', 180, name='MLK & Walker', direction='N')], [['a', 'b']])
        self.assertEqual(self.groups(data), {frozenset(['a', 'b'])})
        self.assertEqual(tod.make_physical_stops_gdf(data).iloc[0]['name'], 'MLK & Hill / Walker')

    def test_different_names_same_direction_or_far_away_remain_separate(self):
        for distance, direction in [(180, 'S'), (350, 'N')]:
            data = route([stop('a', name='MLK & Hill', direction='S'),
                          stop('b', distance, name='MLK & Walker', direction=direction)])
            self.assertEqual(len(self.groups(data)), 2)

    def test_nearby_different_names_without_direction_evidence_stay_separate(self):
        data = route([stop('a', name='Main & Hill'), stop('b', 180, name='Main & Walker')])
        self.assertEqual(len(self.groups(data)), 2)

    def test_proximity_does_not_create_a_chain(self):
        data = route([stop('a', name='Main & First', direction='N'),
                      stop('b', 180, name='Main & Second', direction='S'),
                      stop('c', 360, name='Main & Third', direction='N')])
        self.assertEqual(len(self.groups(data)), 2)

    def test_route_8_reported_pairs(self):
        data = oba.load_route_data('1_100275')
        groups = self.groups(data)
        self.assertIn(frozenset(['1_27335', '1_27590']), groups)
        self.assertIn(frozenset(['1_12484', '1_36752']), groups)

    def test_first_hill_matches_legacy_pairing_and_locations(self):
        data = oba.load_route_data('23_102638')
        direction = next(g for g in data['stop_groupings'] if g['type'] == 'direction')['stopGroups']
        expected = [list(dict.fromkeys(pair)) for pair in zip(direction[0]['stopIds'], reversed(direction[1]['stopIds']))]
        result = tod.make_physical_stops_gdf(data)
        self.assertEqual(result.oba_stop_ids.tolist(), expected)
        lookup = {s['id']: s for s in data['stops']}
        for row, ids in zip(result.itertuples(), expected):
            self.assertAlmostEqual(row.lat, sum(lookup[i]['lat'] for i in ids) / len(ids))
            self.assertAlmostEqual(row.lon, sum(lookup[i]['lon'] for i in ids) / len(ids))

    def test_g_line_same_name_platforms_condense(self):
        data = oba.load_route_data('1_102745')
        groups = self.groups(data)
        self.assertIn(frozenset(['1_124', '1_106']), groups)
        self.assertEqual(len(groups), 15)

    def test_all_cached_routes_preserve_every_stop(self):
        for file in oba.ROUTE_DATA_DIR.glob('*.json'):
            with self.subTest(route=file.stem):
                self.groups(json.loads(file.read_text()))


if __name__ == '__main__':
    unittest.main()
