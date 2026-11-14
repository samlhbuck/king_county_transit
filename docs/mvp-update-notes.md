# MVP update: project detail and geographic context

Implemented 2026-09-24.

## Data reconciliation: 223 Taylor Ave N

The cached Seattle dataset has three relevant primary permits at this address:

| Permit | Work | Reported added units | Reported value |
| --- | --- | ---: | ---: |
| 6771553-CN | Shoring and excavation | 215 | $4,025,000 |
| 6771554-PH | Residential/retail/office building | 214 | $51,329,233 |
| 6894957-CN | Later office tenant improvements | 0 | $3,500,000 |

The first two share `RelatedMup=3028452-LU` and `Development Site=DV0014074`.
They describe supporting work and the building, not two independent housing
buildings. The dashboard now uses **214 added units** from the building permit,
not 429. This is the permit-reported count, not a verified as-built unit count.
The later tenant improvement remains a separate zero-unit project.

The rule is general: a housing-bearing shoring/excavation record is reconciled
only if exactly one housing-bearing New building permit shares an explicit
land-use/development-site ID and normalized address. Ambiguous records remain
separate. No address-only deduplication is performed. Raw qualifying permit
counts remain unchanged. Project detail lists the source IDs and reconciliation.

The project value uses the building permit's estimate. The separately recorded
support valuation is retained in detail but excluded from totals because its
inclusion in the building estimate is unknown. This intentionally avoids adding
potentially overlapping valuations; it is not a claim about actual spending.
Project dates use the building permit issue date. Current statuses refer to the
surviving primary permits, not a historical occupancy timeline. This rule does
not establish a complete phased-project deduplication solution.

## Maps and project detail

- Display coordinates use Web Mercator; analysis distances still use EPSG:2285.
- Visible geographic tiles come directly from OpenStreetMap with attribution and
  normal browser caching. Lakes, the canal, neighborhoods and streets have
  context beyond Seattle's cached street data. Online tiles require connectivity;
  turning them off retains cached Seattle streets. There is no offline tile
  prefetch or bulk download. See [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- Markers stay a fixed screen size when zooming. Station numbers appear at
  neighborhood scales; station tooltips/selection remain available at overview.
- Project clusters show counts and zoom/inspect on selection; individual colors
  separate 0-unit renovations, 0-unit new construction, 1–20, 21–100 and 101+
  added units. Circle size can use housing or estimated capital cost. These are
  project records, not building footprints. Unknown additions use a separate pale-gray marker.
- Current source permit statuses have color badges. Completed, issued, expired,
  review and mixed/unknown states do not imply verified construction completion.
- Mixed-use/institutional/housing labels are **description hints**, not verified
  occupancy categories. Residential-only use is not inferred from positive units.

## Analysis and history

- Annual bars follow stop selection, with a scope-aware heading and partial-year
  labels. All stops restores the route totals.
- Trend compares the latest two complete calendar years inside the selected
  range when the cached records extend through them. Issuance is not construction
  pace; source completeness is not guaranteed. Percentages are unavailable with
  a nonpositive baseline.
- Value per added unit includes only positive-unit projects with known valuation.
  Coverage is stated; mixed-use nonresidential cost is not separable.
- Rank differences compare competition ranks (ties share ranks) of net units,
  value and permit counts for every physical stop on the route.
- Link 1 Line opening is July 18, 2009 and 2 Line opening is April 27, 2024, based
  on Sound Transit announcements linked in the route-history cache. These are
  original line openings, not individual extension/station opening dates.

## Current zoning

The source is Seattle's [Current Land Use Zoning Detail layer](https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Current_Land_Use_Zoning_Detail_2/FeatureServer/0).
The cache contains 3,627 polygons from the initial retrieval. Refresh downloads
all pages, validates counts and unique IDs, and atomically replaces the cache.

Category percentages come from the areas of zoning polygons intersecting a
physical-stop circle, or the union of directional-stop catchments for the whole
route. Same-category overlaps are dissolved. Cross-category overlaps are flagged
if present. The denominator includes unmapped/outside-Seattle area (including
water), so mapped categories need not sum to 100%. A map overlay is optional.

The dataset describes **current** zoning, not zoning at permit issuance. It is
not a legal zoning determination. Neither ADUs nor correlations between zoning
and development establish a need to upzone or a causal relationship.

## Design explorations, not inferred features

Neighborhood form (urban/suburban/towers-in-park) cannot be reliably inferred
from permit unit counts and costs. A later version needs building footprints,
height/floor area, parcel coverage, setbacks, street/block connectivity and
verified uses, with examples validating any labels. The current release shows
only descriptive use signals, not a neighborhood classification.

The ride-to-unlock idea is recorded for product exploration: optional exploration
milestones could reveal geography, zoning, development and historical streetcar
layers. Define what counts as a ride and whether progress is self-reported before
adding tracking; avoid gating access to core public information. No location or
ride tracking has been added. Historical alignments require sourced, dated GIS
layers rather than an inference from today's routes.

Tests run against the cached data and a browser with online tiles disabled
(`?offline=1`). This avoids automated tile downloads. Clustering helpers are unit tested and
map interactions are browser tested. Browser screenshots are not proof of
external tile-service availability.

## 2026-09-25 iteration: directional access and map clarity

This section supersedes the cluster and circular per-stop zoning descriptions above.

- Dashboard records now carry `StopAssignments`, a map of feed destination-group
  ID to physical-stop ID. For each group, the nearest **original boarding stop**
  within 1,760 feet is assigned, then mapped to its physical group. The original
  TOD `NearestStopId` and analysis interfaces are preserved for existing users.
- A project can reach two different physical stops in opposite directions,
  including on U-shaped routes. Combined-direction physical-stop summaries deduplicate
  a record assigned to both platforms at the same stop. Route totals count each
  source record once. Stop totals need not sum to route totals.
- Assignment polygons partition each direction's buffered boarding locations using
  projected nearest-point boundaries. Combined directions can overlap. These are
  straight-line access areas, not measured pedestrian accessibility. Physical-stop
  pairing is unchanged and independent of project access.
- Feed destination groups are not assumed to be exactly two canonical directions.
  Branch groups remain distinct, and ungrouped stops are explicitly unclassified.
  The cached G Line currently supplies only one destination group; complete opposite-
  direction access cannot be established from that grouping alone.
- The direction control applies to projects, individual permit counts, charts,
  map areas, and zoning percentages. Status/work filters apply to projects by their
  primary-permit metadata and to permit counts by each individual permit's metadata.
  Supporting records may consequently have a different status than the project.
- Current status filters include issued, completed/approved to occupy, review,
  inactive and unknown/mixed. The existing qualifying issued-permit dataset limits
  which categories are represented. Issued does not verify construction underway;
  completed permit status does not independently establish building occupancy.
- Persistent ordinal stop labels, rectangular count badges and screen-grid clusters
  are removed. Stops retain names in tooltips, keyboard-accessible controls and
  selected labels. Selection shows only projects assigned to that physical stop in
  the selected direction(s). Exactly colocated records fan out deterministically.
- Only the selected access boundary is drawn. Spotlight dims outside that area
  (or the direction's corridor at overview). Zoning is optional; supplemental
  analysis and source refresh controls are collapsed by default. Legend swatches
  use the same colors as mapped features.

### Walking-access feasibility scope (no provider integrated)

TravelTime supports walking isochrones. Its current Basic offer is for free
research/development/evaluation; the signup form asks for company name and email.
Individual eligibility has not been confirmed. No account, credential or API
subscription was created and no paid requests were made.

Sources checked for planning: [walking isochrones](https://docs.traveltime.com/api/overview/isochrones),
[account signup](https://account.traveltime.com/), [pricing](https://traveltime.com/pricing).

Before integrating any provider, compare walking routes/areas for east Queen Anne
versus Aurora, a canal crossing, and a Link station with constrained entrances.
Check public stairs, crossings, disconnected streets, station entrance placement,
and whether slopes actually affect walking times. A walking polygon alone does not
prove those details are modeled. Compare with an OSM pedestrian-network approach
if account access or production licensing is unsuitable.

Try configurable bus 3–5, BRT 5–8, rail 8–12 and ferry 30 minute scenarios; these are
user hypotheses, not validated default walking tolerances. Reachability can overlap;
future unique assignments should select the shortest reachable walking time within
**each direction**, retaining source/provider/version and a cache timestamp.

Next scope remains walking-access validation, then transfers/service information.
No recommendation score, new municipal feed, live arrivals or environmental layer
was added in this iteration.

Feasibility finding: use a walking **arrival** isochrone at each boarding entrance
for access *to* transit, and many-to-one walking times to choose assignments.
The provider distinguishes arrival from departure areas; overlapping isochrones
alone cannot choose the quickest stop. Its routes endpoint can supply sample
walking paths for manual checks. The documented default walking speed is 1.4 m/s;
this does not establish how Seattle slopes or stairs are handled.
[Search direction and matrices](https://docs.traveltime.com/api/overview/key-concepts),
[walking routes](https://docs.traveltime.com/api/overview/routes),
[walking speed](https://help.traveltime.com/en/articles/8524005-what-is-the-default-walking-speed).
Result: technically suitable for a small access experiment, not yet validated as
our pedestrian-access model. Credential eligibility and path quality remain open.

Validation: 35 Python tests, JavaScript aggregation/membership/filter regressions,
and headless Chrome desktop/mobile checks pass. Cached First Hill, G, Route 8,
1 Line and 2 Line project assignments were checked against their directional
polygons with zero coverage mismatches after increasing circle resolution and
matching the assignment cutoff to the displayed boundary. Browser tests also
exercise Route 2, selection, direction/status controls, date presets, rail views,
refresh failure recovery, and mobile overflow. Online tiles are disabled in the
browser tests; this does not verify external tile availability. The updated app
was started separately on port 8001 to avoid the existing server's cached payload.


## Priorities 1–2: map clarity, transfers and departure access (2026-09-25)

Filters and date controls now live in an accessible dialog. A persistent context
strip above the map lists route, direction, stop, work/status filters, issue-date
range, metric and Seattle data coverage. Project table buttons and row clicks
focus the map point and link its highlight to the selected row. Numerical chart
labels use departure order or competition ranks for metric sorts. Direction
changes reorder the stop selector and comparison list and hide boarding locations
outside that group; an unavailable stop selection returns to All stops.

Each stop lens includes connecting routes from cached boarding locations.
Same-stop and nearby locations are distinguished individually, with cached
boarding-specific destinations and route types where available. The 660-foot
nearby search measures the minimum straight-line distance from any constituent
boarding platform, not the physical stop’s midpoint. It is not a walking time or
proof of a usable connection. Nearby routes absent from the cache are unknown.

Departure access starts with the directional nearest-stop partition. For each
original cell, consider up to four later stops, preferring the farthest qualifying
stop first. The sum of consecutive stop distances must be at least 1.5 times the
direct separation and exceed it by at least 660 feet. A conservative half-plane
permits at most 330 extra straight-line feet compared with the original nearest
stop, and the new boarding stop must remain within the 1,760-foot radius.
Reallocated pieces are subtracted from their original cell; they are not repeatedly
reassigned. No preference wraps past the terminal or applies to unclassified
stops. Boundaries, permit/project memberships and zoning use the same areas.

These are provisional heuristic thresholds, not measured walking or riding times.
Feed group order is the available ordering evidence; complex branch patterns may
not represent a single ride. Walking-network validation remains deferred.
At the cached 209 12th Ave S location, the result is Yesler & Broadway toward
Capitol Hill and 12th & Jackson toward Pioneer Square. Regression checks cover
that example, straight routes, terminal behavior, coincident stops, unchanged
coverage, disjoint interiors and the extra-distance/radius bounds.


Validation: all 41 Python tests pass, along with JavaScript aggregation/rank tests
and the desktop/mobile Chrome suite. The browser run covers First Hill, G Line,
Route 2, Route 8 and both Link lines; new checks exercise the filter dialog,
active context, project-row highlighting, transfers and departure ordering.
Screenshots were visually inspected. Geographic tiles remain disabled in the
automated tests, so external tile availability is not validated.

The multi-route checks exposed a GEOS overlay failure on Route 8. Departure
intersections now use a millionth-foot precision grid and discard edge-only
contacts before subsequent overlays. Cached route regression tests verify valid
areas, unchanged corridor coverage within one square foot, and no material overlap.

## Priority 3: live departures (2026-09-25)

Selected physical stops now expose an on-demand OneBusAway departure check across
their constituent boarding platforms. Results combine and sort the next two hours,
show the route and destination, and distinguish live predictions from scheduled
times. The request is manual so selecting stops does not consume API calls. It
requires `OBA_API_KEY`; the existing dashboard remains usable without one.

This begins priority 3 but does not yet calculate service frequency, walking paths
or time-budget reachability. Unit coverage verifies platform deduplication, sorting
and predicted-time precedence. The 43-test Python suite, JavaScript regression
suite and desktop/mobile browser smoke suite pass.

## Rider exploration and map clarity

The map now names the active route prominently and shows its selected destination
group. All stops displays all projects within the selected filters; Projects hides
the points without changing totals. Assignment polygons are off by default, under
**Explain assignment areas**. Their explanation distinguishes directional/project
assignment from walking access. The existing departure-assignment model is unchanged.

The spotlight and tile/project rendering now use the actual visible SVG bounds,
including the extra area created by differing view-box and screen aspect ratios.
Pan anchors update after each move so map and geographic assignment areas move
together. Stop comparisons and connections scroll within bounded regions; desktop
map positioning keeps the map beside the scrolling sidebar. Annual and project
sections also retain their own scroll regions.

Connections are line-name buttons. Selecting one loads that line, chooses its
closest physical stop to the previously selected stop (projected distance), and
focuses the map. Back restores the old route, stop, selected project, date/direction/
comparison controls and map viewport. Multiple connections retain a return stack;
a direct route choice starts a new exploration. A failed fetch retains the old
route and does not consume navigation history. Nearby connections are cached
hints; no walking path or timed transfer is promised.

Both comparison selectors expose the same metrics. Gold rings show stops tied
for the highest positive total in the current filtered direction(s); housing
comparison follows its net/added/removed setting. Zero or wholly negative totals
show no leaders. Comparing stops does not change project point colors, which still
encode housing added; a visible note explains this distinction.

Short stop names are display-only and computed across the whole route. Reversed
intersection names collapse, common corridor streets can be omitted, and repeated
cross streets retain compass qualifiers or both streets. Complex merged names are
kept conservatively; all source names remain in stop details and tooltips. No
unverified neighborhood aliases are invented. On Route 50, SW Hanford St remains
distinct from S Hanford St at 1st Ave S.


Validation for the rider exploration iteration: 41 Python tests, JavaScript
regressions, and the expanded Chrome suite pass. Browser checks cover corridor-wide
projects, matching comparison controls, transfer-to-nearest-stop and exact return
view, actual Route 50 naming, visible spotlight bounds, consecutive mouse-drag
translations, independently scrolling rankings, sticky route identity and mobile
overflow. Final desktop/mobile screenshots were visually reviewed. Online tiles
remain disabled in automated tests.

## Project completion year

Clicked project details show the year from the source CompletedDate. Consolidated
projects use the latest recorded completion date among their retained primary permits.
Completed records without a date show “Completion year unavailable.” This is permit
completion, not independently verified building occupancy. Date filters still use issuance.


## Route geometry and geographic handoff (2026-10-08)

Route 217's feed represents its directions as many overlapping fragments. Ordered
stop tracing now follows the connected feed network instead of choosing a short
fragment. Its directional profiles span about 9–10 miles and retain all 31/29
boarding stops. Disconnected geometry is never bridged. Available directional
profiles remain selectable; feed geometry is not a dated-trip guarantee.

Route changes initialize the scrubber near the geographic handoff, show filled
progress behind it, and retain ride-view scale or closer. Direct choices use the
current ride position, selected stop or map center when nearby. Distant routes
use default framing. Back restores both the scrubber and viewport. Changing a
direction keeps the scrubber near the same place.

Residential permit blotches use muted mauve, with matching callout and legend
swatches. Zoning colors are unchanged. Tapping the selected permit again closes
its callout and clears selection; another permit replaces it. More retains the
supporting details without conflicting double-tap behavior.

Validation: 64 Python tests, JavaScript regressions, desktop/mobile browser smoke,
ride/callout toggle, viewport and selector checks pass. Desktop/mobile screenshots
were reviewed. Browser tests disable online geographic tiles; real iPhone framing
and basemap contrast await review after deployment. No deployment was performed.


## First-use exploration guide (2026-10-08)

A quiet, reopenable ? button opens a nonblocking guide to development dots,
route scrubbing and current zoning. It includes the selected route, sourced
service opening date where available, and current permit issue-date window.
First Hill offers three optional observation prompts. Zoning effective/retrieval
dates are in a disclosure; issue dates, completion and causation stay distinct.
The panel closes via its button, Escape, or an outside interaction without moving
the camera. Current zoning is the map-toggle label; its default remains off.

Desktop/mobile guide and mobile viewport browser checks pass, and the mobile
screenshot was reviewed. Actual iPhone review and deployment remain. This is
28A only: the working private feedback submission path in 28B is still open.


## Cached terrain and stop synchronization (2026-10-08)

Both directions of First Hill and South Lake Union Streetcars have cached USGS
3DEP terrain profiles. Elevation replaces the current-zoning bands in the same
mobile profile area; labelled axes and a current elevation readout share the
scrubber's route-distance scale. Sampling includes 100-foot intervals and stop
ticks, retaining source model, resolution, datum and acquisition/retrieval dates.
Missing coverage remains gaps, never a false zero or invented connecting path.
Ground terrain is not surveyed track elevation, especially at bridges/tunnels.

Map stop selection updates route fill, scrubber and terrain without recentering;
scrubbing selects the corresponding physical stop without opening a panel.
Canonical direction IDs align the terrain with direction filters. Explicit
repeated ordered stops retain occurrence distances. Cache geometry fingerprints
prevent old elevations from attaching to new shapes. No runtime USGS requests.
The existing release-preparation workflow includes the ignored elevation files.
See elevation-data.md for reproducible preparation and source validation.

Validation: 69 Python tests, JavaScript terrain/geometry/metrics checks, and
desktop/mobile terrain (two routes), guide, viewport, permit and broad route
browser checks pass. The mobile terrain screenshot was reviewed. Actual iPhone
review and deployment remain. Item 25's user-reported G Line anomaly stays open.

## Elevation catalog rollout (2026-10-08)

Prepared 107 profiles for 54 routes with locally cached transit geometry:
68,089 terrain samples, no missing samples or remaining retrieval failures.
G Line remains excluded pending Item 25; 338 other catalog routes lack cached
transit geometry. The resumable catalog command skips valid snapshots, isolates
failures, writes an atomic report, and supports planning without elevation queries.
USGS multipoint requests use 250-point batches and bounded transient retries.
Source metadata includes native resolution units without assuming all rasters
report metres. Numeric cache keys tolerate projection roundoff; when GEOS emits
different redundant vertices, every actual query location, chainage and section
break must match before terrain is reused. No runtime USGS requests are added.

Validation: 78 Python tests and JavaScript terrain/geometry checks pass. Live
desktop/mobile browser checks pass for Route 10, Route 217 and Link 2 Line, including
direction changes, scrubber synchronization and manual camera overrides. Live
API checks also verified the streetcars, Link 2 Line and combined Route 43/44.
The final production deployment reached SUCCESS; representative live API checks
verified elevation availability and corrected native-resolution metadata.

## Contextual information and intentional inspection (2026-10-08)

Items 41 and 26: selecting stops and scrubbing leaves the mobile map open.
The existing ? control opens selected-stop details, expands the existing permit
callout, or explains the active terrain/zoning lens with available provenance.
Every context offers general guidance. Stop-tick double-click deliberately opens
existing details; new selections and route/lens changes close old panels.
Keyboard activation and Escape work without camera or progress changes.
The lower scrubber has a transparent 44-pixel hit area, retaining capture when a
drag moves off the track, with no increase to the visible control or panel height.

Validation: all 78 Python tests; JavaScript geometry/terrain checks; new desktop
and mobile contextual-help/drag/keyboard checks; existing guide, terrain, viewport
and broad browser smoke tests pass. Actual iPhone touch verification remains.
Product feedback submission (28C) remains the next staged deliverable.
Production deployment reached SUCCESS. The final live desktop/mobile contextual
help, keyboard, route/lens dismissal and lower-hit-area capture checks passed.

## Private product feedback (2026-10-08)

The general ? guide now includes Send feedback. Category is required; text and previewed route/stop/lens context are optional. Success requires a committed receipt, failures retain drafts, and retries avoid duplicate records. The private SQLite queue has automatic 90-day retention and basic abuse protection. Production uses a persistent /feedback volume; private reading is documented in [product-feedback.md](product-feedback.md). All 85 Python tests and desktop/mobile feedback browser checks passed locally; actual iPhone keyboard review remains.

Production deployment 38f98f98-f835-4c69-a24c-104df3710568 reached SUCCESS; the /feedback volume is Ready and live desktop/mobile submission checks passed. Private production reading and redeploy survival were verified for both automated receipts after successful deployment 7ec09359-eb34-4603-a50f-5dc4e0e7697f. Original timestamps remained unchanged. The explicitly authorized temporary SSH key was removed.
