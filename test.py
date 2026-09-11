import requests
import os
import json
from pathlib import Path
from dotenv import load_dotenv
import pandas as pd

load_dotenv()
API_KEY = os.environ["OBA_API_KEY"]
BASE_URL = "https://api.pugetsound.onebusaway.org/api/where"
PROJECT_ROOT = Path(__file__).resolve().parent
AGENCIES_FILE = PROJECT_ROOT / "data" / "reference" / "agencies.json"
AGENCY_ROUTE_FILE = PROJECT_ROOT / "data" /"reference" / "agency_route.json"
PERMITS_URL = (
    "https://cos-data.seattle.gov/api/v3/views/"
    "76t5-zqzr/export.csv?accessType=DOWNLOAD"
)

PERMITS_FILE = Path("data/raw/building_permits.csv")

def download_permits(refresh = False): 
    if PERMITS_FILE.exists() and not refresh:
        return PERMITS_FILE
    
    PERMITS_FILE.parent.mkdir(parents=True,exist_ok=True)

    response = requests.get(PERMITS_URL)
    response.raise_for_status()

    PERMITS_FILE.write_bytes(response.content)

    return PERMITS_FILE

def _get_oba(path, **parameters):
    parameters["key"] = API_KEY
    endpoint = f"{BASE_URL}/{path}.json"

    response = requests.get(
        endpoint,
        params=parameters,
        timeout=30,
    )
    
    if response.status_code == 429:
        raise RuntimeError(
            "OneBusAway rate limit reached. Wait before retrying."
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

        AGENCY_ROUTE_FILE.parent.mkdir(parents = True, exist_ok = True)

        cleaned_routes = [
            {
                "route_id": route["agencyId"],
                "long_name": route["longName"],
                "description": route["description"],
                "null_safe_name": route["nullSafeShortName"],
                "name": route["shortName"]
            } 
            for route in routes
        ]
        all_routes.extend(cleaned_routes)
        
    with AGENCY_ROUTE_FILE.open("w", encoding="utf-8") as file:
        json.dump(all_routes, file, indent = 2)

    return all_routes
    
def load_agency_route():
    with AGENCY_ROUTE_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)

if AGENCIES_FILE.exists():
    agencies = load_agencies()
else:
    agencies = fetch_and_save_agencies()

for agency in agencies:
    print(agency["id"], agency["name"])


if AGENCY_ROUTE_FILE.exists():
    routes = load_agency_route()
else:
    routes = fetch_and_save_agency_routes()

for route in routes:
    print(route["name"], route["long_name"])

permit_path = download_permits()
permits = pd.read_csv(permit_path, low_memory=False)

print(permits.columns.to_list)
print(permits.shape)



    
