import unittest
import polyline
from src.context_routes import decode_paths


class ContextGeometryTests(unittest.TestCase):
    def test_keeps_disconnected_shapes_separate_and_deduplicates(self):
        a={'points':polyline.encode([(47.6,-122.3),(47.61,-122.31)])}
        b={'points':polyline.encode([(47.7,-122.4),(47.71,-122.41)])}
        paths=decode_paths({'polylines':[a], 'stop_groupings':[{'stopGroups':[{'polylines':[a,b]}]}]})
        self.assertEqual(len(paths),2)
        self.assertTrue(all(len(p)==2 for p in paths))
        self.assertLess(paths[0][0][0],-13000000)
        self.assertGreater(paths[0][0][1],6000000)

    def test_invalid_and_empty_shapes(self):
        self.assertEqual(decode_paths({'polylines':[{'points':'_'},{}, {'points':polyline.encode([(90,0),(91,0)])}]}),[])
