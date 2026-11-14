"""Selected-route departures with a bounded daily-schedule fallback."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from time import monotonic
from src import oba

SEATTLE = ZoneInfo('America/Los_Angeles')


def scheduled_rows(response, route_id, stop_id, now_ms):
    if response.get('code', 200) != 200:
        raise ValueError('Schedule unavailable')
    data = response.get('data', {})
    entry = data.get('entry')
    if not isinstance(entry, dict) or 'stopRouteSchedules' not in entry:
        raise ValueError('Schedule unavailable')
    routes = {r['id']: r.get('shortName') or r.get('longName') or r['id']
              for r in data.get('references', {}).get('routes', [])}
    rows = []
    for route in entry['stopRouteSchedules']:
        if route.get('routeId') != route_id:
            continue
        for direction in route.get('stopRouteDirectionSchedules', []):
            for item in direction.get('scheduleStopTimes', []):
                departure = item.get('departureTime')
                if item.get('departureEnabled') is False or not departure or departure < now_ms:
                    continue
                rows.append({'routeId': route_id, 'route': routes.get(route_id, route_id),
                    'destination': item.get('stopHeadsign') or direction.get('tripHeadsign') or 'Destination unavailable',
                    'stopId': stop_id, 'tripId': item.get('tripId'), 'serviceDate': entry.get('date'),
                    'scheduledTime': departure, 'departureTime': departure, 'predicted': False})
    return rows


def trip_links(item):
    """Only expose explicit same-block links; no inferred passenger transfer promise."""
    if not item.get('tripId') or not item.get('serviceDate'):
        return []
    response = oba._get_oba(f"trip-details/{item['tripId']}", serviceDate=item['serviceDate'],
                            includeSchedule='true', includeStatus='false', includeTrip='true')
    data = response.get('data', {})
    schedule = (data.get('entry') or {}).get('schedule') or {}
    trips = {trip['id']: trip for trip in data.get('references', {}).get('trips', [])}
    routes = {route['id']: route.get('shortName') or route.get('longName') or route['id']
              for route in data.get('references', {}).get('routes', [])}
    links = []
    for relation, key in [('previous', 'previousTripId'), ('next', 'nextTripId')]:
        trip = trips.get(schedule.get(key))
        if trip and trip.get('routeId') != item['routeId']:
            links.append({'relation': relation, 'tripId': trip['id'], 'routeId': trip.get('routeId'),
                          'route': routes.get(trip.get('routeId'), trip.get('routeShortName') or trip.get('routeId')),
                          'destination': trip.get('tripHeadsign') or 'Destination unavailable'})
    return links


def route_departures(stop_ids, route_id, now=None, days=7):
    now = now or datetime.now(SEATTLE)
    now_ms = now.timestamp()*1000
    stop_ids = list(dict.fromkeys(stop_ids))
    issues = []
    try:
        live = [item for item in oba.get_departures(stop_ids) if item['departureTime'] >= now_ms]
    except Exception:
        live = []
        issues.append('Near-term departures could not be retrieved.')
    selected = [item for item in live if item['routeId'] == route_id]
    searched = False
    complete = True
    if not selected:
        searched = True
        today = now.astimezone(SEATTLE).date()
        deadline = monotonic() + 45
        requests_made = 0
        exhausted = False
        # Previous service day can include after-midnight departures.
        for offset in range(-1, days+1):
            date = today + timedelta(days=offset)
            for stop_id in stop_ids:
                if monotonic() >= deadline or requests_made >= 24:
                    complete = False
                    exhausted = True
                    break
                requests_made += 1
                try:
                    response = oba._get_oba(f'schedule-for-stop/{stop_id}', date=date.isoformat())
                    selected.extend(scheduled_rows(response, route_id, stop_id, now_ms))
                except Exception:
                    complete = False
            if exhausted:
                break
            end_of_day = datetime.combine(date + timedelta(days=1), datetime.min.time(), tzinfo=SEATTLE).timestamp()*1000
            if offset >= 0 and selected and min(item['departureTime'] for item in selected) < end_of_day:
                break
        if not complete:
            issues.append('Some daily schedules were unavailable; an earlier departure may be missing.')
    unique = {(item.get('tripId'), item['stopId'], item['scheduledTime']): item for item in selected}
    selected = sorted(unique.values(), key=lambda item: item['departureTime'])
    for item in selected[:4]:
        try:
            item['linkedTrips'] = trip_links(item)
            item['linksChecked'] = True
        except Exception:
            item['linkedTrips'] = []
            item['linksChecked'] = False
    if selected:
        message = 'Next departures for the selected route.'
    elif complete:
        message = f'No boarding departures found for this route through {(now.astimezone(SEATTLE).date()+timedelta(days=days)).isoformat()} at this stop.'
    else:
        message = 'The next departure for this route could not be established from the available schedules.'
    return {'selectedDepartures': selected[:4],
            'otherDepartures': [item for item in live if item['routeId'] != route_id][:8],
            'selectedMessage': message, 'scheduleSearched': searched,
            'notes': issues, 'checkedAt': int(now_ms), 'departures': live}
