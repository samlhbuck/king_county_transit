# Route Lens — Data Sources for Codex

**Research date:** 2026-10-08  
**Purpose:** Concrete sourcing and implementation brief for `priorities.md`, Item 29.  
**Status:** Source locations verified against published source pages; schema completeness, live downloads, coverage, and feature behavior still require technical validation in the project environment. Do not mark any lens implemented based on this inventory alone.

## Direction to Codex

Do not ask the user to locate these initial datasets. Use the sources below, inspect their schemas and licensing, build a small proof of concept, and report any genuine blockers with exact error messages. **Start by checking what the repo already fetches and caches** (OneBusAway, OSM, permit data, zoning) before adding a duplicate data pipeline.

Treat geography as a **set of distinct physical, regulatory, and experiential measures**, not one generic comfort score. Never infer a neighborhood's social character or supposed unpleasantness. Transit exploration should remain fun and non-prescriptive. A new thematic layer should be optional, mobile-friendly, and not overload the map or scrubber.

## Sources — priority order

### 1. Seattle Streets — P1 / first prototype
- **Source:** https://data.seattle.gov/dataset/Seattle-Streets/w3hh-bqt5
- **Direct ArcGIS FeatureServer layer:** https://services.arcgis.com/ZOyb2t4B0UYuYNYH/ArcGIS/rest/services/Seattle_Streets_1/FeatureServer/0
- **Access:** ArcGIS REST `query` with pagination or GeoJSON export; download snapshots and refresh as needed. Service max record count is 2,000 per query.
- **Publisher describes fields:** arterial classification, street name, one-way, surface width, surface type, pavement condition, speed limit, percent slope, transit classification. Check exact service field names/units and nulls before coding.
- **Use:** width, gradient, street class, and possible traffic-exposure proxies along route buffers.
- **Caution:** *Roadway* surface width is not sidewalk width; posted speed is not measured speed, and arterial class is not a pollution measurement. City publishes weekly updates.

### 2. SDOT Sidewalks — P1 / first prototype
- **Source/metadata:** https://catalog.data.gov/dataset/sidewalks-32d94
- **Direct ArcGIS FeatureServer layer:** https://services.arcgis.com/ZOyb2t4B0UYuYNYH/ArcGIS/rest/services/Sidewalks_CDL/FeatureServer/0
- **Access:** REST queries / City GIS GeoJSON or GeoPackage exports; paginate. Coordinate reference in service metadata: EPSG:2926 (Washington State Plane North, US feet).
- **Use:** identify sidewalk presence and pedestrian continuity; inspect whether reliable widths exist before promising a narrow-sidewalk measure.
- **Caution:** inventory is of SDOT-maintained sidewalk assets, not an exhaustive pedestrian comfort survey. Distinguish missing data from missing sidewalks. Service documentation notes status filters; validate those and exclude expired assets.

### 3. Parks and named destinations — P1 / first prototype
- **Seattle Parks addresses/points:** https://data.seattle.gov/d/dikw-tcet (Seattle Parks Distribution; an existing visualization based on Seattle Parks and Recreation park addresses, not an authoritative park-boundary polygon source).
- **OSM Overpass documentation:** https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
- **Overpass interactive explorer:** https://overpass-turbo.eu/
- **Use:** `leisure=park`, beaches (`natural=beach`), viewpoints (`tourism=viewpoint`), attractions (`tourism=attraction`), public gardens, named areas and landmarks. Curate salient points like Pike Place Market, the Ballard Locks, Seattle Center and Fremont Troll; do not assume every named feature maps to one point.
- **Access:** Query OSM elements by bounded area through Overpass; use node/way/relation geometry. Prefer caching a properly attributed snapshot and checking import/refresh terms. Validate completeness and deduplicate points, polygons, and site names.
- **Caution:** The parks address visualization is suitable for spot checks, not a replacement for park polygons. OSM coverage, attributes, and feature positions vary.

### 4. Grade and elevation — P1 for grade; P2 for elevation profile
- **First-pass measured proxy:** Seattle Streets `Percent Slope` (source 1).
- **Seattle 2021 LiDAR-derived contour service metadata:** https://catalog.data.gov/dataset/contours
- **Use:** quickly render slope along corridor using Seattle Streets; later generate a more continuous pedestrian/route elevation profile from a DEM.
- **Caution:** Published contours are a generalized *vector-tile* representation; they are not automatically a convenient elevation-at-coordinate API. Locate the underlying licensed raster DEM/service before implementing high-resolution profiles. Elevation and street slope are distinct metrics.

### 5. Trees and canopy — P1 for parks trees; P2 for citywide shade
- **Seattle Parks tree inventory:** https://data.seattle.gov/dataset/SPR-Tree-View/c7dn-wzzd
- **City canopy comparison by basin (2016–2021):** https://data.seattle.gov/dataset/Seattle-Tree-Canopy-2016-2021-Topo-Basins/qz9y-q2fd
- **Use:** visible park trees and coarse canopy context. Compare spatial shade/greenness only once suitable fine-grained canopy data are sourced.
- **Caution:** Parks tree inventory covers Seattle Parks property and is **not** a complete street-tree inventory. Basin canopy percentages are aggregate area summaries, **not** tree-by-tree shade or walkway coverage. No reliable time-specific shade exposure can be deduced directly from these two datasets.

### 6. Transit access and service frequency — P1 / reuse existing work
- **King County Metro developer data:** https://kingcounty.gov/en/dept/metro/rider-tools/mobile-and-web-apps
- **OneBusAway routes near point:** https://developer.onebusaway.org/api/where/methods/routes-for-location
- **Use:** existing OneBusAway route/stop lookup; static GTFS `stops`, `stop_times`, `trips`, `routes`, `calendar`, `calendar_dates` for service frequency by time/day; GTFS-Realtime/OneBusAway for predicted upcoming departures.
- **Method:** derive scheduled opportunities to board at each stop for a particular date/time and useful direction; distinguish weekday evenings/weekends. At route level, express *transit escape options* rather than distance to any stop alone.
- **Caution:** predicted arrivals change continuously; GTFS describes schedules not reliable actual waiting time. Check consolidated-feed coverage, calendars, access terms, and agency definitions. Never say a user will wait N minutes unless based on date/time and current or scheduled results explicitly labeled.

### 7. Pedestrian improvement priorities — P2 / supporting context
- **SDOT Seattle Transportation Plan Pedestrian Element:** https://services.arcgis.com/ZOyb2t4B0UYuYNYH/ArcGIS/rest/services/Seattle_Transportation_Plan_Pedestrian_Element/FeatureServer
- **Layers include:** enhanced street crossings (17), missing sidewalks (18), substandard sidewalks (19), transit connection corridors (20).
- **Use:** context on where improvements are planned/needed, separate from present-day physically observed conditions.
- **Caution:** a plan is not an inventory of completed construction; label as planned/proposed where applicable.

### 8. Built environment / building form — P2 / source not yet confirmed
- **Existing permits dataset:** https://data.seattle.gov/Built-Environment/Building-Permits/76t5-zqzr/about_data
- **Use now:** historical permitted changes, type of work, housing changes and estimated construction value; link to geographic regions and time windows.
- **Gap:** Find and validate an authoritative citywide building footprint dataset, ideally with heights, age, or stories. Do not substitute the outdated downtown-only ArcGIS demonstration dataset for citywide building stock. Existing permits are **not** a census of present buildings or proof of completion.
- **Action:** Codex should search City of Seattle GIS/King County GIS catalogs, provide a candidate source and its geographic/attribute coverage, and ask only if reliable public access truly fails.

## Minimum viable integration sequence

1. **Audit repo:** identify existing route geometry projection, CRS choices, source cache/refresh mechanics, legal attribution, and overlays. Avoid regressions to Routes 10, G Line, 217 or map-to-scrubber work.
2. **Fetch sample bounds:** one small bbox around an existing Seattle route. Query streets, sidewalks, and OSM parks/points; record response size, fields and missingness.
3. **Normalize:** define stable IDs, source URL, fetch date, original update date, source CRS, units, geometry type, coverage, and explicit unavailable values. Transform to web map WGS84 on output as appropriate; use projected geometry for accurate lengths/distances.
4. **Cache:** keep geographic data stable while scrubbing, with distinct freshness policies for static infrastructure and real-time arrivals.
5. **Prototype optional views:** roads/grade, sidewalks, parks/places; favor clear local meaning without adding clutter to mobile.
6. **Test:** representative streets with and without sidewalks; bridges/underpasses; steep streets; parks; dense route segments; crossing city boundary; null/no-data; route direction; mobile legibility and interaction.
7. **Report:** for each dataset mark `ready / partial / blocked`, actual schema fields, spatial coverage, update frequency, source attribution/licensing, and any missing implementation prerequisites.

## Suggested update to Item 29

**29 — Acquire and validate core urban datasets (P1)** — Codex should begin with the source manifest in `route_lens_data_sources.md`. Implement a small, cached and tested streets + sidewalks + parks/POI ingestion prototype, reusing existing transit and permit sources. Explicitly assess street width/slope, sidewalk presence/width availability, and OSM feature quality. The remaining sources (fine-grained elevation, citywide canopy, building stock, advanced access indicators) are staged research, not prerequisites for the first prototype. Preserve source metadata and avoid presenting proxies as direct measurements.
