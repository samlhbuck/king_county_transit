"""Small, explicit walking-to-stop pilot; never changes production assignments.

Run: python -m src.traveltime_pilot cases.json --dry-run
Input: {"locations": [{"id": "...", "coords": {"lat": ..., "lng": ...}}],
        "origins": ["address-id"], "stops": ["boarding-stop-id"]}
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

URL = 'https://api.traveltimeapp.com/v4/time-filter'


def build_request(cases, arrival_time, minutes=15):
    locations = cases['locations']
    ids = [item['id'] for item in locations]
    if len(ids) != len(set(ids)):
        raise ValueError('Location IDs must be unique')
    if not 1 <= len(cases['stops']) <= 10 or not 1 <= len(cases['origins']) <= 2000:
        raise ValueError('Pilot requires 1–10 stops and 1–2000 origins')
    if not 1 <= minutes <= 60:
        raise ValueError('Walking budget must be 1–60 minutes')
    if not set(cases['origins'] + cases['stops']).issubset(ids):
        raise ValueError('Every origin and stop must have coordinates')
    for item in locations:
        coords = item['coords']
        if not -90 <= coords['lat'] <= 90 or not -180 <= coords['lng'] <= 180:
            raise ValueError('Invalid latitude/longitude')
    when = datetime.fromisoformat(arrival_time.replace('Z', '+00:00'))
    if when.tzinfo is None:
        raise ValueError('Arrival time must include timezone')
    return {'locations': locations, 'arrival_searches': [
        {'id': stop, 'arrival_location_id': stop,
         'departure_location_ids': cases['origins'],
         'transportation': {'type': 'walking'}, 'arrival_time': arrival_time,
         'travel_time': minutes * 60, 'properties': ['travel_time']}
        for stop in cases['stops']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('cases', type=Path)
    parser.add_argument('--minutes', type=int, default=15)
    parser.add_argument('--arrival-time', default=datetime.now(timezone.utc).isoformat())
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('/tmp/traveltime-pilot.json'))
    args = parser.parse_args()
    payload = build_request(json.loads(args.cases.read_text()), args.arrival_time, args.minutes)
    if args.dry_run:
        print(json.dumps(payload, indent=2))
        return
    load_dotenv()
    app_id = os.environ.get('TRAVELTIME_APP_ID')
    api_key = os.environ.get('TRAVELTIME_API_KEY')
    if not app_id or not api_key:
        parser.error('Set TRAVELTIME_APP_ID and TRAVELTIME_API_KEY in .env')
    response = requests.post(URL, json=payload, headers={
        'X-Application-Id': app_id, 'X-Api-Key': api_key,
        'Content-Type': 'application/json'}, timeout=60)
    if not response.ok:
        raise RuntimeError(f'TravelTime request failed (HTTP {response.status_code}); no assignments changed')
    args.output.write_text(json.dumps({'retrievedAt': datetime.now(timezone.utc).isoformat(),
        'request': payload, 'response': response.json()}, indent=2))
    print(f'Pilot results written to {args.output}; production assignments unchanged')


if __name__ == '__main__':
    main()
