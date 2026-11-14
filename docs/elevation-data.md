# Route terrain elevation

The first cached release covers both directions of First Hill Streetcar
(`23_102638`) and South Lake Union Streetcar (`23_100340`). Choose **Elevation**
above the scrubber to replace the zoning bands with a terrain trace. Choose
**Current zoning** to restore the bands. The map, slider, stop selection and trace
share one route-distance axis; the mobile panel retains its existing height.

The subsequent cached-route rollout prepared 107 profiles across 54 catalog
routes. G Line is excluded pending terminal geometry review; the other 338
catalog routes lack locally cached transit geometry and were skipped. The batch
report records coverage and exclusions. These counts describe this snapshot,
not automatic elevation availability for future catalog additions.

## Verified source

Pilot samples use the public [USGS Elevation Point Query Service](https://epqs.nationalmap.gov/v1/docs),
which samples the [3DEP dynamic bare-earth model](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer).
Catalog preparation uses that same model's
[`getSamples` multipoint operation](https://developers.arcgis.com/rest/services-reference/enterprise/get-samples/)
with nearest-neighbor sampling in batches of 250 points, submitted by POST.
Live comparisons of 50 pilot points and 250 bus-route points returned identical
metre values to the existing point/small-batch snapshots. Each new snapshot
records its actual endpoint and sampling method; existing snapshots are retained.
The downloaded pilot samples all reported 1-metre resolution and the
`WA_KingCounty_2021_B21` DEM. Model records 103010 and 103850 explicitly report
North American Vertical Datum of 1988 (NAVD88). Each sample retains its source
raster ID, resolution and acquisition date, and each profile retains the model
records and retrieval timestamp. Returned values are metres; the display converts
to international feet (1 ft = 0.3048 m). Query coordinates are transformed from
map Web Mercator to NAD83 (EPSG:4269).
Multipoint responses include model name and vertical datum directly; these are
retained without a redundant model lookup. Acquisition dates retain the source
format (EPQS date strings or ImageServer epoch milliseconds).
Regional routes also encounter other DEMs, including geographic rasters whose
native pixel sizes are angular. Multipoint snapshots retain `sourceResolution`
in `source raster units`; those numbers are not asserted to be metres. The
verified 1-metre pilot resolution does not apply to every regional sample.

[3DEP data are public domain](https://pubs.usgs.gov/publication/tm11B9).
[EPQS accuracy depends on its source data](https://www.usgs.gov/faqs/how-accurate-are-elevations-generated-elevation-point-query-service-national-map).
Resolution is not a guarantee of vertical accuracy. This is sampled ground
terrain, not surveyed track elevation: bridges, tunnels, road cuts and geometry
error can differ from the model. Cached terrain dates differ from route opening
and permit issue dates. No historical terrain or transit causation is inferred.

## Preparation and cache lifecycle

From the repository, run:

```bash
.venv/bin/python -m src.elevation 23_102638 23_100340
```

Add `--refresh` to requery existing profiles. Other cached routes can be supplied
by their route IDs. Retrieval uses four bounded workers and 60-second multipoint
request timeouts (30 seconds for model metadata). A failed retrieval leaves the prior snapshot intact. A complete profile
is saved atomically after its source metadata has been verified.
Temporary network errors, HTTP 429 and server errors are retried up to three
attempts with bounded backoff.

For a resumable rollout across locally cached transit routes:

```bash
.venv/bin/python -m src.elevation --all --cached-only --dry-run
.venv/bin/python -m src.elevation --all --cached-only
python3 scripts/redeploy.py
```

The dry run counts profiles and pending elevation queries. Completed profiles
are reused on reruns; failures are reported and do not stop subsequent profiles.
An atomic progress report is written to `data/raw/elevation/batch-report.json`
after each profile. Routes without local transit geometry are listed as skipped.
Omit `--cached-only` to include the full catalog; uncached transit retrieval
requires the existing OBA API key. G Line (`1_102745`) is excluded pending its
known terminal geometry fix. Add `--exclude ROUTE_ID` for additional exclusions.
The command exits with status 1 if any selected route or profile fails. Successful
snapshots remain available for the next run. Use `--report PATH` to retain a
separate planning or rollout report. Preparation does not deploy automatically.

Sampling uses the selected directional geometry at 100-foot chainage intervals,
section endpoints and exact stop-tick positions. Very long routes coarsen regular
sampling to at most about 1,800 intervals, plus stops and section endpoints.
Section breaks are sampled separately and never joined by an invented segment.
Repeated ordered stop IDs have explicit traversal occurrences; choosing a stop
uses the occurrence closest to the current scrubber position.

Ignored snapshots live in `data/raw/elevation/`. Their names key route ID and a
hash of geometry, stop positions, sampling interval and cache version. Numeric
values are rounded to 0.001 before hashing (metres for projected coordinates,
feet for chainage), so macOS/Linux projection roundoff does not reject matching
snapshots. Running the preparation command upgrades older exact-number cache
keys offline while preserving samples and retrieval metadata. Geometry
or stop changes that move query locations invalidate old samples. When GEOS
builds produce different redundant vertices, a fallback checks every query
location within 1e-8 degrees, every chainage within 0.001 ft, and every section
break. New snapshots also check stop identities and occurrences. Route and
direction identity alone never suffice. This permits reuse of identical terrain
queries despite differences in path tessellation. Application startup, route changes,
lens toggles and scrubbing only read matching caches; they never query USGS.
Routes without a matching cache say **Elevation unavailable**. Invalid/no-data
values remain null; traces and interpolation do not bridge missing samples or
route breaks. A real zero elevation is retained.

The existing release preparation copies these ignored public-data snapshots with
the rest of `data/`; Git-only deployment would still lack them. No new API key or
persistent service is required. Restart the app after CLI preparation to clear
its route-response cache. Elevation is not an automatic hosted source-refresh job.

Vertical axes have labelled bounds, with at least a 100-foot range to avoid
magnifying shallow variations excessively. Both directions share a range. Distance
and elevation axes scale independently; this is a profile for seeing relief, not
a geometrically accurate depiction of grade or a cumulative-climb estimate.

## Validation

Python tests cover exact stop sampling, breaks, no-data/zero handling, geometry
invalidation, offline cache reads, failed refresh preservation and repeated stop
occurrences. JavaScript checks cover interpolation, missing coverage, section
breaks and directional reversal. Browser checks exercise both pilot routes on
desktop and mobile, actual trace visibility, scrubber movement, map-stop
synchronization, direction changes, manual camera override and absence of scrub
fetches. Actual iPhone/Safari behavior still requires device review.
