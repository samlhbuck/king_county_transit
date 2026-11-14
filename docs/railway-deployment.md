# Route Lens testing release

The first release serves the existing Python app and a bundled public-data
snapshot. Route exploration uses the bundled snapshot; private product feedback
requires a persistent volume mounted at `/feedback`. See
[product-feedback.md](product-feedback.md) for storage and private reading.
Snapshot updates require preparing and deploying a new release. Live departures
require `OBA_API_KEY` in Railway service variables; never include `.env` in uploads.
The Home Screen app requires an internet connection; offline use is not implemented.

## Prepare and deploy

1. Run `python3 scripts/prepare_release.py /tmp/route-lens-release` using a new,
   nonexistent destination. This copies the app and ignored datasets, excluding
   local credentials and unrelated repository files.
2. Install the Railway CLI following https://docs.railway.com/guides/cli and run
   `railway login` on your own computer.
3. In Railway, create an empty project and an empty service named `route-lens`.
4. From the prepared release directory, run `railway link` and select that project
   and service. Set `OBA_API_KEY` in the Railway dashboard if using live departures.
5. Run `railway up` from the prepared directory. The Dockerfile includes the data;
   Railway supplies `PORT`. The app binds to `0.0.0.0` in the container.
6. Once healthy, use the service's Networking settings to generate a public domain.
   Check `/healthz`, then open the main URL and try several routes and departures.
7. On iPhone, open the HTTPS URL in Safari, use Share → Add to Home Screen and
   enable Open as Web App if offered. Test reopening, map gestures, the scrubber,
   location permission handling and route switching on the actual device.

Do not connect GitHub automatic deployment yet: raw and processed caches are
intentionally ignored by Git. A GitHub build lacks the snapshot and fails the
Dockerfile's data check. A later automated release needs a versioned data artifact
or a separate data-fetching step before enabling GitHub deployments.

Hosted source refresh requests are disabled server-side, regardless of request
headers. The local refresh UI remains available for maintaining the next snapshot.
The current server is a small testing server, with serialized route calculations;
measure memory and response times before expanding access beyond a small pilot.

## Redeploy after making changes

### One-command utility (recommended)

Save your files, then run from the repository:

```bash
python3 scripts/redeploy.py
```

The utility targets our existing `route-lens` Railway project, `production`
environment and `route-lens` service. It checks the project/service, prepares a
fresh temporary snapshot, uploads with explicit target arguments (no repeated
`railway link`), and watches the exact uploaded deployment until `SUCCESS`.
It stops on failure, approval-required states, or a 20-minute polling timeout;
check the printed dashboard link before retrying an uncertain upload. Ctrl+C
stops watching, not a deployment already submitted to Railway.

The Railway CLI must be installed and signed in. Existing server variables and
the public URL are retained. It does not create infrastructure, alter API keys,
commit or push Git changes, or perform the final iPhone interaction check.
Release folders are retained in the system temporary directory for inspection.

To prepare a snapshot without uploading anything:

```bash
python3 scripts/redeploy.py --prepare-only
```

Use `--help` for target overrides and the polling timeout. The manual steps below
remain available for troubleshooting.

### Manual alternative

**No Git commit or push is required for this CLI upload workflow.** The release
script copies the files currently on your computer, including saved, uncommitted
changes. Save your editor files first. Always prepare a fresh release: uploading
the old `/tmp/route-lens-release` folder again uploads its old copies.

Run these commands in Terminal:

```bash
cd /Users/samuelbuck/repos/king_county_transit
release_dir="/tmp/route-lens-release-$(date +%Y%m%d-%H%M%S)"
python3 scripts/prepare_release.py "$release_dir"
```

If preparation succeeds, continue in the same Terminal window:

```bash
cd "$release_dir"
railway link
```

Select the **existing** `route-lens` project, `production` environment, and
`route-lens` service. Each new release directory needs linking; do not create a
new project or service for each release. Then run:

```bash
railway status
railway up --service route-lens --environment production
railway deployment list --service route-lens --environment production --json
```

Check that `railway status` names the intended project before uploading. After
uploading, wait for the new deployment to reach `SUCCESS` in the deployment list
or Railway dashboard. Upload completion alone does not mean the app is running.
If needed, inspect build or runtime logs:

```bash
railway logs --service route-lens --environment production --build --lines 100
railway logs --service route-lens --environment production --lines 100
```

The existing public URL and service variables (including `OBA_API_KEY`) remain
in place. Open the URL and check `/healthz`, then test the changed features. On
iPhone, close and reopen the Home Screen app; if it still shows an old open page,
reload the same URL in Safari. Reinstallation should not be necessary.

The dashboard's **Redeploy** action reuses an existing uploaded release; it does
not pick up new files from your computer. Use the fresh-folder procedure above
for code or cached-data changes. Temporary release folders can disappear after
system cleanup; the repository remains the source for preparing another release.

### Git steps (recommended for version history, separate from deployment)

From the repository, review and commit the source changes you want to keep:

```bash
cd /Users/samuelbuck/repos/king_county_transit
git status --short
git diff --stat
git diff
# Stage only the files you reviewed, for example:
git add web/map.js web/mobile.js web/style.css docs/railway-deployment.md
git diff --cached
git commit -m "Improve mobile map interactions and document redeployment"
git push
```

The `git add` command is an example for those particular edits, not the complete
list of pending work. Include other reviewed source files and new deployment
files as appropriate; `git diff` does not show the contents of untracked files.
Avoid blindly staging unrelated work. Do not force-add `.env`, raw/processed data,
or temporary release folders. A commit records code, not the ignored data snapshot.
Pushing backs up the commit to GitHub; it does not deploy this CLI-managed service.

### Upload returns 404

Run `railway status` and confirm the project, environment and service. In the
dashboard, check for pending **Apply changes / Deploy changes**: the service must
exist in `production`, not just as a pending project change. Apply the intended
service creation, link the prepared folder to it, and retry. If no changes are
pending, inspect the target and account access before creating duplicate services.

## Validation and limitations

The health check succeeds only after initial route analysis finishes. Startup can
take time. Deployment allows 300 seconds before a failed health check. Monitor
Railway's memory and billing; no monthly cost estimate is established yet.

The Docker build and actual iPhone behavior require validation in their respective
environments. A manifest and icons provide install presentation, not offline data
or App Store distribution.

Railway references:
- https://docs.railway.com/builds/dockerfiles
- https://docs.railway.com/cli/up
- https://docs.railway.com/deployments/healthchecks
