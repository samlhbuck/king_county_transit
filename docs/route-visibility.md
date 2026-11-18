# Contextual route visibility experiment

Implemented locally on 2026-11-17; not deployed or verified on iPhone.

## Enable and compare

- Normal app: `/` — unchanged; no contextual geometry request or experimental controls.
- Experiment: `/?contextRoutes=1`.
- Experiment with grid: `/?contextRoutes=1&routeGrid=1`.
- Open the existing filters dialog and expand **Experimental route visibility**. Toggle **Apply grid filter** to compare filtered routes against all cached contextual routes intersecting the viewport. Toggle **Show debug grid** to inspect the selected route. Numeric inputs configure the grid size, viewport fraction, required cells, and minimum traversal fraction.
- Remove the query parameters and reload to turn the experiment completely off. Settings are session-local and do not change transit data or the route selector.

## Calculation

The analysis rectangle is centered in the SVG's actual visible screen bounds, 70% of both dimensions. Each continuous encoded OBA polyline is projected with the existing RouteMap projection and screen transform, then clipped segment-by-segment to nine cells. Length within each cell is summed in CSS pixels; 15% of cell width qualifies the cell. Three cells qualify a path, and any qualifying path qualifies its route. Separate branches/directions cannot combine their counts. Segments exactly on a shared grid edge belong to one side, avoiding doubled occupancy. Thresholds are identical for every transit mode.

The debug overlay shows qualifying cells for the selected route's best single path, its count, and pass/fail. Failing that test never hides the selected route. Context lines render beneath the existing selected-route/stop/project overlays. Tap or click a contextual line to highlight it and open a compact preview; overlapping routes appear as separate choices. Choose **Explore route** to use the existing route loader, anchor the profile near the clicked point and retain geographic zoom. **← Previous route** restores the prior route, profile position and viewport. Keyboard users can focus a visible contextual line and press Enter; the anchor is its closest point to the viewport center. Escape dismisses the preview. Existing route selection, direction handling and route progress remain responsible for the selected route.

## Interaction and hierarchy

The active route retains its saturated styling and existing tools. Previewed contextual routes use a stronger stroke; remaining contextual routes are fainter. This is an interaction state, not another qualification or prominence score. No geometric crossing is labeled a transfer. Catalog descriptions are shown when available; the preview does not infer a travel direction from a shape.

Hit testing considers every qualifying route within 12 CSS pixels (18 for touch) and offers all matches, including coincident and closely parallel lines. Stops and permits take precedence at their markers; tap a nearby exposed portion of the line to inspect contextual routes there. Separate shapes never receive artificial joining segments. Where cached geometry and the available scrubber profile differ, the nearest point on an available profile is used; an exact branch match cannot be guaranteed.

## Data and performance

`/api/context-routes` reads the existing `data/raw/oba/routes` JSON caches only, including top-level and direction-group polylines. Duplicate encodings are removed; disconnected encodings remain separate. Coordinates are projected to Web Mercator without simplifying or altering source files. Missing/invalid caches are omitted. File size/mtime changes invalidate the process-local inventory cache. No upstream requests or new downloads occur.

The local snapshot has 55 cached routes / about 83,000 vertices / 3.46 MB uncompressed JSON. The optional payload is fetched once per enabled page. Existing SVG route path nodes are retained across pan/zoom, reprojected when the selected route changes. Cached geographic bounds cull offscreen paths before screen-space clipping. Updates are coalesced to at most one per 100 ms, including during sustained movement, and resize also triggers evaluation. A desktop Chrome mobile-emulation measurement was about 20 ms for an update; this is not a phone performance guarantee. SVG nodes use a 160 ms opacity transition, disabled for reduced motion; there is no eligibility hysteresis.

A larger cache could require spatial indexing, compressed delivery or background calculation. At close zoom many routes can qualify; no arbitrary route cap is applied. Grid coverage is geometric, not evidence of service availability or a journey-planning result.

## Known interpretation limits

A continuous route stored as several encoded fragments may fail even though stitching them would qualify it. Conservative non-stitching avoids inventing connections or combining disconnected branches. Encoded shapes may represent variants or both directions; each is evaluated independently. Source geometry quality still matters. The debug count uses the selected route's raw display geometry, not an inferred trip itinerary or a merged set of branches.

## Files and verification

- `src/context_routes.py`, `app.py`: cached geometry inventory and HTTP endpoint.
- `web/route_visibility.js`: pure clipping algorithm, config/debug UI, contextual layer integration.
- `web/map.js`, `web/app.js`, `web/index.html`, `web/style.css`: existing map lifecycle integration, opt-in initialization and appearance.
- `tests/route_visibility.cjs`, `tests/test_context_routes.py`: geometry thresholds, edge ownership, branches, duplication, projection, malformed data, pan/zoom.
- `tests/route_visibility_browser.cjs`: selected route retained, filter bypass, debug visibility, unchanged selector inventory, scrubber compatibility, coalescing and default-off behavior; overlap choice, touch-style clicks, route activation, anchored scrubber and restored previous viewport using a deterministic route payload fixture.
- `docs/priorities.md`: item 48 checkpoint; existing priorities preserved.

Run Node tests directly; run Python tests with `.venv/bin/python -m unittest tests.test_context_routes`. Browser test uses the existing dependency-free Chrome harness and `APP_URL=http://127.0.0.1:PORT node tests/route_visibility_browser.cjs`.
