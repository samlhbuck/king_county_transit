import src.permits as permits
import geopandas as gpd
import src.oba as oba
import pandas as pd
import matplotlib.pyplot as plt



FIRST_HILL_ROUTE_ID = "23_102638"
FIRST_HILL_STATIONS = oba.load_stops_for_route(FIRST_HILL_ROUTE_ID)
CATCHMENT_DISTANCE_FEET = 5280 / 3 # 1/3 mile in feet
START_DATE = pd.Timestamp("2004-01-01")
END_DATE = pd.Timestamp("2026-01-01")

stations_df = pd.DataFrame(FIRST_HILL_STATIONS)
spatial_stations_df = stations_df.dropna(
    subset=["lat", "lon"]
    ).copy()
stations_gdf = gpd.GeoDataFrame(
    spatial_stations_df,
    geometry=gpd.points_from_xy(
        spatial_stations_df["lon"],
        spatial_stations_df["lat"],
    ),
    crs="EPSG:4326",
)
permits_df = permits.load_development_permits()

permits_df["IsDependentPermit"] = permits_df["ParentPermitNum"].notna()

primary_development_df = permits_df.loc[
    ~permits_df["IsDependentPermit"]
].copy()

spatial_permits_df = primary_development_df.dropna(
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

permits_gdf = permits_gdf.to_crs("EPSG:2285")
stations_gdf = stations_gdf.to_crs("EPSG:2285")


station_catchments_gdf = stations_gdf.copy()
station_catchments_gdf["geometry"] = (
    station_catchments_gdf.geometry.buffer(CATCHMENT_DISTANCE_FEET)
)

streetcar_corridor = station_catchments_gdf.geometry.union_all()

print(f"Streetcar corridor area: {streetcar_corridor.area:.2f} square feet")

inside_corridor = permits_gdf.geometry.intersects(streetcar_corridor)

streetcar_permits_gdf = permits_gdf.loc[
    inside_corridor
].copy()

print(
    f"Qualifying permits within corridor: "
    f"{len(streetcar_permits_gdf):,}"
)


early_2020s_projects = (
    streetcar_permits_gdf.loc[
        streetcar_permits_gdf["IssuedDate"].between(
            "2020-01-01",
            "2024-12-31",
        )
    ]
    .nlargest(30, "EstProjectCostNumeric")
    [
        [
            "PermitNum",
            "IssuedDate",
            "OriginalAddress1",
            "PermitTypeDesc",
            "HousingCategory",
            "HousingUnitsAdded",
            "HousingUnitsRemoved",
            "HousingUnitsNet",
            "EstProjectCostNumeric",
            "Description",
        ]
    ]
)







working_gdf = streetcar_permits_gdf.copy()

working_gdf["NormalizedAddress"] = (
    working_gdf["OriginalAddress1"]
    .str.upper()
    .str.replace(r"\s+", " ", regex=True)
    .str.strip()
)

working_gdf["NormalizedDescription"] = (
    working_gdf["Description"]
    .fillna("")
    .str.upper()
    .str.replace(r"[^A-Z0-9]+", " ", regex=True)
    .str.replace(r"\s+", " ", regex=True)
    .str.strip()
)

exact_duplicate_keys = [
    "NormalizedAddress",
    "NormalizedDescription",
    "IssuedDate",
    "PermitTypeDesc",
    "EstProjectCostNumeric",
    "HousingUnitsAdded",
    "HousingUnitsRemoved",
]

working_gdf = (
    working_gdf
    .sort_values("PermitNum")
    .drop_duplicates(
        subset=exact_duplicate_keys,
        keep="first",
    )
    .copy()
)

eligible_for_project_matching = (
    working_gdf["PermitTypeDesc"].eq("New")
    & working_gdf["HousingUnitsAdded"].fillna(0).gt(0)
    & working_gdf["EstProjectCostNumeric"].notna()
    & working_gdf["NormalizedAddress"].notna()
)

project_keys = [
    "NormalizedAddress",
    "NormalizedDescription",
    "PermitTypeDesc",
    "EstProjectCostNumeric",
    "HousingUnitsAdded",
    "HousingUnitsRemoved",
]

working_gdf["ProjectSignature"] = pd.NA

working_gdf.loc[
    eligible_for_project_matching,
    "ProjectSignature",
] = (
    working_gdf.loc[
        eligible_for_project_matching,
        project_keys,
    ]
    .astype("string")
    .fillna("<NA>")
    .agg("|".join, axis=1)
)

working_gdf = working_gdf.sort_values(
    ["ProjectSignature", "IssuedDate"],
    na_position="last",
)

issue_gap = (
    working_gdf.loc[eligible_for_project_matching]
    .groupby("ProjectSignature")["IssuedDate"]
    .diff()
)

new_project = issue_gap.gt(pd.Timedelta(days=730))

working_gdf.loc[
    eligible_for_project_matching,
    "ProjectSequence",
] = (
    new_project
    .groupby(
        working_gdf.loc[
            eligible_for_project_matching,
            "ProjectSignature",
        ]
    )
    .cumsum()
    .fillna(0)
)

working_gdf["AnalyticalProjectId"] = working_gdf["PermitNum"]

working_gdf.loc[
    eligible_for_project_matching,
    "AnalyticalProjectId",
] = (
    working_gdf.loc[
        eligible_for_project_matching,
        "ProjectSignature",
    ]
    + "|"
    + working_gdf.loc[
        eligible_for_project_matching,
        "ProjectSequence",
    ].astype("Int64").astype("string")
)

project_provenance = (
    working_gdf
    .groupby("AnalyticalProjectId")
    .agg(
        SourcePermitCount=("PermitNum", "nunique"),
        SourcePermitNumbers=(
            "PermitNum",
            lambda values: ", ".join(sorted(values.unique())),
        ),
    )
)

project_permits_gdf = (
    working_gdf
    .sort_values("IssuedDate")
    .drop_duplicates(
        subset="AnalyticalProjectId",
        keep="first",
    )
    .join(
        project_provenance,
        on="AnalyticalProjectId",
    )
    .copy()
)

print(
    project_permits_gdf.loc[
        project_permits_gdf["SourcePermitCount"] > 1,
        [
            "AnalyticalProjectId",
            "SourcePermitNumbers",
            "IssuedDate",
            "OriginalAddress1",
            "HousingUnitsAdded",
            "EstProjectCostNumeric",
        ],
    ].to_string(index=False)
)

analysis_permits_gdf = project_permits_gdf.loc[
    project_permits_gdf["IssuedDate"].ge(START_DATE)
    & project_permits_gdf["IssuedDate"].lt(END_DATE)
].copy()

analysis_permits_gdf["HousingUnitsNet"] = (
    analysis_permits_gdf["HousingUnitsAdded"].fillna(0)
    - analysis_permits_gdf["HousingUnitsRemoved"].fillna(0)
)

quarterly_development = (
    analysis_permits_gdf
    .set_index("IssuedDate")
    [
        [
            "EstProjectCostNumeric",
            "HousingUnitsNet",
        ]
    ]
    .resample("QS")
    .sum()
)

# Ensure years with no qualifying development still appear.
study_quarters = pd.date_range(
    START_DATE,
    END_DATE,
    freq="QS",
    inclusive="left",
)


quarterly_development = (
    quarterly_development
    .reindex(study_quarters, fill_value=0)
)

quarterly_development["ConstructionValueMillions"] = (
    quarterly_development["EstProjectCostNumeric"] / 1_000_000
)

fig, axes = plt.subplots(
    nrows=2,
    ncols=1,
    figsize=(11, 8),
    sharex=True,
)

axes[0].plot(
    quarterly_development.index,
    quarterly_development["ConstructionValueMillions"],
    color="#4472C4",
)

axes[0].set_ylabel("Estimated value ($ millions)")
axes[0].set_title(
    "Development permitted within ⅓ mile of First Hill Streetcar stops"
)

axes[1].plot(
    quarterly_development.index,
    quarterly_development["HousingUnitsNet"],
    color="#70AD47",
)

axes[1].axhline(0, color="black", linewidth=0.8)
axes[1].set_ylabel("Net housing units")
axes[1].set_xlabel("Permit issue quarter")

milestones = {
    "Preconstruction": pd.Timestamp("2011-01-01"),
    "Groundbreaking": pd.Timestamp("2012-04-23"),
    "Construction complete": pd.Timestamp("2014-12-01"),
    "Service begins": pd.Timestamp("2016-01-23"),
}

for axis in axes:
    for label, date in milestones.items():
        axis.axvline(
            date,
            color="#666666",
            linestyle="--",
            linewidth=1,
            alpha=0.7,
        )

for label, date in milestones.items():
    axes[0].annotate(
        label,
        xy=(date, 1),
        xycoords=("data", "axes fraction"),
        xytext=(3, -3),
        textcoords="offset points",
        rotation=90,
        va="top",
        fontsize=8,
    )

plt.tight_layout()
plt.show()

analysis_permits_gdf["AddsHousing"] = (
    analysis_permits_gdf["HousingUnitsAdded"].fillna(0) > 0
)

quarterly_cost_by_type = (
    analysis_permits_gdf
    .set_index("IssuedDate")
    .groupby("AddsHousing")["EstProjectCostNumeric"]
    .resample("QS")
    .sum()
    .unstack(level=0)
    .fillna(0)
    .rename(
        columns={
            False: "NoHousingAdded",
            True: "HousingAdded",
        }
    )
    / 1_000_000
)

quarterly_cost_by_type.plot(
    figsize=(13, 5),
    marker="o",
    markersize=3,
)

plt.ylabel("Estimated permitted value ($ millions)")
plt.xlabel("Permit issue quarter")
plt.title("Streetcar-corridor project value by housing contribution")
plt.legend(
    [
        "Projects adding no housing",
        "Projects adding housing",
    ]
)
plt.show()