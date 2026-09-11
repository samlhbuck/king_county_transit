from pathlib import Path

import pandas as pd

from src.permits import (
        load_permits,
        prepare_permits,
        select_development_permits,
        fetch_and_save_permits
    )


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "outputs" / "tables"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

permits_path = fetch_and_save_permits(refresh = False)

# Visualize permits issued over time in line catchment area
## should it be line generalizable?
permits_df = pd.read_csv(permits_path)
column_profile = pd.DataFrame({
    "dtype": permits_df.dtypes.astype(str),
    "missing": permits_df.isna().sum(),
    "missing_pct": permits_df.isna().mean().mul(100).round(1),
    "unique": permits_df.nunique(dropna=True),
})

print(column_profile)

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
zero_unit_permits = (permits_df["HousingUnitsAdded"].eq(0) & permits_df["HousingUnitsRemoved"].eq(0)).sum()
print("" \
"Zero unit permits:", zero_unit_permits)

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
permit_type_summary = (permits_df.groupby("PermitTypeDesc", dropna=False)
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
    .sort_values("units_added", ascending=False))
print(permit_type_summary)


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

housing_category_summary.to_csv(
    OUTPUT_DIR / "housing_category_summary.csv"
)

permit_type_summary.to_csv(
    OUTPUT_DIR / "permit_type_summary.csv"
)

top_cost_permits.to_csv(
    OUTPUT_DIR / "top_cost_permits_audit.csv",
    index=False,
)

permits_df = load_permits(refresh=False)
permits_df = prepare_permits(permits_df)

development_permits_df = select_development_permits(
    permits_df,
    major_alteration_threshold=1_000_000,
)