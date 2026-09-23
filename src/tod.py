import pandas as pd
import geopandas as gpd
from src import oba, permits
import polyline
from shapely.geometry import LineString

SOURCE_CRS = "EPSG:4326"
ANALYSIS_CRS = "EPSG:2285"

def make_stops_gdf(stops):
    """
    Convert a list of stop dictionaries into a GeoDataFrame.
    """
    stops_df = pd.DataFrame(stops)
    stops_gdf = gpd.GeoDataFrame(
        stops_df,
        geometry=gpd.points_from_xy(stops_df["lon"], stops_df["lat"]),
        crs="EPSG:4326",
    )
    return stops_gdf

def make_permits_gdf(permits_df):
    """
    Convert a DataFrame of permits into a GeoDataFrame.
    """
    spatial_permits_df = permits_df.dropna(
        subset=["Latitude", "Longitude"]
    ).copy()

    permits_gdf = gpd.GeoDataFrame(
        spatial_permits_df,
        geometry=gpd.points_from_xy(
            spatial_permits_df["Longitude"],
            spatial_permits_df["Latitude"],
        ),
        crs="EPSG:4326",
    )
    return permits_gdf


def build_corridor(stops_gdf, catchment_distance_feet):
    projected_stops_gdf = stops_gdf.to_crs(ANALYSIS_CRS)

    return (
        projected_stops_gdf.geometry
        .buffer(catchment_distance_feet)
        .union_all()
    )


def select_corridor_permits(permits_gdf, corridor_geometry):
    projected_permits_gdf = permits_gdf.to_crs(ANALYSIS_CRS)

    return projected_permits_gdf.loc[
        projected_permits_gdf.geometry.intersects(corridor_geometry)
    ].copy()

def consolidate_projects(corridor_permits_gdf):
    """
    Consolidate permits into unique projects based on address and description.
    """
    corridor_permits_gdf["IsDependentPermit"] = (
        corridor_permits_gdf["ParentPermitNum"].notna()
    )

    primary_development_df = corridor_permits_gdf.loc[
        ~corridor_permits_gdf["IsDependentPermit"]
    ].copy()

        
    primary_development_df["NormalizedAddress"] = (
        primary_development_df["OriginalAddress1"]
        .str.upper()
        .str.replace(r"\s+", " ", regex=True)
        .str.strip()
    )

    primary_development_df["NormalizedDescription"] = (
        primary_development_df["Description"]
        .fillna("")
        .str.upper()
        .str.replace(r"[^A-Z0-9]+", " ", regex=True)
        .str.replace(r"\s+", " ", regex=True)
        .str.strip()
    )

    project_keys = [
        "NormalizedAddress",
        "NormalizedDescription",
        "PermitTypeDesc",
        "EstProjectCostNumeric",
        "HousingUnitsAdded",
        "HousingUnitsRemoved",
    ]

    consolidated_projects_df = (
        primary_development_df
        .groupby(
            project_keys,
            as_index=False,
            dropna=False,
        )
        .agg({
            "OriginalAddress1": "first",
            "Description": "first",
            "AppliedDate": "min",
            "IssuedDate": "min",
            "CompletedDate": "max",
            "ExpiresDate": "max",
            "Latitude": "mean",
            "Longitude": "mean",
        })
    )

    consolidated_projects_gdf = gpd.GeoDataFrame(
        consolidated_projects_df,
        geometry=gpd.points_from_xy(
            consolidated_projects_df["Longitude"],
            consolidated_projects_df["Latitude"],
        ),
        crs="EPSG:4326",
    )

    consolidated_projects_gdf["HousingUnitsNet"] = (
        consolidated_projects_gdf["HousingUnitsAdded"].fillna(0)
        - consolidated_projects_gdf["HousingUnitsRemoved"].fillna(0)
    )


    return consolidated_projects_gdf

def summarize_by_period(projects_df, start_date, end_date, freq="QS"):
    projects_df = projects_df.copy()

    projects_df = projects_df.loc[
        projects_df["IssuedDate"].ge(start_date)
        & projects_df["IssuedDate"].lt(end_date)
    ].copy()

    projects_df["HousingUnitsNet"] = (
        projects_df["HousingUnitsAdded"].fillna(0)
        - projects_df["HousingUnitsRemoved"].fillna(0)
    )

    return (
        projects_df
        .set_index("IssuedDate")
        .resample(freq)
        .agg(
            projects=("EstProjectCostNumeric", "size"),
            estimated_value=("EstProjectCostNumeric", "sum"),
            units_added=("HousingUnitsAdded", "sum"),
            units_removed=("HousingUnitsRemoved", "sum"),
            net_units=("HousingUnitsNet", "sum"),
        )
    )
def assign_nearest_stop(
    projects_gdf,
    stops_gdf,
    max_distance_feet,
):
    projects_gdf = projects_gdf.to_crs(ANALYSIS_CRS)
    stops_gdf = stops_gdf.to_crs(ANALYSIS_CRS)


    nearest_stop_ids = []
    nearest_stop_distances = []

    for project in projects_gdf.itertuples():
        distances = stops_gdf.geometry.distance(
            project.geometry
        )
        nearest_index = distances.idxmin()
        minimum_distance = distances.loc[nearest_index]

        if minimum_distance <= max_distance_feet:
            nearest_stop_ids.append(
                stops_gdf.loc[nearest_index, "id"]
            )
            nearest_stop_distances.append(
                minimum_distance
            )
        else:
            nearest_stop_ids.append(None)
            nearest_stop_distances.append(pd.NA)

    projects_gdf["NearestStopId"] = nearest_stop_ids
    projects_gdf["NearestStopDistanceFeet"] = (
        nearest_stop_distances
    )
    projects_gdf["ProximityBand"] = pd.cut(
        projects_gdf["NearestStopDistanceFeet"],
        bins=[0, 660, 1320, 1760],
        labels=[
            "Immediate",
            "Close walk",
            "Outer catchment",
        ],
        include_lowest=True,
    )
    return projects_gdf

def analyze_route(route_id,catchment_distance_feet,
                    start_date, end_date,
                    frequency="QS"):
    """
    Analyze development permits in relation to a specific transit route.
    """
    # Fetch stops and permits data
    route_data = oba.load_route_data(route_id)
    route_stops = route_data["stops"]
    
    stop_groupings = route_data["stop_groupings"]
    route_polylines = route_data["polylines"]

    permits_df = permits.load_development_permits()
    stops_gdf = make_stops_gdf(route_stops)
    physical_stops_gdf = make_physical_stops_gdf(
        route_data
    )
    permits_gdf = make_permits_gdf(permits_df)
    corridor_geometry = build_corridor(stops_gdf, catchment_distance_feet)
    corridor_permits_gdf = select_corridor_permits(permits_gdf, corridor_geometry)
    consolidated_projects_gdf = consolidate_projects(corridor_permits_gdf)
    period_summary = summarize_by_period(consolidated_projects_gdf,
                                          start_date, end_date, freq=frequency)
    projects_with_nearest_stop = assign_nearest_stop(
        consolidated_projects_gdf,
        physical_stops_gdf,
        float("inf"),
    )
    stop_period_summary = summarize_projects_by_stop(
        projects_with_nearest_stop,
        physical_stops_gdf,
        start_date,
        end_date,
    )
    route_lines_gdf = make_route_lines_gdf(
        route_polylines
    )

    stop_profiles_gdf = build_stop_profiles(
        projects_with_nearest_stop,
        physical_stops_gdf,
        start_date,
        end_date
    )

    return {
    "route_id": route_id,
    "stop_groupings": stop_groupings,
    "route_polylines": route_polylines,
    "stops_gdf": stops_gdf,
    "physical_stops_gdf": physical_stops_gdf,
    "permits_gdf": permits_gdf,
    "corridor_geometry": corridor_geometry,
    "corridor_permits_gdf": corridor_permits_gdf,
    "consolidated_projects_gdf": consolidated_projects_gdf,
    "period_summary": period_summary,
    "projects_with_nearest_stop": projects_with_nearest_stop,
    "stop_period_summary": stop_period_summary,
    "route_lines_gdf": route_lines_gdf,
    "stop_profiles_gdf": stop_profiles_gdf
}

def summarize_projects_by_stop(
    projects_gdf,
    physical_stops_gdf,
    start_date,
    end_date,
):
    projects_df = projects_gdf.loc[
        projects_gdf["IssuedDate"].ge(start_date)
        & projects_gdf["IssuedDate"].lt(end_date)
        & projects_gdf["NearestStopId"].notna()
    ].copy()

    projects_df["IssueYear"] = (
        projects_df["IssuedDate"].dt.year
    )

    projects_df["HousingUnitsNet"] = (
        projects_df["HousingUnitsAdded"].fillna(0)
        - projects_df["HousingUnitsRemoved"].fillna(0)
    )

    stop_summary = (
        projects_df
        .groupby(
            ["NearestStopId", "IssueYear"],
            as_index=False,
        )
        .agg(
            projects=("IssuedDate", "size"),
            estimated_value=("EstProjectCostNumeric", "sum"),
            units_added=("HousingUnitsAdded", "sum"),
            units_removed=("HousingUnitsRemoved", "sum"),
            net_units=("HousingUnitsNet", "sum"),
        )
    )

    stop_metadata = (
        physical_stops_gdf[
            ["id", "route_position", "name"]
        ]
        .rename(columns={"id": "NearestStopId"})
    )

    return stop_summary.merge(
        stop_metadata,
        on="NearestStopId",
        how="left",
    )

def make_physical_stops_gdf(route_data):
    direction_grouping = next(
        grouping
        for grouping in route_data["stop_groupings"]
        if grouping.get("type") == "direction"
    )

    stop_groups = direction_grouping["stopGroups"]

    direction_a_ids = stop_groups[0]["stopIds"]
    direction_b_ids = list(
        reversed(stop_groups[1]["stopIds"])
    )

    if len(direction_a_ids) != len(direction_b_ids):
        raise ValueError(
            "Directional stop lists have different lengths."
        )

    stop_lookup = {
        stop["id"]: stop
        for stop in route_data["stops"]
    }

    physical_stops = []

    for position, (stop_a_id, stop_b_id) in enumerate(
        zip(direction_a_ids, direction_b_ids),
        start=1,
    ):
        stop_a = stop_lookup[stop_a_id]
        stop_b = stop_lookup[stop_b_id]

        oba_stop_ids = list(
            dict.fromkeys([stop_a_id, stop_b_id])
        )

        physical_stops.append(
            {
                "id": f"{route_data['route_id']}_station_{position}",
                "route_position": position,
                "name": stop_a["name"],
                "oba_stop_ids": oba_stop_ids,
                "lat": (stop_a["lat"] + stop_b["lat"]) / 2,
                "lon": (stop_a["lon"] + stop_b["lon"]) / 2,
            }
        )

    return make_stops_gdf(physical_stops)

def make_route_lines_gdf(route_polylines):
    route_lines = []

    for route_polyline in route_polylines:
        encoded_points = route_polyline.get("points")

        if not encoded_points:
            continue

        decoded_points = polyline.decode(encoded_points)

        route_lines.append(
            LineString(
                (longitude, latitude)
                for latitude, longitude in decoded_points
            )
        )

    return gpd.GeoDataFrame(
        geometry=route_lines,
        crs=SOURCE_CRS,
    )

def build_stop_profiles(
    projects_gdf,
    physical_stops_gdf,
    start_date,
    end_date,
):
    projects = projects_gdf.loc[
        projects_gdf["IssuedDate"].ge(start_date)
        & projects_gdf["IssuedDate"].lt(end_date)
        & projects_gdf["NearestStopId"].notna()
    ].copy()

    projects["ImmediateUnitsAdded"] = (
        projects["HousingUnitsAdded"]
        .fillna(0)
        .where(
            projects["ProximityBand"].eq("Immediate"),
            0,
        )
    )

    projects["ImmediateProjectValue"] = (
        projects["EstProjectCostNumeric"]
        .fillna(0)
        .where(
            projects["ProximityBand"].eq("Immediate"),
            0,
        )
    )

    stop_profiles = (
        projects
        .groupby(
            "NearestStopId",
            as_index=False,
        )
        .agg(
            development_projects=("IssuedDate", "size"),
            estimated_value=(
                "EstProjectCostNumeric",
                "sum",
            ),
            gross_units_added=(
                "HousingUnitsAdded",
                "sum",
            ),
            units_removed=(
                "HousingUnitsRemoved",
                "sum",
            ),
            net_units=(
                "HousingUnitsNet",
                "sum",
            ),
            median_distance_feet=(
                "NearestStopDistanceFeet",
                "median",
            ),
            immediate_units_added=(
                "ImmediateUnitsAdded",
                "sum",
            ),
            immediate_project_value=(
                "ImmediateProjectValue",
                "sum",
            ),
        )
    )

    stop_metadata = (
        physical_stops_gdf[
            [
                "id",
                "route_position",
                "name",
                "oba_stop_ids",
                "geometry",
            ]
        ]
        .rename(
            columns={
                "id": "NearestStopId",
                "name": "StopName",
            }
        )
    )

    stop_profiles = stop_metadata.merge(
        stop_profiles,
        on="NearestStopId",
        how="left",
    )

    numeric_columns = [
        "development_projects",
        "estimated_value",
        "gross_units_added",
        "units_removed",
        "net_units",
        "immediate_units_added",
        "immediate_project_value",
    ]

    stop_profiles[numeric_columns] = (
        stop_profiles[numeric_columns].fillna(0)
    )

    stop_profiles["ImmediateHousingShare"] = (
        stop_profiles["immediate_units_added"]
        .div(
            stop_profiles["gross_units_added"]
            .replace(0, pd.NA)
        )
    )

    return (
        gpd.GeoDataFrame(
            stop_profiles,
            geometry="geometry",
            crs=physical_stops_gdf.crs,
        )
        .sort_values("route_position")
    )