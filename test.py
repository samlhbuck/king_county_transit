import requests
import os
import json
from pathlib import Path
from dotenv import load_dotenv
import pandas as pd

load_dotenv()

# Define constants
API_KEY = os.environ["OBA_API_KEY"]
BASE_URL = "https://api.pugetsound.onebusaway.org/api/where"
PROJECT_ROOT = Path(__file__).resolve().parent

## Transit related information (OneBusAway API)
AGENCIES_FILE = PROJECT_ROOT / "data" / "reference" / "agencies.json"
AGENCY_ROUTE_FILE = PROJECT_ROOT / "data" /"reference" / "agency_route.json"

## Permitting related information (Seattle Department of Construction and Inspections)
PERMITS_URL = (
    "https://cos-data.seattle.gov/api/v3/views/"
    "76t5-zqzr/export.csv?accessType=DOWNLOAD"
)
PERMITS_FILE = Path("data/raw/building_permits.csv")
PERMITS_ANALYSIS_FILE = Path("data/processed/building_permits_selected_columns.csv")

PERMIT_COLUMNS = [
    # Identifiers and project relationships
    "PermitNum",
    "ParentPermitNum",
    "RelatedMup",
    "Development Site",

    # Permit classification
    "PermitClass",
    "PermitClassMapped",
    "PermitTypeMapped",
    "PermitTypeDesc",
    "Description",

    # Development outcomes
    "HousingUnits",
    "HousingUnitsAdded",
    "HousingUnitsRemoved",
    "HousingCategory",
    "DwellingUnitType",
    "EstProjectCost",

    # Status and timing
    "AppliedDate",
    "IssuedDate",
    "CompletedDate",
    "ExpiresDate",
    "StatusCurrent",

    # Geography
    "OriginalAddress1",
    "OriginalZip",
    "Latitude",
    "Longitude",
    "Zoning",
]

# Functions

def download_permits(refresh = False): 
    if PERMITS_FILE.exists() and not refresh:
        return PERMITS_FILE
    
    PERMITS_FILE.parent.mkdir(parents=True,exist_ok=True)

    response = requests.get(PERMITS_URL)
    response.raise_for_status()

    PERMITS_FILE.write_bytes(response.content)

    return PERMITS_FILE

def fetch_and_save_permits(refresh = False): 
    if PERMITS_ANALYSIS_FILE.exists() and not refresh:
        return PERMITS_ANALYSIS_FILE
    
    PERMITS_ANALYSIS_FILE.parent.mkdir(parents=True, exist_ok=True)

    permit_path = download_permits(refresh = refresh)
    permits = pd.read_csv(permit_path, low_memory=False)

    #corridor_buffers = station_buffers.geometry.union_all()

    missing_columns = [col for col in PERMIT_COLUMNS if col not in permits.columns]

    print(f"Missing columns: {missing_columns}")

    selected_columns = [col for col in PERMIT_COLUMNS if col in permits.columns]
    permits_analysis = permits[selected_columns].copy()

    permits_analysis.to_csv("data/processed/building_permits_selected_columns.csv", index=False)

    return PERMITS_ANALYSIS_FILE

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



if AGENCY_ROUTE_FILE.exists():
    routes = load_agency_route()
else:
    routes = fetch_and_save_agency_routes()


permits = fetch_and_save_permits(refresh = False)

# Visualize permits issued over time in line catchment area
## should it be line generalizable?
permits_df = pd.read_csv(permits)
permits_df["AppliedDate"] = pd.to_datetime(permits_df["AppliedDate"], errors="coerce")
permits_df["IssuedDate"] = pd.to_datetime(permits_df["IssuedDate"], errors="coerce")
permits_df["CompletedDate"] = pd.to_datetime(permits_df["CompletedDate"], errors="coerce")
permits_df["ExpiresDate"] = pd.to_datetime(permits_df["ExpiresDate"], errors="coerce") 

# column_profile = pd.DataFrame({
#     "dtype": permits_df.dtypes.astype(str),
#     "missing": permits_df.isna().sum(),
#     "missing_pct": permits_df.isna().mean().mul(100).round(1),
#     "unique": permits_df.nunique(dropna=True),
# })

# print(column_profile)

permits_df["EstProjectCostNumeric"] = permits_df["EstProjectCost"].replace(
    ",", "", regex=True
)
permits_df["EstProjectCostNumeric"] = pd.to_numeric(
    permits_df["EstProjectCostNumeric"],
    errors="coerce",
)

print(
    permits_df["EstProjectCostNumeric"]
    .describe(percentiles=[0.25, 0.5, 0.75, 0.9, 0.95, 0.99])
)

print(
    "Zero-cost permits:",
    permits_df["EstProjectCostNumeric"].eq(0).sum(),
)
print("" \
"Zero unit permits:", 
(permits_df["HousingUnitsAdded"].eq(0).sum() and permits_df["HousingUnitsRemoved"].eq(0).sum()))
housing_missingness = pd.crosstab(
    permits_df["PermitTypeMapped"],
    permits_df["HousingUnitsAdded"].isna(),
    margins=True,
)

print(housing_missingness)
print(
    permits_df["HousingCategory"]
    .value_counts(dropna=False)
)
permits_df["HousingUnitsNet"] = (
    permits_df["HousingUnitsAdded"].fillna(0)
    - permits_df["HousingUnitsRemoved"].fillna(0)

)

added = permits_df["HousingUnitsAdded"]
removed = permits_df["HousingUnitsRemoved"]

units_recorded = added.notna() & removed.notna()
units_changed = added.fillna(0).ne(0) | removed.fillna(0).ne(0)

permits_df["HousingUnitDataStatus"] = "Not recorded"
permits_df.loc[
    units_recorded & ~units_changed,
    "HousingUnitDataStatus",
] = "Recorded, no change"

permits_df.loc[
    units_changed,
    "HousingUnitDataStatus",
] = "Units added or removed"

print(
    permits_df["HousingUnitDataStatus"]
    .value_counts()
)

permits_df["HousingUnitsNet"] = pd.NA

permits_df.loc[
    units_recorded,
    "HousingUnitsNet",
] = added - removed

permits_df["HousingUnitsNet"] = (
    permits_df["HousingUnitsNet"]
    .astype("Int64")
)

housing_changes = permits_df.loc[
    units_changed,
    [
        "PermitNum",
        "PermitTypeDesc",
        "Description",
        "HousingCategory",
        "HousingUnits",
        "HousingUnitsAdded",
        "HousingUnitsRemoved",
        "HousingUnitsNet",
        "IssuedDate",
        "StatusCurrent",
    ],
].copy()

print(
    housing_changes["HousingUnitsNet"]
    .agg(["count", "sum", "median", "min", "max"])
)

print(
    pd.cut(
        housing_changes["HousingUnitsNet"],
        bins=[-float("inf"), -1, 0, float("inf")],
        labels=["Net removal", "No net change", "Net addition"],
    ).value_counts()
)

housing_category_summary = (
    permits_df
    .groupby("HousingCategory", dropna=False)
    .agg(
        permits=("PermitNum", "size"),
        permits_with_unit_changes=(
            "HousingUnitDataStatus",
            lambda values: (values == "Units added or removed").sum(),
        ),
        gross_units_added=("HousingUnitsAdded", "sum"),
        gross_units_removed=("HousingUnitsRemoved", "sum"),
        net_units=("HousingUnitsNet", "sum"),
    )
    .sort_values("net_units", ascending=False)
)

print(housing_category_summary)

positive_cost_permits = permits_df.loc[
    permits_df["EstProjectCostNumeric"] > 0
]
print(positive_cost_permits["EstProjectCostNumeric"].describe(percentiles=[0.25, 0.5, 0.75, 0.9, 0.95, 0.99]))

print(
    permits_df.groupby("PermitTypeDesc", dropna=False)
    .agg(
        permits=("PermitNum", "size"),
        permits_with_unit_changes=(
            "HousingUnitDataStatus",
            lambda values: (values == "Units added or removed").sum(),
        ),
        units_added=("HousingUnitsAdded", "sum"),
        units_removed=("HousingUnitsRemoved", "sum"),
        estimated_cost=("EstProjectCostNumeric", "sum"),
    )
    .sort_values("units_added", ascending=False)
)

development_permits_df = permits_df.loc[
    permits_df["PermitTypeMapped"].eq("Building")
    & permits_df["PermitTypeDesc"].isin(
        ["New", "Addition/Alteration"]
    )
].copy()

cost_summary = development_permits_df["EstProjectCostNumeric"].agg(
    permits_with_cost="count",
    median_cost="median",
    total_cost="sum",
    maximum_cost="max",
)

print(cost_summary)
print({
    "over_1m": development_permits_df[
        "EstProjectCostNumeric"
    ].ge(1_000_000).sum(),

    "over_10m": development_permits_df[
        "EstProjectCostNumeric"
    ].ge(10_000_000).sum(),

    "over_100m": development_permits_df[
        "EstProjectCostNumeric"
    ].ge(100_000_000).sum(),

    "over_1b": development_permits_df[
        "EstProjectCostNumeric"
    ].ge(1_000_000_000).sum(),
})


print(
    permits_df["StatusCurrent"]
    .value_counts()
    .to_string()
)

status = permits_df["StatusCurrent"].str.strip()

inactive_status = status.str.contains(
    r"withdrawn|cancelled|canceled|denied|void",
    case=False,
    regex=True,
    na=False,
)

issued_permits_df = permits_df.loc[
    permits_df["IssuedDate"].notna()
    & ~inactive_status
].copy()

completed_permits_df = permits_df.loc[
    permits_df["CompletedDate"].notna()
    & ~inactive_status
].copy()

active_pipeline_df = permits_df.loc[
    permits_df["AppliedDate"].notna()
    & permits_df["IssuedDate"].isna()
    & ~inactive_status
].copy()

withdrawn_audit = permits_df.loc[
    status.str.contains(
        "withdraw",
        case=False,
        na=False,
    )
]

print(
    withdrawn_audit[
        [
            "StatusCurrent",
            "AppliedDate",
            "IssuedDate",
            "CompletedDate",
        ]
    ].notna().sum()
)


top_cost_permits = (
    issued_permits_df
    .nlargest(25, "EstProjectCostNumeric")
    [
        [
            "PermitNum",
            "ParentPermitNum",
            "RelatedMup",
            "Development Site",
            "PermitTypeMapped",
            "PermitTypeDesc",
            "Description",
            "EstProjectCostNumeric",
            "AppliedDate",
            "IssuedDate",
            "CompletedDate",
            "StatusCurrent",
            "OriginalAddress1",
        ]
    ]
)


print(
    top_cost_permits.to_string(
        index=False,
        formatters={
            "EstProjectCostNumeric": "${:,.0f}".format,
        },
    )
)
