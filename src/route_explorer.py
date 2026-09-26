"""Dashboard adapter around the existing First Hill/TOD analysis interfaces."""
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import geopandas as gpd
from shapely.geometry import mapping, box
from shapely.ops import unary_union

from analysis import first_hill
from src import basemap, oba, permits as permit_source, tod
from src.route_history import load_route_history
from src import zoning
from src.transfers import stop_transfers
from src.directional_access import access_model, assign_access, area_frame


def records(frame, columns):
    # pandas handles nullable numbers and timestamps as JSON null/ISO strings.
    return json.loads(frame[columns].to_json(orient="records", date_format="iso"))


def route_catalog():
    if not oba.AGENCY_ROUTE_FILE.exists():
        oba.fetch_and_save_agencies()
        oba.fetch_and_save_agency_routes()
    return oba.load_agency_routes()


def refresh_sources(route_id, source):
    """Use the repository's retrieval pipeline, retaining its local caches."""
    if source == "transit":
        oba.load_route_data(route_id, refresh=True)
    elif source == "permits":
        permit_source.fetch_and_save_permits(refresh=True)
        permit_source.save_development_permits()
    elif source == "zoning":
        zoning.download_zoning()
    elif source == "streets":
        basemap.load_seattle_streets(force_refresh=True)
    else:
        raise ValueError("Unknown data source")


def build_dashboard_data(route_id=first_hill.ROUTE_ID):
    route_data = oba.load_route_data(route_id)
    if not route_data["stops"]:
        raise ValueError("This route has no stops to display.")
    if not permit_source.DEVELOPMENT_PERMITS_FILE.exists():
        permit_source.save_development_permits()
    results = tod.analyze_route(
        route_id, first_hill.CATCHMENT_DISTANCE_FEET,
        first_hill.START_DATE, first_hill.END_DATE, first_hill.FREQUENCY,
    )
    stops = results["physical_stops_gdf"].to_crs(tod.ANALYSIS_CRS)
    projects = results["projects_with_nearest_stop"].copy()
    # Raw qualifying permit counts include dependent records. Project outcomes
    # come only from the existing consolidated primary-project pipeline.
    permits = tod.assign_nearest_stop(
        results["corridor_permits_gdf"], stops, float("inf")
    )
    access = access_model(route_data, stops, first_hill.CATCHMENT_DISTANCE_FEET)
    projects = assign_access(projects, access)
    permits = assign_access(permits, access)
    # Web Mercator display coordinates align with geographic map tiles.
    display_stops = stops.to_crs("EPSG:3857")
    projects = projects.to_crs("EPSG:3857")
    for frame in (display_stops, projects):
        frame["x"] = frame.geometry.x
        frame["y"] = frame.geometry.y
    corridor = results["corridor_geometry"]
    assignments = area_frame(access, stops)
    display_assignments = assignments.to_crs("EPSG:3857")
    lines = results["route_lines_gdf"].to_crs(tod.ANALYSIS_CRS)
    area = box(*gpd.GeoSeries([corridor, *lines.geometry], crs=tod.ANALYSIS_CRS).total_bounds).buffer(2000)
    display_area = gpd.GeoSeries([area], crs=tod.ANALYSIS_CRS).to_crs("EPSG:3857").iloc[0]
    streets = basemap.load_seattle_streets().to_crs(tod.ANALYSIS_CRS)
    streets = gpd.clip(streets, area)
    streets.geometry = streets.geometry.simplify(8)
    streets = streets.to_crs("EPSG:3857")
    dates = permits.IssuedDate.dropna()
    history = load_route_history(route_id)
    today = datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()
    return {
        "routeName": "First Hill Streetcar" if route_id == first_hill.ROUTE_ID else route_id,
        "routeId": route_id,
        "catchmentFeet": first_hill.CATCHMENT_DISTANCE_FEET,
        "bounds": list(display_area.bounds),
        "catchments": {row.id: mapping(row.geometry) for row in display_assignments.itertuples()},
        "catchmentBounds": {row.id: list(row.geometry.bounds) for row in display_assignments.itertuples() if not row.geometry.is_empty},
        "catchmentLabels": {row.id: list(row.geometry.representative_point().coords)[0]
                            for row in display_assignments.itertuples() if not row.geometry.is_empty},
        "zoning": zoning.route_zoning(stops, corridor, area, first_hill.CATCHMENT_DISTANCE_FEET, assignment_areas=assignments, direction_areas={k: v for k, v in access['areas'].items() if k != 'all'}),
        "transfers": stop_transfers(route_data, stops, route_catalog()),
        "directions": access["directions"],
        "directionNote": access["note"],
        "directionCorridors": {key: mapping(gpd.GeoSeries([unary_union(list(regions.values()))],
            crs=tod.ANALYSIS_CRS).to_crs("EPSG:3857").iloc[0]) for key, regions in access['areas'].items()},
        "directionCatchments": {key: {row.id: mapping(row.geometry) for row in
            area_frame(access, stops, key).to_crs("EPSG:3857").itertuples()} for key in access['areas']},
        "routeHistory": history,
        "defaultPreset": "life" if history else "all",
        "defaultStart": history["service_start_date"] if history else (dates.min().date().isoformat() if len(dates) else first_hill.START_DATE.date().isoformat()),
        "defaultEnd": today,
        "minDate": dates.min().date().isoformat() if len(dates) else None,
        "maxDate": dates.max().date().isoformat() if len(dates) else None,
        "streets": [mapping(g) for g in streets.geometry],
        "route": [mapping(g) for g in results["route_lines_gdf"].to_crs("EPSG:3857").geometry],
        "corridor": mapping(gpd.GeoSeries([corridor], crs=tod.ANALYSIS_CRS).to_crs("EPSG:3857").iloc[0]),
        "stops": records(display_stops, ["id", "route_position", "name", "x", "y"]),
        "projects": records(projects, ["OriginalAddress1", "Description", "IssuedDate",
            "NearestStopId", "StopAssignments", "HousingUnitsAdded", "HousingUnitsRemoved",
            "HousingUnitsNet", "EstProjectCostNumeric", "StatusCurrent", "PermitTypeDesc", "UseHint",
            "HousingCategory", "Zoning", "SourcePermitNumbers", "ReconciliationNote", "SupportingPermitValue", "x", "y"]),
        "permits": records(permits, ["PermitNum", "IssuedDate", "NearestStopId", "StopAssignments", "StatusCurrent", "PermitTypeDesc"]),
    }
