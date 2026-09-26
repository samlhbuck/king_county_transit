# King County Transit · Route Explorer

A local interactive route dashboard built on the existing OneBusAway, Seattle
permit, TOD and First Hill analysis modules. First Hill Streetcar is the default.

## Run

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Open **http://127.0.0.1:8000**. Use `--port 8001` for a different port. The
server binds to localhost. Cached datasets load without an API key. Set
`OBA_API_KEY=...` in the ignored `.env` file to retrieve uncached transit data or
refresh route geometry and stops. The existing reference route catalog is used;
if absent, it is retrieved through `src.oba`.

- Select a route, issue-date range, direction and comparison metric.
- Filter current permit status and new construction versus alterations. Issued
  status is not verification that construction has started.
- Click a map stop, a stop comparison row or the stop selector to
  update its development summary and project table.
- View permit counts, consolidated project counts, gross units added, units
  removed, net units and estimated development value.
- Pan/zoom the map, toggle projects/catchments, and reset filters or the map view.
- Use **Refresh selected source** to retrieve route geometry/stops, Seattle
  permits or Seattle streets. Downloads use the existing retrieval functions
  and update their caches. Permit and street downloads can take several minutes.
  Failed requests keep the previous dashboard visible.

The app uses OpenStreetMap tiles for full geographic context and cached Seattle
street geometry as an offline fallback. No JavaScript CDN is required. Missing permit inputs are generated using `src.permits`; missing
route or street inputs are downloaded through `src.oba` and `src.basemap`.
Raw and processed data remain ignored by Git. Routes may have asymmetric directions, a single direction, branches or no
direction grouping. Every source stop is retained exactly once. Nearby stops
(within 500 feet) merge only when they share a parent station, or have matching
normalized intersection names, even within the same direction group. Street-type
abbreviations and omitted compass qualifiers are recognized; explicit conflicting
qualifiers are not treated as equivalent. Differently named platforms can merge
within 250 feet with opposite compass directions (or disjoint direction groups
when compass metadata is missing). Every pair in a cluster must qualify, so
nearby chains cannot collapse into one station. Merged labels preserve all source
names, such as `MLK & Hill / Walker`. These rules apply to all routes. Ambiguous
matches remain individual selectable stops. With a direction selected, the stop selector and comparison list follow that
feed group’s departure order. Combined list order follows the first direction
then additional branch/ungrouped stops;
it is not a linear itinerary. Map markers show names only on selection or hover.
Permit coverage is **Seattle**, not all of King County.

## Methods and existing analysis

`src/route_explorer.py` adapts `tod.analyze_route` and reuses defaults from
`analysis.first_hill`. The original First Hill script still runs with:

```bash
.venv/bin/python -m analysis.first_hill
```

The corridor is a union of 1,760-foot straight-line buffers around directional
stops. The dashboard starts with the nearest original boarding stop within that radius
in each available feed destination group. Around substantial bends, it can prefer
a later boarding stop within 330 extra straight-line feet, then maps the assignment
to its physical stop. The bounded departure heuristic is described in the
[MVP update notes](docs/mvp-update-notes.md). Combined directions may assign a project to two different stops;
route totals and combined physical-stop totals deduplicate records. Stop totals
therefore need not sum to route totals. The selected boundary matches directional
assignment areas, not a walking network. Incomplete feed directions are disclosed.
Legacy TOD single-nearest-stop interfaces are preserved for existing analyses.

Permit counts include all qualifying records, including dependent permits.
Projects use the existing primary-permit consolidation by normalized address,
description, type, value and housing outcomes. Each project's earliest issue
date is used for filtering. The UI's end date is inclusive. Missing housing and
cost values contribute zero to aggregates, with missing source fields shown as
`—` in the table. Net units = added − removed. Permit estimates are not actual
investment, and issued housing is not necessarily completed housing.

## Checks

With the cached data available:

```bash
.venv/bin/python -m unittest discover -s tests
node tests/metrics.cjs
```

The Python suite checks adapter output against the existing stop profiles,
empty corridors, stop grouping across route patterns and retrieval wiring. JavaScript tests check
date boundaries, stop filtering, missing values and negative net units.

With the application running, Node 22+ and Chrome installed:

```bash
node tests/browser_smoke.cjs
```

Set `CHROME_BIN` if Chrome is not in the default macOS location. This checks map
selection, controls, error recovery and mobile layout, and saves screenshots to
`/tmp/route-explorer-desktop.png` and `/tmp/route-explorer-mobile.png`. The refresh
UI test simulates a download failure rather than replacing cached source data.

## Route history and date presets

`data/reference/route_history.json` stores sourced passenger-service opening
dates keyed by OneBusAway route ID, including source URLs, notes and check dates.
Initial entries cover RapidRide G Line, First Hill Streetcar and South Lake Union
Streetcar. Add verified entries here as more route history becomes available;
restart the server after editing. Transit refreshes do not overwrite this file.
An opening date is not inferred from when a route was first downloaded.

Known routes default to **Life of route**; unknown routes default to **All
available**, with the life preset disabled. **YTD**, **1 year**, **5 years** and
**Life of route** end today in Seattle time, with inclusive boundaries. Rolling
years start on the same calendar date, clamping February 29 to February 28 when
needed. The 1/5-year presets and custom dates may include pre-opening development
for comparison. All available starts at the earliest cached qualifying permit.
A visible coverage note identifies the latest cached qualifying permit date;
that date is not a guarantee that the entire period is complete.

Historical windows use the current route geometry, not historical alignments or
predecessor routes. Opening dates are service dates, not construction start dates.

## Development charts and municipal coverage

Housing charts show green additions to the right of zero and red removals to the
left, with net units labeled. Removals include demolition and other recorded
housing losses, not a count of demolition permits. Use either Compare stops by selector; both expose the same metrics. Gold rings
on the map identify leading stops for the selected metric and filters, including ties. Stop bars can sort by route
order, highest/lowest metric or name; the housing view can sort by net, gross
added or removed units. Selection follows the stop ID when sorting.

The annual chart follows stop selection along with the stop summary and project
table; All stops restores route-wide totals. Partial years reflect
the inclusive date filter. Totals for overlapping routes should not be added
because a project can belong to multiple route corridors.

[Adjacent municipality data research](docs/municipal-development-data.md)
records official acquisition paths and a directly inspected Shoreline API schema.
Shoreline's public point layer lacks units and valuation, so a fuller export is
needed before importing comparable housing/value metrics. Adjacent-city data is
not yet loaded; the dashboard explicitly labels Seattle-only coverage.

See [the latest MVP update notes](docs/mvp-update-notes.md) for project-status
badges, project significance, the Taylor Avenue reconciliation, directional access, map selection,
cost/rank/trend metrics, current zoning, Link opening dates and design limitations.

## Current priorities

[The agreed feature stack](docs/priorities.md) records the current scope and deferred work.
Filters and dates open in a dialog; the active selection remains visible beside
an Edit filters button above the map. Clicking a project row highlights and focuses
its point. Comparison lists show departure positions or metric ranks (ties share a
rank). Selecting a physical stop also shows cached connecting routes, distinguishing
same boarding stops from nearby locations in button tooltips. Click a connecting
line to focus its nearest stop, and use Back to restore the previous route and view.

The map shows a prominent route title and concise stop names, with full source
names in stop details. All stops shows corridor-wide projects by default. Assignment
polygons are optional under Explain assignment areas; they represent project
assignments, not walking reachability. The stop comparison list scrolls separately
so the desktop map remains alongside it.
