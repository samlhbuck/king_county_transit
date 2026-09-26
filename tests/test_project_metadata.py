import unittest
import geopandas as gpd
from shapely.geometry import box
from src import permits, tod
from src.project_metadata import reconcile_support_permits, use_hint
from src.zoning import summarize_area


class ProjectMetadataTests(unittest.TestCase):
    def test_taylor_support_permit_does_not_double_housing(self):
        frame = permits.load_development_permits()
        frame = frame.loc[frame.OriginalAddress1.eq('223 TAYLOR AVE N')].copy()
        original = frame.copy(deep=True)
        projects = tod.consolidate_projects(tod.make_permits_gdf(frame))
        self.assertEqual(projects.HousingUnitsAdded.sum(), 214)
        building = projects.loc[projects.HousingUnitsAdded.gt(0)].iloc[0]
        self.assertIn('6771553-CN', building.SourcePermitNumbers)
        self.assertIn('6771554-PH', building.SourcePermitNumbers)
        self.assertEqual(building.EstProjectCostNumeric, 51329233)
        self.assertEqual(building.SupportingPermitValue, 4025000)
        self.assertEqual(building.StatusCurrent, 'Completed')
        self.assertEqual(building.UseHint, 'Mixed-use indicated')
        self.assertTrue(frame.equals(original))

    def test_same_address_without_links_is_not_reconciled(self):
        frame = permits.load_development_permits()
        frame = frame.loc[frame.OriginalAddress1.eq('223 TAYLOR AVE N')].copy()
        frame['RelatedMup'] = None
        frame['Development Site'] = None
        self.assertEqual(len(reconcile_support_permits(frame)), len(frame))

    def test_unknown_use_is_not_labeled_residential_only(self):
        self.assertEqual(use_hint('Construct apartments'), 'Housing indicated; other uses unknown')
        self.assertEqual(use_hint('New school'), 'Institutional use indicated')
        self.assertEqual(use_hint('Construct building'), 'Use not established')

    def test_zoning_uses_area_not_feature_counts(self):
        zones = gpd.GeoDataFrame({'DETAIL_DESC':['Residential','Commercial']}, geometry=[box(0,0,6,10),box(6,0,8,10)], crs='EPSG:2285')
        summary = summarize_area(zones, box(0,0,10,10))
        self.assertEqual(summary['coveredPercent'], 80)
        self.assertEqual(summary['categories'], [{'name':'Residential','percent':60}, {'name':'Commercial','percent':20}])
        self.assertFalse(summary['overlap'])
        self.assertEqual(summarize_area(zones, box(20,20,30,30))['coveredPercent'], 0)
