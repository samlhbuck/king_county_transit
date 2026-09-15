from pathlib import Path

import geopandas as gpd
import requests


PROJECT_ROOT = Path(__file__).resolve().parents[1]

SEATTLE_STREETS_FILE = (
    PROJECT_ROOT
    / "data"
    / "raw"
    / "seattle_streets.geojson"
)

SEATTLE_STREETS_URL = (
    "https://data-seattlecitygis.opendata.arcgis.com/"
    "api/download/v1/items/"
    "f91318f1cc43489fb0e7aca2fde22899/"
    "geojson?layers=0"
)


def load_seattle_streets(force_refresh=False):
    """Download Seattle Streets once, then use the cached file."""

    if force_refresh or not SEATTLE_STREETS_FILE.exists():
        SEATTLE_STREETS_FILE.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        response = requests.get(
            SEATTLE_STREETS_URL,
            timeout=120,
        )
        response.raise_for_status()

        temporary_file = SEATTLE_STREETS_FILE.with_suffix(
            ".geojson.tmp"
        )
        temporary_file.write_bytes(response.content)
        temporary_file.replace(SEATTLE_STREETS_FILE)

    return gpd.read_file(SEATTLE_STREETS_FILE)