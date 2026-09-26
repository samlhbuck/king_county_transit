import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import geopandas as gpd
from shapely.geometry import Point
from src import tod
from src.transfers import stop_transfers


class TransferTests(unittest.TestCase):
    def test_same_stop_nearby_cutoff_destinations_and_deduplication(self):
        points=gpd.GeoSeries([Point(1200000+x,200000) for x in [0,100,600,700,900]],crs=tod.ANALYSIS_CRS).to_crs(4326)
        stops=[{'id':str(i),'name':f'Stop {i}','lat':p.y,'lon':p.x,'routeIds':routes}
               for i,(p,routes) in enumerate(zip(points,[['home','shared'],['home'],['near'],['far'],['outside']]))]
        route={'route_id':'home','stops':stops[:2]}
        cached={'route_id':'near','stops':[stops[0],stops[2]],'route_references':[{'id':'near','shortName':'N','type':11}],
                'stop_groupings':[{'type':'direction','stopGroups':[{'name':{'name':'North'},'stopIds':['2']}]}]}
        physical=tod.make_stops_gdf([{'id':'p','name':'Physical','lat':points[0].y,'lon':points[0].x,'oba_stop_ids':['0','1']}])
        with TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'near.json').write_text(json.dumps(cached))
            (root/'far.json').write_text(json.dumps({'route_id':'far','stops':[stops[3]]}))
            (root/'outside.json').write_text(json.dumps({'route_id':'outside','stops':[stops[4]]}))
            (root/'broken.json').write_text('{')
            with patch('src.oba.ROUTE_DATA_DIR',root):
                result=stop_transfers(route,physical,[{'route_id':'shared','name':'S'}])['stops']['p']
        self.assertNotIn('home',[r['routeId'] for r in result])
        self.assertNotIn('outside',[r['routeId'] for r in result])
        # 700 ft from the representative point, but 600 ft from its second platform.
        far=next(r for r in result if r['routeId']=='far')
        self.assertEqual(far['distanceFeet'],600)
        shared=next(r for r in result if r['routeId']=='shared')
        self.assertTrue(shared['sameStop'])
        self.assertEqual(shared['mode'],'Type not cached')
        near=next(r for r in result if r['routeId']=='near')
        self.assertEqual(near['mode'],'Trolleybus')
        self.assertEqual(len(near['boardingLocations']),2)
        self.assertEqual(near['boardingLocations'][0]['destinations'],[])
        self.assertEqual(near['boardingLocations'][1]['destinations'],['North'])
        self.assertFalse(near['boardingLocations'][1]['sameStop'])
        with TemporaryDirectory() as folder, patch('src.oba.ROUTE_DATA_DIR',Path(folder)):
            only=stop_transfers(route,physical,[])['stops']['p']
        self.assertEqual([r['routeId'] for r in only],['shared'])
