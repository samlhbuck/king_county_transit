# Route Lens

**Explore Seattle one transit route at a time.**

[Open the experimental Route Lens demo](https://route-lens-production.up.railway.app/) · [Technical reference](docs/technical-reference.md) · [Deployment notes](docs/railway-deployment.md)

Route Lens starts from a different question than a trip planner: **where might this route take me?** Rather than asking for a destination and optimizing a journey, it invites people to explore a bus or streetcar line, understand the places along it, and discover other routes that extend their reach into the city.

It is an independent, exploratory web application, not an official King County Metro or City of Seattle service.

## Problem and audience

Transit maps are good at showing lines and trip planners are good at finding the fastest path. Neither necessarily conveys what an individual route feels like geographically: which neighborhoods it crosses, how the landscape changes, or why an unfamiliar branch of the network might be worth exploring.

Route Lens is for transit riders, people curious about their city, and civic analysts who want to investigate land use and development alongside transit. A user can enjoy browsing the network without learning zoning terminology; more technical layers are optional.

## Explore the app

- **Follow a route.** Select a line, move along its geometry using the route scrubber, and inspect stops without losing your geographic context.
- **Discover connections.** Find nearby routes and stops on the map, explore route descriptions, and change which line you are investigating.
- **Change lenses.** Compare present-day zoning along the route or inspect cached ground-elevation profiles where coverage exists.
- **Investigate development.** Examine Seattle permit records, estimated project values, housing units added or removed, and differences among stop areas.
- **Check departures.** Query OneBusAway for departures at selected stops when the live-data service is available.

The **First Hill Streetcar** is a useful starting point for the zoning and development views. The [hosted demo](https://route-lens-production.up.railway.app/) is a testing release; the live deployment may not include every change documented in the repository. The link is supplied as a demo address, not as a guarantee of continuous uptime.

### Screenshots and demonstration

The hosted app above is the current visual demonstration. Representative desktop and mobile screenshots have not yet been committed to this repository; they should be captured from a verified release rather than represented by mockups.

## Data and methods

Route Lens combines public records and a purpose-built interactive map:

| Input | Purpose |
| --- | --- |
| [OneBusAway](https://developer.onebusaway.org/) | Transit route shapes, stops, schedules, and available departure information |
| Seattle permit records | Permits, project grouping, housing changes, and reported/estimated construction values |
| Municipal zoning data | Current zoning context, including cached coverage for Seattle, Shoreline, Bellevue, and Redmond |
| USGS elevation data | Cached terrain profiles for supported routes |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Geographic basemap context |

The Python backend builds and caches route, stop, and development summaries; a browser-based JavaScript/SVG interface handles map navigation, route selection, and synchronized scrubbing. Tests cover route geometry, stop grouping, data summaries, map interactions, and mobile-sized layouts.

For development analysis, the stop corridor is based on **1,760-foot straight-line buffers** around transit stops. Projects are assigned to nearby boarding stops using a bounded heuristic, with deduplication for route-wide totals. This is a deliberate approximation—not a pedestrian-network walkshed. Full definitions, edge cases, and test commands are in the [technical reference](docs/technical-reference.md).

## Limitations and responsible interpretation

- **Experimental product.** Some interactions require real-device verification; the public test deployment and repository development state can differ. Route shapes may have direction and branch ambiguities.
- **Partial geographic and temporal coverage.** Development permits currently cover Seattle, not all of King County. Route and municipal data depend on cached snapshots and refresh dates. Some elevation profiles are unavailable.
- **Permits are not buildings.** An issued permit does not establish construction or occupancy; reported values are not audited expenditure. Housing changes represent recorded permit information.
- **Zoning is not built form.** The zoning strip approximates the current rules near the path; it neither reconstructs historic zoning nor measures street character exactly. Comparing permits with zoning does not demonstrate causation.
- **Access is approximate.** Straight-line stop distances, route corridors, and nearby-service results do not establish safe or convenient walking access. Historical comparisons use current route geometry rather than reconstructing past service patterns.
- **Live and offline limits.** Departure requests need the external service and an API key; the home-screen web app is not an offline package.

## Run locally

Requires Python 3 and an internet connection for uncached public data.

~~~bash
git clone https://github.com/samlhbuck/king_county_transit.git
cd king_county_transit
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
~~~

Then open **http://127.0.0.1:8000**. A different port may be selected with the **--port** option.

**Reproducibility note:** A fresh GitHub clone is not a fully packaged offline demo. Raw and processed data caches are intentionally excluded from Git. The program can retrieve supported inputs, but uncached route requests or source refreshes may require an **OBA_API_KEY** in a local, ignored **.env** file. The hosted Railway release uses a prepared snapshot bundled separately from this repository.

See the [technical reference](docs/technical-reference.md) for source refresh commands and checks, and [Railway deployment notes](docs/railway-deployment.md) for how testing snapshots are prepared and shipped. GitHub pushes are **not** automatic production deployments.

## Project status

Route Lens is active, iterative work. The demo and map-first experience are the portfolio focus; feature ideas and research proposals are not presented as implemented results. This repository documents both delivered behavior and known limitations.