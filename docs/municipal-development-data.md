# Adjacent municipality development data

Updated 2026-09-29. **Zoning is loaded for Seattle, Shoreline, Bellevue and
Redmond. Permit data remains Seattle-only.** A zero outside Seattle is not
evidence of zero development. The UI distinguishes zoning and permit coverage.

## Sources and acquisition paths

| Jurisdiction | Official source / acquisition | Coverage and gaps | Next step |
| --- | --- | --- | --- |
| Shoreline | [Public permit point API](https://gis.shorelinewa.gov/server/rest/services/ComDev/ComDev_Views/MapServer/1), [service directory](https://gis.shorelinewa.gov/server/rest/services/ComDev/ComDev_Views/MapServer), [permit portal](https://permits.shorelinewa.gov/) | API schema directly inspected. Geometry, permit number, type/subtype, status, issue date, parcel and address are available. No housing-unit additions/removals or project valuation fields. Fees are available but are **not development value**. Layer names indicate current/previous-year views; actual date completeness still needs auditing. Portal advertises records since January 2001. | Request a historical bulk export with valuation, units added/removed and parent/project relationships. Use GIS for locations and permit IDs. Highest priority for Aurora/E Line coverage. |
| Bellevue | [Development Activity](https://bellevuewa.gov/development-activity), linked [permit open-data catalog](https://data.bellevuewa.gov/search?q=bellevue+permits&tags=permits), [permitting dashboard](https://bellevuewa.gov/permitting-dashboard) | City documents five years of open permit data and older CSV exports on request. Includes multiple datasets such as new-home permits, major projects and design reviews; these are not interchangeable building-permit populations. The dashboard includes volume and valuation, but record-level unit/removal fields have not been verified. | Inspect the linked dataset APIs, retrieve building permits with pagination, and request older records from the city's listed open-data contact. Verify valuation, units and project linkage before combining totals. |
| Redmond | [Official Projects Viewer](https://gis.redmond.gov/cpv/) | Building permits are displayed only for six months after completion; land-use plans remain for two years after completion. This is not a complete historical inventory for a 5-year/life-of-route view. Unit and valuation schema not verified. | Obtain the historical building-permit export/API behind the viewer, including completed records; don't treat the visible map as full history. |
| Kirkland | [Housing dashboard](https://www.kirklandwa.gov/Government/Departments/Planning-and-Building/Housing/Housing-Dashboard) | Useful discovery entry point; record-level units removed, valuation, issue dates and historical coverage remain unverified. | Inspect underlying housing/permit layers and reconcile their definitions with issued building permits. |
| Unincorporated King County | [Permitting reports](https://cdn.kingcounty.gov/en/dept/local-services/certificates-permits-licenses/permits/permits-inspections-codes-buildings-land-use/permit-forms-application-materials/reports) | County permitting does not substitute for permits issued by incorporated cities. Public reports include applications/issuances; residential performance dashboard has a restricted recent cohort. | Acquire underlying issued-permit records, confirm jurisdiction and time coverage; use assessor parcels only for geography/linkage, not as a proxy for permitted units. |

These are source-discovery findings, not claims that any municipality has already
been integrated. No records requests or emails were sent.

## Shoreline schema audit

The directly retrieved layer metadata exposes these relevant fields:

| Target | Source |
| --- | --- |
| Permit identifier | `PERMIT_NO` |
| Type / subtype | `PERMIT_TYPE`, `PERMIT_SUBTYPE`, `PERMIT_COMPOSITE` |
| Description / status | `DESCRIPTION`, `STATUS` |
| Applied / approved / issued / completed / expired | `APPLIED`, `APPROVED`, `ISSUED`, `FINALED`, `EXPIRED` |
| Parcel / address | `SITE_APN`, `SITE_ADDR` |
| Location | point geometry; request output EPSG:4326 |
| Housing units added / removed | **not exposed** |
| Estimated development value | **not exposed** (`FEES_CHARGED`/`FEES_PAID` cannot substitute) |
| Parent permit / consolidated project ID | **not established**; do not assume `PERMIT_COMPOSITE` is a project identifier |

The service supports JSON/GeoJSON, ordering and pagination, with a 2,000-record
limit. A prospective importer should request only needed fields, page in
`OBJECTID` order, check transfer-limit flags/counts and deduplicate permit IDs
when address/parcel joins repeat them. First audit the min/max issue dates and
permit classifications. Save retrieval timestamps and source metadata with raw
snapshots. This report inspected metadata, not a full permit export.

## Integration contract

Add jurisdiction-specific adapters rather than passing another city's raw fields
through Seattle's `select_development_permits` classification rules.

Each normalized record needs jurisdiction, source permit ID, project/parent ID
if available, address, parcel, coordinates, issue date, status, normalized work
type, units added, units removed, valuation, source URL and retrieval date.
Identifiers must be namespaced by jurisdiction. Missing outcomes stay null with
explicit availability flags: **do not convert missing municipal housing/value
fields to zero**, which the current Seattle aggregation would otherwise do.

Before an adapter enters the dashboard:

1. Verify history, spatial coverage, date semantics and canceled/withdrawn statuses.
2. Establish how building, demolition and child permits relate to a project;
   prevent repeated valuations and housing outcomes from being summed twice.
3. Define units removed separately from a count of demolition permits. One
   demolition can remove many units; alterations can also remove housing.
4. Validate permit and project counts, gross additions, removals, net and value
   against city reports for a sample period.
5. Add per-jurisdiction and per-metric coverage indicators. Routes crossing
   boundaries must distinguish unavailable data from recorded zero activity.
6. Merge validated spatial records before corridor selection and reuse existing
   `src.tod` distance/assignment logic. Track separate municipal refresh caches.

Suggested records-export request (prepared only, not sent):

> Please provide a machine-readable export of issued building and demolition
> permits from 2004 to the present, including permit number, parent/project IDs,
> work type, description, current status, applied/issued/completed dates, site
> address, parcel ID, coordinates, housing units added and removed, and estimated
> construction/project valuation. Please include canceled/withdrawn flags, field
> definitions, missing-value conventions, and documentation of how child permits
> and repeated project valuations should be interpreted. If a public API already
> provides these fields, please share its endpoint and historical coverage.

## Expansion plan — 2026-09-29

Source discovery resumed for the ten requested jurisdictions. The entries below
are acquisition leads, not completed schema/history audits or imported datasets.
Prioritize zoning independently of permits so the route profile can expand first.

| Jurisdiction | Zoning acquisition | Permit acquisition and next audit |
| --- | --- | --- |
| SeaTac | [Zoning polygon service](https://services3.arcgis.com/DLryYCwhA8W7Jq7Q/arcgis/rest/services/Zoning/FeatureServer/0); verify current city publication and effective date | [City permitting portal](https://lama.seatacwa.gov/) exposes permit search and an Open Data entry; inspect export/API and historical coverage before choosing an importer |
| Tacoma | [Official open-data/maps entry](https://tacoma.gov/services/tacoma-open-data-maps/); discover the current city zoning polygon layer | [Permit dashboard](https://www.tacomapermits.org/dashboard) and [city permit tracking](https://tacoma.gov/government/departments/planning-and-development-services/permits-and-development-services/review-and-track-permits/); dashboard describes recent 30-day activity, so obtain historical underlying records/export |
| Renton | [City GIS/data entry](https://www.rentonwa.gov/Projects-Development/Maps-and-GIS-Data) and [Operational service directory](https://gismaps.rentonwa.gov/as03/rest/services/Operational); identify current zoning layer | City development-project services expose building permit categories; audit the underlying record layers for history, dates, unit counts and valuation; project maps alone do not establish complete permitting coverage |
| Kent | [Official GIS/GeoPortal entry](https://www.kentwa.gov/departments/public-works/land-survey-geographic-information-systems-gis); distinguish zoning from future land use | [Permit logs](https://www.kentwa.gov/pay-and-apply/apply-for-a-permit/permit-logs/-folder-1754) publish issued-permit detail spreadsheets; inspect columns and historical archives, then obtain a bulk export for missing periods |
| Burien | [Zoning layer lead](https://gis.burienwa.gov/server/rest/services/GeocortexInternal/gc_MainMap/MapServer/30); confirm supported public publication via the [city permit center](https://www.burienwa.gov/business/community_development/permit_center) | City permit center links an activity map limited to the past 18 months; seek historical building/demolition export rather than importing that window as complete history |
| White Center | [King County GIS](https://gisdata.kingcounty.gov/) current unincorporated zoning | King County permitting records; use actual jurisdiction boundaries, not postal city. [County identifies White Center as unincorporated](https://kingcounty.gov/en/dept/local-services/buildings-property/development-planning-regulations/regional-planning/king-county-comprehensive-plan) |
| Lynnwood | [Zoning layer](https://gis.lynnwoodwa.gov/gis_server/rest/services/munis_web_map/MapServer/7); compare currency with the city's adopted zoning map | [Portal documentation](https://www.lynnwoodwa.gov/Services/Apply-for-a-Permit/Online-Permit-Portal-Help-Guide) says pre-January 10, 2024 applications use the earlier system; plan a two-era export and deduplication audit |
| Shoreline | [City GIS downloads](https://www.shorelinewa.gov/our-city/maps-gis/download-gis-data), Planning category | Previously inspected permit API above; request historical valuation and housing outcomes not exposed in that schema |
| Bellevue | [City open-data portal](https://data.bellevuewa.gov/) for zoning polygons | [Development activity](https://bellevuewa.gov/development-activity): city describes five years of open permit data and older CSV data on request; verify each dataset's permit population |
| Redmond | [Official zoning ZIP download](https://www.redmond.gov/424/Data-Downloads), or [planning map service](https://gis.redmond.gov/arcgis/rest/services/PV/Planning/MapServer) zoning layer 7 | [Projects Viewer](https://gis.redmond.gov/cpv/) is not historical coverage; obtain complete building/demolition exports including completed records |

### Implementation method

1. Add a source registry with jurisdiction boundary, official layer/download URL,
   source ID field, native code/description fields, date/version, license/use terms,
   refresh method and independent zoning/permit availability status.
2. Build one reusable ArcGIS downloader (ID batches or verified pagination,
   count/unique-ID checks, atomic raw snapshots) plus ZIP/CSV/XLSX ingestion.
   Never treat an HTML viewer or a PDF map as a complete machine-readable dataset.
3. Normalize zoning to jurisdiction, source ID, native code, native label, optional
   reviewed broad category, effective/retrieved dates and geometry. Keep overlays
   separate from base districts; retain native descriptions rather than forcing
   every city's codes into Seattle's categories. Clip by jurisdiction and audit
   overlaps/gaps before merging. Future land use is not current zoning.
4. Integrate zoning first with the profile and map. Display unavailable municipal
   coverage explicitly. Suggested first audits: Shoreline and Bellevue/Redmond,
   followed by SeaTac, then the remaining requested jurisdictions as sources pass.
5. Follow the permit integration contract above city by city. Missing units/value
   remain null; report known-value coverage separately from permit counts. Use
   historical bulk-export requests where public APIs omit older/completed records.
   Do not delay zoning integration until all permit fields are available.

No municipal records requests were sent and no new datasets were imported during
this research pass.

## Implemented zoning pilot — 2026-09-29

`data/reference/zoning_sources.json` registers Shoreline, Bellevue and Redmond
base-zoning fields and official jurisdiction boundary services. The reusable
`src.municipal_zoning` importer verifies source counts and IDs, downloads explicit
ID batches, checks for source-ID changes during retrieval, repairs and clips
polygons to city boundaries, and atomically replaces each city's cache only after
validation. Failed refreshes retain the previous cache. Raw zoning, raw boundaries,
service metadata, source timestamps and validation results are retained alongside
the normalized features in ignored local cache files.

| City | Source records | Imported polygons | Native fields |
| --- | ---: | ---: | --- |
| Shoreline | 941 | 941 | CURR_ZONE, Zoning_description |
| Bellevue | 1,007 | 1,006 | Zoning, ZoningDescription; one record excluded by boundary clipping |
| Redmond | 65 | 65 | d_Zone; description taken from the layer's published renderer legend |

Labels retain native descriptions and codes and identify their jurisdiction;
no cross-city equivalence of zoning codes is inferred. Boundary-area coverage is
81.33%, 99.94% and 96.00% respectively; these denominators include the full city
boundary, not just developable land. Small source overlaps remain visible as
conflicts rather than being silently assigned. These checks establish download
integrity and geographic consistency, not a parcel-by-parcel zoning audit.
Retrieval dates do not establish a legal effective date; effective dates remain
unknown in the normalized cache.

The overlay, directional catchment summaries and two-sided route profile now use
all installed zoning caches. Source links and retrieval dates appear in the lens;
unmapped areas remain unknown. City-specific refresh controls are available.
Refresh from the command line with:

```bash
.venv/bin/python -m src.municipal_zoning shoreline bellevue redmond
```

New permit feeds, broader zoning-category classifications, tunnel segmentation
and feed-shape simplification remain separate work.

## Requested expansion coverage — 2026-09-29

The user expanded the next zoning coverage scope to the following 15 places.
These are requested additions, not installed sources. Seattle, Shoreline,
Bellevue and Redmond remain the currently imported zoning jurisdictions.

| Place | Acquisition jurisdiction | Status |
| --- | --- | --- |
| SeaTac | City of SeaTac | Source lead above; importer audit pending |
| Tukwila | City of Tukwila | Source discovery pending |
| Mercer Island | City of Mercer Island | Source discovery pending |
| Renton | City of Renton | Source lead above; importer audit pending |
| White Center | Unincorporated King County | County source audit and boundary selection pending |
| Burien | City of Burien | Source lead above; importer audit pending |
| Des Moines | City of Des Moines, Washington | Source discovery pending |
| Federal Way | City of Federal Way | Source discovery pending |
| Tacoma | City of Tacoma | Source lead above; importer audit pending |
| Kent | City of Kent, Washington | Source lead above; importer audit pending |
| Lake Forest Park | City of Lake Forest Park | Source discovery pending |
| Kirkland | City of Kirkland | Zoning source discovery pending; prior housing lead retained |
| Edmonds | City of Edmonds | Source discovery pending |
| Mountlake Terrace | City of Mountlake Terrace | Source discovery pending |
| Lynnwood | City of Lynnwood | Source lead above; importer audit pending |

Use this as the authoritative requested expansion list. Begin with zoning and
jurisdiction boundaries using the reusable importer; track permit source/history
and outcome completeness independently. A zoning import must not imply permit
coverage. Add registry entries and refresh controls only when official source
fields and boundaries have been verified. Existing source leads do not establish
that a city has passed import validation. No relative priority among these 15
places has been specified by the user.
