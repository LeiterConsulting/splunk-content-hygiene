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

Usage evidence additionally depends on search access to `_audit` for
saved-search activity and `_internal` `splunk_web_access` events for dashboard
access. Each source is evaluated independently. Missing permissions, retention
gaps, empty sources, and truncated results remain explicit and never become
evidence of inactivity.

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
- Saved-search execution observations from `_audit`
- Dashboard-access observations from `splunk_web_access`

No arbitrary filesystem scan, external network request, custom REST handler, or
subprocess runs in the installed app.

## KV Store collections

- `ch_objects`: normalized latest-scan objects
- `ch_edges`: directional dependency evidence
- `ch_findings`: scan-specific findings
- `ch_owners`: ownership summaries
- `ch_usage_evidence`: per-object usage observations, window coverage, and
  provenance
- `ch_scan_runs`: lifecycle, counts, warnings, and checkpoints
- `ch_reviews`: durable review workflow state
- `ch_exemptions` and `ch_settings`: reserved app-owned configuration state

Inventory snapshots are replaced only after the scan has collected and
analyzed data. A 30-minute app-local scan lock prevents overlapping scans and
can recover after expiry.

Usage runs share the same lock and are stored separately from inventory
snapshots. They retain only aggregate counts and timestamps; raw search strings
and actor lists are held only in browser memory while attribution is performed.

## Operational guidance

- Begin with a bounded scan after install or upgrade.
- Schedule complete scans through an operator workflow only after evaluating
  their effect on the search head; automatic scheduling is not included.
- Keep the initiating browser tab open.
- Investigate visible-record counts that reach the 10,000 cap.
- Preserve and review scan warnings with exported reports.
- Start with a 30-day usage window, inspect search-head impact, and expand to
  90 or 180 days only when retention and workload permit.
- Each source search has a 140-second browser safety limit and a 10,000-row
  activity cap. A timeout, warning, or cap makes that source incomplete.
- Treat a complete window with zero observations as investigation evidence,
  never as automatic removal authorization.
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

**Usage coverage is partial or unavailable:** verify that the initiating role
can search `_audit` and `_internal`, then compare the requested window with
local retention. The app intentionally leaves affected objects unclassified
rather than converting missing telemetry into “unused.”

**Review updates fail:** verify KV Store health and write access to
`content_hygiene` collection `ch_reviews`.
