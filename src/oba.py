import os
import json
from pathlib import Path
from dotenv import load_dotenv
import requests 

load_dotenv()

# Define constants
API_KEY = os.environ.get("OBA_API_KEY")
BASE_URL = "https://api.pugetsound.onebusaway.org/api/where"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ROUTE_DATA_DIR = PROJECT_ROOT / "data" / "raw" / "oba" / "routes"



## Transit related information (OneBusAway API)
AGENCIES_FILE = PROJECT_ROOT / "data" / "reference" / "agencies.json"
AGENCY_ROUTE_FILE = PROJECT_ROOT / "data" /"reference" / "agency_route.json"
ROUTE_STOPS_DIR = PROJECT_ROOT / "data" / "raw" / "route_stops"


def fetch_and_save_agencies():
    response = _get_oba("agencies-with-coverage")

    agencies = response["data"]["references"]["agencies"]

    cleaned_agencies = [
        {
            "id": agency["id"],
            "name": agency["name"],
        }
        for agency in agencies
    ]

    AGENCIES_FILE.parent.mkdir(parents=True, exist_ok=True)

    with AGENCIES_FILE.open("w", encoding="utf-8") as file:
        json.dump(cleaned_agencies, file, indent=2)

    return cleaned_agencies


def load_agencies():
    with AGENCIES_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)
    


def fetch_and_save_agency_routes():
    agencies = load_agencies()
    all_routes = []

    for agency in agencies:
        response = get_routes_for_agency(agency["id"])
        routes = response["data"]["list"]

        cleaned_routes = [
            {
                "agency_id": route["agencyId"],
                "route_id": route["id"],
                "long_name": route["longName"],
                "description": route["description"],
                "null_safe_name": route["nullSafeShortName"],
                "name": route["shortName"],
                "type": route.get("type"),
            }
            for route in routes
        ]

        all_routes.extend(cleaned_routes)

    AGENCY_ROUTE_FILE.parent.mkdir(parents=True, exist_ok=True)

    with AGENCY_ROUTE_FILE.open("w", encoding="utf-8") as file:
        json.dump(all_routes, file, indent=2)

    return all_routes

def load_agency_routes():
    with AGENCY_ROUTE_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def _get_oba(path, **parameters):
    if not API_KEY:
        raise RuntimeError("Set OBA_API_KEY in .env to fetch uncached transit data.")
    parameters["key"] = API_KEY
    endpoint = f"{BASE_URL}/{path}.json"

    response = requests.get(
        endpoint,
        params=parameters,
        timeout=30,
    )
    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After", "not provided")

        raise RuntimeError(
            "OneBusAway rate limit reached. "
            f"Retry-After: {retry_after}. Endpoint: {endpoint}"
        )
    
    try: 
        response.raise_for_status()
    except requests.HTTPError:
        raise RuntimeError(
            f"OneBusAwayRequest failed with status {response.status_code}"
        ) from None      

    return response.json()




def get_agency(id):
    return _get_oba(f"agency/{id}")


def get_routes_for_agency(id):
    return _get_oba(f"routes-for-agency/{id}")


def get_departures(stop_ids, minutes_after=120):
    """Return a compact, deduplicated live-departure list for boarding stops."""
    departures = {}
    for stop_id in dict.fromkeys(stop_ids):
        response = _get_oba(
            f"arrivals-and-departures-for-stop/{stop_id}",
            minutesBefore=0,
            minutesAfter=minutes_after,
        )
        data = response.get("data", {})
        entry = data.get("entry") or {}
        routes = {
            route.get("id"): route.get("shortName") or route.get("longName") or route.get("id")
            for route in data.get("references", {}).get("routes", [])
        }
        for item in entry.get("arrivalsAndDepartures", []):
            scheduled = item.get("scheduledDepartureTime") or item.get("scheduledArrivalTime")
            predicted = item.get("predictedDepartureTime") or item.get("predictedArrivalTime")
            time = predicted if item.get("predicted") and predicted else scheduled
            if not time:
                continue
            key = (item.get("tripId"), item.get("serviceDate"), scheduled, stop_id)
            departures[key] = {
                "routeId": item.get("routeId"),
                "route": routes.get(item.get("routeId"), item.get("routeShortName") or item.get("routeId")),
                "destination": item.get("tripHeadsign") or "Destination unavailable",
                "stopId": stop_id,
                "scheduledTime": scheduled,
                "departureTime": time,
                "predicted": bool(item.get("predicted") and predicted),
            }
    return sorted(departures.values(), key=lambda item: item["departureTime"])



def fetch_and_save_stop(stop_id):
    response = _get_oba(f"stop/{stop_id}")

    stop_data = response["data"]["entry"]
    references = response["data"]["references"]

    stop_info = {
        "id": stop_data["id"],
        "code": stop_data["code"],
        "name": stop_data["name"],
        "lat": stop_data["lat"],
        "lon": stop_data["lon"],
        "direction": stop_data.get("direction"),
        "locationType": stop_data.get("locationType"),
        "parent": stop_data.get("parent"),
        "wheelchairBoarding": stop_data.get("wheelchairBoarding"),
        "routeIds": stop_data.get("routeIds", []),
        "staticRouteIds": stop_data.get("staticRouteIds", []),
    }

    return {
        "stop_info": stop_info,
        "references": references,
    }

ROUTE_STOPS_DIR = PROJECT_ROOT / "data" / "raw" / "route_stops"


def fetch_stops_for_route(route_id):
    ROUTE_STOPS_DIR.mkdir(parents=True, exist_ok=True)

    safe_route_id = route_id.replace("/", "_")
    route_file = ROUTE_STOPS_DIR / f"{safe_route_id}.json"

    if route_file.exists():
        with route_file.open(encoding="utf-8") as file:
            return json.load(file)

    response = _get_oba(f"stops-for-route/{route_id}",
                        includePolylines="false")
    data = response["data"]
    route_stop_ids = set(data["entry"]["stopIds"])
    referenced_stops = data["references"].get("stops", [])


    stops = [
        {
            "id": stop["id"],
            "code": stop.get("code"),
            "name": stop["name"],
            "lat": stop["lat"],
            "lon": stop["lon"],
            "direction": stop.get("direction"),
            "locationType": stop.get("locationType"),
            "parent": stop.get("parent"),
            "wheelchairBoarding": stop.get("wheelchairBoarding"),
            "routeIds": stop.get("routeIds", []),
            "staticRouteIds": stop.get("staticRouteIds", []),
        }
        for stop in referenced_stops
        if stop["id"] in route_stop_ids
    ]


    with route_file.open("w", encoding="utf-8") as file:
        json.dump(stops, file, indent=2)

    return stops

def load_stops_for_route(route_id, refresh=False):
    route_data = load_route_data(
        route_id,
        refresh=refresh,
    )

    return route_data["stops"]
    
def _route_data_file(route_id):
    safe_route_id = route_id.replace("/", "_")
    return ROUTE_DATA_DIR / f"{safe_route_id}.json"

def fetch_route_data(route_id):
    response = _get_oba(
        f"stops-for-route/{route_id}",
        includePolylines="true",
    )

    data = response["data"]
    entry = data["entry"]

    route_stop_ids = set(entry["stopIds"])

    stops = [
        stop
        for stop in data["references"].get("stops", [])
        if stop["id"] in route_stop_ids
    ]

    return {
        "route_id": route_id,
        "stops": stops,
        "stop_groupings": entry.get("stopGroupings", []),
        "route_references": data["references"].get("routes", []),
        "polylines": entry.get("polylines", []),
    }

def load_route_data(route_id, refresh=False):
    route_file = _route_data_file(route_id)

    if route_file.exists() and not refresh:
        with route_file.open(encoding="utf-8") as file:
            return json.load(file)

    route_data = fetch_route_data(route_id)

    route_file.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with route_file.open("w", encoding="utf-8") as file:
        json.dump(
            route_data,
            file,
            indent=2,
        )

    return route_data
