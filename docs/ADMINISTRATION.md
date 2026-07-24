# Administration

## Access model

The app uses the signed-in user's Splunk session. Inventory completeness is
therefore limited to REST resources that user is allowed to see.

The packaged metadata grants authenticated users read access to application
views and collections. Scan-derived collections are writable by `admin` and
`sc_admin`. The `ch_reviews` collection is writable by authenticated app users
so they can maintain investigation workflow state. Collection data is not
exported to other apps.

Run scans as an administrator during beta evaluation. If a restricted role is
used, validate access to every supported REST resource and treat collector
warnings as a partial inventory—not as proof of absence.

## Collected resources

- Installed apps
- Saved searches, reports, and alerts
- Classic and Dashboard Studio view definitions
- Macros
- Lookup definitions and REST-visible lookup files
- Data models
- Indexes
- Sourcetypes
- Users for ownership correlation

No arbitrary filesystem scan, external network request, custom REST handler, or
subprocess runs in the installed app.

## KV Store collections

- `ch_objects`: normalized latest-scan objects
- `ch_edges`: directional dependency evidence
- `ch_findings`: scan-specific findings
- `ch_owners`: ownership summaries
- `ch_scan_runs`: lifecycle, counts, warnings, and checkpoints
- `ch_reviews`: durable review workflow state
- `ch_exemptions` and `ch_settings`: reserved app-owned configuration state

Inventory snapshots are replaced only after the scan has collected and
analyzed data. A 30-minute app-local scan lock prevents overlapping scans and
can recover after expiry.

## Operational guidance

- Begin with a bounded scan after install or upgrade.
- Schedule complete scans through an operator workflow only after evaluating
  their effect on the search head; automatic scheduling is not included.
- Keep the initiating browser tab open.
- Investigate visible-record counts that reach the 10,000 cap.
- Preserve and review scan warnings with exported reports.
- Back up app-owned KV Store data under the same policy as other internal
  operational metadata.
- Treat review notes and assignees as potentially sensitive.

## Troubleshooting

**No snapshot is shown:** run a scan from Settings. The app intentionally has no
fallback dataset.

**A scan is partial:** inspect the collector warning and the signed-in user's
capabilities. Re-run after correcting access; do not interpret unseen objects
as absent.

**A scan appears locked:** wait for the active browser-session scan to finish.
An abandoned lock expires after 30 minutes.

**A relationship is unresolved:** inspect its confidence, evidence, and source
location. Dynamic names, tokenized SPL, app namespaces, and incomplete
collector visibility can prevent resolution.

**Review updates fail:** verify KV Store health and write access to
`content_hygiene` collection `ch_reviews`.
