# src/permits.py
from pathlib import Path

import pandas as pd
import requests

PROJECT_ROOT = Path(__file__).resolve().parents[1]

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


DATE_COLUMNS = [
    "AppliedDate",
    "IssuedDate",
    "CompletedDate",
    "ExpiresDate",
]

def download_permits(refresh=False):
    if PERMITS_FILE.exists() and not refresh:
        return PERMITS_FILE

    PERMITS_FILE.parent.mkdir(parents=True, exist_ok=True)

    response = requests.get(PERMITS_URL, timeout=120)
    response.raise_for_status()

    PERMITS_FILE.write_bytes(response.content)

    return PERMITS_FILE


def fetch_and_save_permits(refresh=False):
    if PERMITS_ANALYSIS_FILE.exists() and not refresh:
        return PERMITS_ANALYSIS_FILE

    permit_path = download_permits(refresh=refresh)
    permits_df = pd.read_csv(permit_path, low_memory=False)

    missing_columns = [
        column
        for column in PERMIT_COLUMNS
        if column not in permits_df.columns
    ]

    if missing_columns:
        raise ValueError(
            f"Permit dataset is missing columns: {missing_columns}"
        )

    selected_df = permits_df[PERMIT_COLUMNS].copy()

    PERMITS_ANALYSIS_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    selected_df.to_csv(
        PERMITS_ANALYSIS_FILE,
        index=False,
    )

    return PERMITS_ANALYSIS_FILE



def load_permits(refresh=False):
    permit_path = fetch_and_save_permits(refresh=refresh)

    return pd.read_csv(
        permit_path,
        low_memory=False,
        parse_dates=DATE_COLUMNS,
    )

def prepare_permits(permits_df):
    permits_df = permits_df.copy()

    cost_text = (
        permits_df["EstProjectCost"]
        .astype("string")
        .str.replace("$", "", regex=False)
        .str.replace(",", "", regex=False)
        .str.strip()
    )

    permits_df["EstProjectCostNumeric"] = pd.to_numeric(
        cost_text,
        errors="coerce",
    )

    added = permits_df["HousingUnitsAdded"]
    removed = permits_df["HousingUnitsRemoved"]

    units_recorded = added.notna() & removed.notna()
    units_changed = (
        added.fillna(0).ne(0)
        | removed.fillna(0).ne(0)
    )

    permits_df["HousingUnitDataStatus"] = "Not recorded"

    permits_df.loc[
        units_recorded & ~units_changed,
        "HousingUnitDataStatus",
    ] = "Recorded, no change"

    permits_df.loc[
        units_changed,
        "HousingUnitDataStatus",
    ] = "Units added or removed"

    permits_df["HousingUnitsNet"] = (
        added - removed
    ).astype("Int64")

    return permits_df

def select_development_permits(
    permits_df,
    major_alteration_threshold=1_000_000,
):
    status = permits_df["StatusCurrent"].str.strip()

    inactive_status = status.str.contains(
        r"withdrawn|cancelled|canceled|denied|void",
        case=False,
        regex=True,
        na=False,
    )

    issued_buildings = (
        permits_df["IssuedDate"].notna()
        & ~inactive_status
        & permits_df["PermitTypeMapped"].eq("Building")
    )

    units_changed = (
        permits_df["HousingUnitsAdded"].fillna(0).ne(0)
        | permits_df["HousingUnitsRemoved"].fillna(0).ne(0)
    )

    new_construction = permits_df["PermitTypeDesc"].eq("New")

    major_alteration = (
        permits_df["PermitTypeDesc"].eq("Addition/Alteration")
        & (
            units_changed
            | permits_df["EstProjectCostNumeric"].ge(
                major_alteration_threshold
            )
        )
    )

    return permits_df.loc[
        issued_buildings
        & (new_construction | major_alteration)
    ].copy()