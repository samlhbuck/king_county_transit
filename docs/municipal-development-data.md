# Adjacent municipality development data

Research checked 2026-09-23. **Only Seattle data is currently loaded into the
Route Explorer.** A zero outside Seattle is not evidence of zero development.
The UI now states this beside the charts.

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
