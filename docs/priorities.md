# Route Explorer priorities

Updated 2026-09-25 after the rider-focused prioritization discussion. The original
map/assignment iteration is complete. The user authorized the next development
slice: map clarity and fluid exploration (priorities 1–2 below).

| Priority | Scope | Status |
| --- | --- | --- |
| 1 | Prominent route identity, route-context stop names, optional explained assignment polygons, viewport-wide spotlight, corridor-wide projects, consistent comparison metrics and map leaders | Complete; automated checks and desktop/mobile visual review passed |
| 2 | Compact independently scrolling panels, clickable connecting lines, nearest-stop arrival, Back restoring prior route/stop/filters/map view | Complete; automated checks and desktop/mobile visual review passed |
| 3 | Nearby routes from a chosen origin; walking and boarding direction; frequency/next departures; single-route time-budget exploration | In progress: cached connections and boarding direction complete; live next departures underway; walking validation, frequency and time budgets remain |
| 4 | Small destination pilot: parks, verified public waterfront and street-end beach access, concise creator notes | Deferred |
| 5 | Development application/issuance/completion/occupancy timelines; explicit date basis and clickable years; ridership context | Deferred; local ridership cache audit recorded below |
| 6 | Tree canopy, scenic/elevation views, transit travel-time variability and traffic context | Deferred |

## Near-term refinement deck

1. **Focus a selected stop automatically.** Selecting a stop from the sidebar,
   including after noticing a high housing total, should zoom and center the map
   on that stop. The current highlight without automatic focus is insufficient;
   the separate **Focus selected stop** button should not be required for this path.
2. **Recalibrate project-point housing colors.** Replace the current housing-added
   bands with **1–5, 6–20, 21–50, 51–150 and 151+ units**. Keep distinct treatments
   for zero-unit projects and projects whose unit count is not recorded.

Time-budget exploration: 30 minutes, one hour or two hours, one-way or round trip,
from a selected stop and departure date/time. Show farthest reachable stops in each
actual destination direction; uptown/downtown can supplement where meaningful.
Distinguish waiting, riding and optional walking. Return travel must use actual
return service rather than half the outward budget. Allow time at the destination.
Start with a single route before adding transfer itineraries.

Reachability geography (water, hills, crossings, stairs and station entrances)
belongs in priority 3; scenic geography belongs with exploration. Proposed
interface purposes remain Ride, Explore and Development, sharing selection,
route identity and navigation. More layers should answer a concrete rider question.

## Stop naming decisions

Display names may omit the corridor street when the remaining name identifies the
stop on the whole route, including branches and oxbows. Preserve compass qualifiers
or both streets when needed. Retain full source names in details and tooltips.
On the cached Route 50, California & SW Hanford becomes **SW Hanford St** because
there is also a stop at 1st Ave S & S Hanford St. California/Admiral collapses the
reversed platform names but retains both streets because both recur on this route.

## Ridership audit

No ridership dataset or ridership loader was found in this checkout's data folders,
analysis/source code or matching Git history filenames. Available local data cover
transit route/stops, permits, streets, zoning and route history. The previously
mentioned download may exist elsewhere; its source, reporting periods, measure
and route-ID mapping remain unverified. No ridership values are displayed. Missing
coverage must remain unavailable rather than zero; First Hill's absence should
not block supported routes when a source is recovered.

See [implementation and methodology notes](mvp-update-notes.md) for assignment
rules, cache limitations and validation details.
