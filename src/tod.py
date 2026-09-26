import re

import pandas as pd
import geopandas as gpd
from src import oba, permits
from src.project_metadata import reconcile_support_permits, joined, use_hint
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
    corridor_permits_gdf = reconcile_support_permits(corridor_permits_gdf)
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
            "StatusCurrent": joined,
            "SourcePermitNumbers": joined,
            "ReconciliationNote": lambda values: " ".join(v for v in values if v),
            "SupportingPermitValue": "sum",
            "HousingCategory": joined,
            "Zoning": joined,
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

    consolidated_projects_gdf["UseHint"] = consolidated_projects_gdf.Description.map(use_hint)
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

def make_physical_stops_gdf(route_data, max_pair_distance_feet=500,
                            proximity_pair_distance_feet=250):
    """Conservatively group nearby platforms; retain every unmatched stop.

    Name-based matches do not depend on direction groups: some feeds put both
    platforms in one group. Abbreviated street names may omit a road type or
    compass qualifier. Different names can pair within 250 feet with opposite
    direction evidence. Every pair in a cluster must qualify, preventing chains
    from merging adjacent stations. All source names are retained in labels.
    Display order follows the first direction, then unseen stops in other
    directions, then ungrouped stops. Branches need not form one linear path.
    """
    if max_pair_distance_feet < 0 or proximity_pair_distance_feet < 0:
        raise ValueError("Stop pairing distance must be nonnegative.")
    lookup = {stop["id"]: stop for stop in route_data["stops"]}
    if not lookup:
        raise ValueError("This route has no stops to display.")

    memberships = {stop_id: set() for stop_id in lookup}
    ordered_ids = []
    for grouping_index, grouping in enumerate(route_data.get("stop_groupings", [])):
        if grouping.get("type") != "direction":
            continue
        for group_index, group in enumerate(grouping.get("stopGroups", [])):
            for stop_id in group.get("stopIds", []):
                if stop_id in lookup:
                    memberships[stop_id].add((grouping_index, group_index))
                    ordered_ids.append(stop_id)
    ordered_ids = list(dict.fromkeys(ordered_ids + list(lookup)))
    projected = make_stops_gdf([lookup[i] for i in ordered_ids]).to_crs(ANALYSIS_CRS)
    points = dict(zip(ordered_ids, projected.geometry))

    def name_key(stop):
        name = re.sub(r"\bAND\b|@", "&", (stop.get("name") or "").upper())
        parts = [re.sub(r"[^A-Z0-9]+", " ", part).strip() for part in name.split("&")]
        return tuple(sorted(part for part in parts if part))

    compass = {"N", "S", "E", "W", "NE", "NW", "SE", "SW"}
    street_types = {"ST", "AVE", "WAY", "RD", "BLVD", "DR", "PL", "CT", "LN"}
    aliases = {"STREET": "ST", "AVENUE": "AVE", "ROAD": "RD", "BOULEVARD": "BLVD",
               "DRIVE": "DR", "PLACE": "PL", "COURT": "CT", "LANE": "LN",
               "NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
               "NORTHEAST": "NE", "NORTHWEST": "NW", "SOUTHEAST": "SE", "SOUTHWEST": "SW"}
    opposite = {"N": "S", "S": "N", "E": "W", "W": "E",
                "NE": "SW", "SW": "NE", "NW": "SE", "SE": "NW"}

    def street_key(part):
        tokens = [aliases.get(token, token) for token in part.split()]
        return (tuple(t for t in tokens if t not in compass | street_types),
                frozenset(t for t in tokens if t in compass),
                frozenset(t for t in tokens if t in street_types))

    def equivalent_street(a, b):
        core_a, direction_a, type_a = street_key(a)
        core_b, direction_b, type_b = street_key(b)
        # Missing qualifiers are allowed; explicit conflicting ones are not.
        return bool(core_a) and core_a == core_b and (
            not direction_a or not direction_b or direction_a == direction_b
        ) and (not type_a or not type_b or type_a == type_b)

    def similar_intersection(left, right):
        a, b = name_key(left), name_key(right)
        if len(a) != 2 or len(b) != 2:
            return False
        return any(equivalent_street(a[0], pair[0]) and equivalent_street(a[1], pair[1])
                   for pair in (b, b[::-1]))

    def compatible(a, b):
        distance = points[a].distance(points[b])
        if distance > max_pair_distance_feet:
            return False
        left, right = lookup[a], lookup[b]
        parent = left.get("parent")
        if parent and parent == right.get("parent"):
            return True
        if name_key(left) and name_key(left) == name_key(right):
            return True
        if similar_intersection(left, right):
            return True
        if distance > proximity_pair_distance_feet:
            return False
        da = aliases.get((left.get("direction") or "").strip().upper(),
                         (left.get("direction") or "").strip().upper())
        db = aliases.get((right.get("direction") or "").strip().upper(),
                         (right.get("direction") or "").strip().upper())
        if da in opposite and db in opposite:
            return opposite[da] == db
        # Fallback when compass metadata is absent: distinct direction patterns.
        return bool(memberships[a] and memberships[b]
                    and not memberships[a].intersection(memberships[b]))

    def combined_name(members):
        names = list(dict.fromkeys(stop.get("name") or stop["id"] for stop in members))
        if len(names) == 1:
            return names[0]
        parts = [re.split(r"\s*(?:&|@|\bAND\b)\s*", name, flags=re.IGNORECASE)
                 for name in names]
        if all(len(part) == 2 for part in parts) and len({part[0] for part in parts}) == 1:
            return parts[0][0] + " & " + " / ".join(dict.fromkeys(part[1] for part in parts))
        return " / ".join(names)

    # Closest eligible matches win; ties follow source route order. No stop is
    # dropped, including branches, loops, shared terminals and missing groups.
    candidates = sorted(
        (points[a].distance(points[b]), i, j)
        for i, a in enumerate(ordered_ids)
        for j, b in enumerate(ordered_ids[i + 1:], start=i + 1)
        if compatible(a, b)
    )
    clusters = {i: [stop_id] for i, stop_id in enumerate(ordered_ids)}
    owner = {stop_id: i for i, stop_id in enumerate(ordered_ids)}
    for _, i, j in candidates:
        left, right = owner[ordered_ids[i]], owner[ordered_ids[j]]
        if left == right:
            continue
        if all(compatible(a, b) for a in clusters[left] for b in clusters[right]):
            keep, remove = min(left, right), max(left, right)
            clusters[keep].extend(clusters.pop(remove))
            for stop_id in clusters[keep]:
                owner[stop_id] = keep

    physical_stops = []
    for position, key in enumerate(sorted(clusters), start=1):
        ids = clusters[key]
        members = [lookup[stop_id] for stop_id in ids]
        physical_stops.append({
            "id": f"{route_data['route_id']}_station_{position}",
            "route_position": position,
            "name": combined_name(members),
            "source_stop_names": list(dict.fromkeys(stop.get("name") or stop["id"] for stop in members)),
            "oba_stop_ids": ids,
            "lat": sum(stop["lat"] for stop in members) / len(members),
            "lon": sum(stop["lon"] for stop in members) / len(members),
        })
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