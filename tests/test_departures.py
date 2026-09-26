import unittest
from unittest.mock import patch

from src import oba


class DepartureTests(unittest.TestCase):
    def test_predictions_override_schedule_and_results_sort(self):
        responses = {
            "a": {"data": {"references": {"routes": [{"id": "r1", "shortName": "8"}]}, "entry": {
                "arrivalsAndDepartures": [{"tripId": "late", "routeId": "r1", "tripHeadsign": "Seattle Center",
                    "serviceDate": 1, "scheduledDepartureTime": 3000, "predictedDepartureTime": 4000, "predicted": True}]}}},
            "b": {"data": {"references": {"routes": [{"id": "r2", "shortName": "G"}]}, "entry": {
                "arrivalsAndDepartures": [{"tripId": "early", "routeId": "r2", "tripHeadsign": "Downtown",
                    "serviceDate": 1, "scheduledDepartureTime": 2000, "predicted": False}]}}},
        }
        with patch.object(oba, "_get_oba", side_effect=lambda path, **kwargs: responses[path.rsplit('/', 1)[-1]]):
            result = oba.get_departures(["a", "b"])
        self.assertEqual([item["route"] for item in result], ["G", "8"])
        self.assertEqual(result[1]["departureTime"], 4000)
        self.assertTrue(result[1]["predicted"])

    def test_missing_times_are_omitted_and_stop_ids_are_deduplicated(self):
        response = {"data": {"references": {}, "entry": {"arrivalsAndDepartures": [{"tripId": "x"}]}}}
        with patch.object(oba, "_get_oba", return_value=response) as fetch:
            self.assertEqual(oba.get_departures(["a", "a"]), [])
        fetch.assert_called_once()


if __name__ == "__main__":
    unittest.main()
