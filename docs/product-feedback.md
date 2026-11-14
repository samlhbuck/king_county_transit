# Product feedback

Open **? → How to explore → Send feedback** (or Send feedback directly from
the general guide). Choose a category; text and route/stop/lens context are
optional. The form previews the context and lets you omit it. A receipt appears
only after the private queue commits the submission. Failed submissions retain
the draft, and retrying the same draft uses the same receipt to avoid duplicates.

Submissions are never published automatically. No account, email address or
location history is collected. Records expire after 90 days; cleanup runs at
startup, hourly, and when submitting or reading. Text is limited to 4,000
characters. A honeypot and a per-process limit of five attempts per client per
ten minutes provide basic spam protection. Client addresses are represented
only by ephemeral hashes in memory, not stored with feedback. This is product
feedback, separate from future trip/stop reports.

## Storage and private reading

Local development uses `var/feedback.sqlite3`, excluded from Git and release
snapshots. Read it with:

```bash
.venv/bin/python -m src.feedback list --limit 50
```

Production requires a Railway volume mounted at `/feedback`, storing
`/feedback/feedback.sqlite3`. `RAILWAY_VOLUME_MOUNT_PATH` selects this store;
`FEEDBACK_DB_PATH` can explicitly select another persistent path. Hosted
feedback is unavailable when neither is configured. The container prepares
volume ownership, then runs the application as the unprivileged `routeapp` user.
The SQLite queue supports this service's single-replica deployment.

Read production feedback privately through authenticated Railway SSH using an
SSH key already registered with your Railway account:

```bash
railway ssh \
  --project 0b4c9245-f4b6-49eb-b3d3-7d9c9d43fd98 \
  --environment bdfd1551-e7c2-4fdb-9f6d-15660db7ae76 \
  --service a17bc147-2344-4bde-95fd-3e20a744c581 \
  -- python -m src.feedback list --limit 50
```

There is no public retrieval endpoint. `GET /api/feedback` exposes only
availability and retention; `POST /api/feedback` accepts validated same-origin
JSON and returns a committed receipt. Keep private queue exports out of the
public-data snapshot.

## Verification checkpoint (2026-10-08)

Deployment `38f98f98-f835-4c69-a24c-104df3710568` reached SUCCESS. The
production /feedback volume is Ready. Live desktop/mobile form checks confirmed
two committed receipts, omitted context, retained error drafts and preserved
camera position. The verification receipts are
`f10cd94b14bd4d8190de389db5181cc3` and
`cd8726bee52b43929485b48aef5d40bc`; both carry clearly marked automated test
messages. Unit tests verify private retrieval and persistence across store
reopening. With explicit authorization, a temporary SSH key was registered to
verify only these two test receipts. Deployment
`7ec09359-eb34-4603-a50f-5dc4e0e7697f` reached SUCCESS, and both records were
retrieved afterward with unchanged IDs and creation timestamps. The temporary
Railway key was removed after verification. An initial retry failed during
Railway snapshot creation; the subsequent deployment succeeded.
