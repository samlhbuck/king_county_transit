
import pandas as pd
import src.oba as oba
import src.tod as tod
import src.permits as permits
import matplotlib.colors as colors
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch
import geopandas as gpd

def plot_assignment_map(results):

    MAP_CRS = "EPSG:3857"

    projects = (
        results["projects_with_nearest_stop"]
        .to_crs(MAP_CRS)
        .copy()
    )

    stops = (
        results["physical_stops_gdf"]
        .to_crs(MAP_CRS)
        .sort_values("route_position")
    )

    route_lines = (
        results["route_lines_gdf"]
        .to_crs(MAP_CRS)
    )

    
    corridor = (
        gpd.GeoSeries(
            [results["corridor_geometry"]],
            crs="EPSG:2285",
        )
        .to_crs(MAP_CRS)
    )

    color_map = plt.colormaps["tab10"]

    stop_colors = {
        stop_id: color_map(position)
        for position, stop_id in enumerate(stops["id"])
    }

    unmatched = ~projects["NearestStopId"].isin(
        stop_colors
    )


    print("Unmatched projects:", unmatched.sum())

    if unmatched.any():
        print(
            projects.loc[
                unmatched,
                ["NearestStopId", "NormalizedAddress"],
            ].head(20)
        )

    project_colors = [
        stop_colors.get(stop_id, "#BDBDBD")
        for stop_id in projects["NearestStopId"]
    ]


    fig, axis = plt.subplots(figsize=(10, 12))

    corridor.plot(
        ax=axis,
        color="#eeeeee",
        edgecolor="#777777",
        linewidth=1,
        alpha=0.25,
    )

    route_lines.plot(
        ax=axis,
        color="black",
        linewidth=2.5,
        zorder=2,
    )
    projects.plot(
        ax=axis,
        color=project_colors,
        markersize=12,
        alpha=0.5,
        zorder=3,
    )

    stops.plot(
        ax=axis,
        facecolor="white",
        edgecolor="black",
        markersize=75,
        linewidth=1.5,
        zorder=4,
    )

    for stop in stops.itertuples():
        axis.annotate(
            str(stop.route_position),
            xy=(stop.geometry.x, stop.geometry.y),
            ha="center",
            va="center",
            fontsize=8,
            fontweight="bold",
            zorder=5,
        )

    legend_items = [
        Patch(
            facecolor=stop_colors[stop.id],
            label=f"{stop.route_position}. {stop.name}",
        )
        for stop in stops.itertuples()
    ]

    axis.legend(
        handles=legend_items,
        title="Nearest physical stop",
        loc="upper left",
        bbox_to_anchor=(1.02, 1),
    )

    axis.set_title(
        "First Hill Streetcar development assignments\n"
        "Projects colored by nearest physical stop"
    )

    axis.set_axis_off()
    axis.set_aspect("equal")

    plt.tight_layout()
    plt.show()


def plot_stop_development(
    stop_summary,
    physical_stops_gdf,
    metric,
    title,
    ylabel,
    scale=1,
):
    stops = physical_stops_gdf.sort_values(
        "route_position"
    )

    stop_ids = stops["id"].tolist()
    stop_names = stops["name"].tolist()

    pivot = (
        stop_summary
        .pivot_table(
            index="NearestStopId",
            columns="IssueYear",
            values=metric,
            aggfunc="sum",
            fill_value=0,
        )
        .reindex(stop_ids, fill_value=0)
    )

    years = sorted(pivot.columns)
    x_positions = np.arange(len(stops))
    bottoms = np.zeros(len(stops))

    color_map = plt.colormaps["viridis"]
    color_norm = colors.Normalize(
        vmin=min(years),
        vmax=max(years),
    )

    fig, axis = plt.subplots(figsize=(13, 7))

    for year in years:
        values = pivot[year].to_numpy() / scale

        axis.bar(
            x_positions,
            values,
            bottom=bottoms,
            color=color_map(color_norm(year)),
            width=0.7,
        )

        bottoms += values

    # Schematic route line and stop locations
    axis.plot(
        x_positions,
        np.zeros(len(stops)),
        color="black",
        linewidth=2,
        zorder=3,
    )

    axis.scatter(
        x_positions,
        np.zeros(len(stops)),
        color="white",
        edgecolor="black",
        zorder=4,
    )

    axis.set_xticks(x_positions)
    axis.set_xticklabels(
        stop_names,
        rotation=40,
        ha="right",
    )

    axis.set_ylabel(ylabel)
    axis.set_title(title)
    axis.grid(axis="y", alpha=0.2)
    axis.margins(y=0.08)
    axis.set_title(
        f"{title}\n"
        "Projects assigned by nearest physical stop, 2004–2025"
    )

    color_bar = fig.colorbar(
        plt.cm.ScalarMappable(
            norm=color_norm,
            cmap=color_map,
        ),
        ax=axis,
    )
    color_bar.set_label("Permit issue year")

    plt.tight_layout()
    plt.show()

ROUTE_ID = "23_102638"
CATCHMENT_DISTANCE_FEET = 5280 / 3  # 1/3 mile in feet
START_DATE = pd.Timestamp("2004-01-01")
END_DATE = pd.Timestamp("2026-01-01")
FREQUENCY = "QS"  # Quarterly frequency

results = tod.analyze_route(
    route_id=ROUTE_ID,
    catchment_distance_feet=CATCHMENT_DISTANCE_FEET,
    start_date=START_DATE,
    end_date=END_DATE,
    frequency=FREQUENCY,
)

print("\n--- Route analysis review ---")
print("Route:", results["route_id"])
print("Stops:", len(results["stops_gdf"]))
print("Stop groupings:", len(results["stop_groupings"]))
print("Polylines:", len(results["route_polylines"]))

print(
    "Corridor area:",
    f"{results['corridor_geometry'].area / 5280**2:.2f}",
    "square miles",
)

print(
    "Permit records in corridor:",
    len(results["corridor_permits_gdf"]),
)

print(
    "Consolidated projects:",
    len(results["consolidated_projects_gdf"]),
)

print(
    "Nearest-stop CRS:",
    results["projects_with_nearest_stop"].crs,
)

print(
    "Projects without a nearest stop:",
    results["projects_with_nearest_stop"][
        "NearestStopId"
    ].isna().sum(),
)

print("\nPeriod summary:")
print(results["period_summary"].to_string())

assert (
    results["corridor_permits_gdf"].crs.to_epsg() == 2285
)

assert (
    results["projects_with_nearest_stop"].crs.to_epsg() == 2285
)


for grouping in results["stop_groupings"]:
    print(
        "\nGrouping:",
        grouping.get("type"),
        "ordered:",
        grouping.get("ordered"),
    )

    for stop_group in grouping.get("stopGroups", []):
        print(
            stop_group.get("id"),
            stop_group.get("name", {}).get("name"),
            stop_group.get("stopIds"),
        )

print(results["period_summary"])
print(results["projects_with_nearest_stop"].head())

physical_stops_gdf = results["physical_stops_gdf"].copy()

print(
    physical_stops_gdf[
        [
            "route_position",
            "name",
            "oba_stop_ids",
            "lat",
            "lon",
        ]
    ].to_string(index=False)
)

plot_stop_development(
    results["stop_period_summary"],
    results["physical_stops_gdf"],
    metric="units_added",
    title= "Gross housing units added by nearest streetcar stop",
    ylabel="Gross housing units added",
)

plot_stop_development(
    results["stop_period_summary"],
    results["physical_stops_gdf"],
    metric="estimated_value",
    title="Estimated project value by nearest streetcar stop",
    ylabel="Estimated permitted value ($ millions)",
    scale=1_000_000,
)

plot_assignment_map(results)