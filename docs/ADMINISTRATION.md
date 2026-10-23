# Administration

## Access model

The app uses the signed-in user's Splunk session. Inventory completeness is
therefore limited to REST resources that user is allowed to see.

The server enforces an explicit hygiene audience. Assign these roles only to
trusted operators authorized to see shared operational metadata and review notes:

| Role | View and export | Maintain reviews | Collect inventory and usage |
| --- | --- | --- | --- |
| `content_hygiene_viewer` | Yes | No | No |
| `content_hygiene_reviewer` | Yes | Yes | No |
| `content_hygiene_operator` | Yes | Yes | Yes |
| `admin` / `sc_admin` | Yes | Yes | Yes |

No role is assigned automatically. Use the named role directly on an account
for the corresponding UI actions. These roles do not grant broader source REST
or index-search capabilities; collection still requires appropriate existing
permissions. Collection data is not exported to other apps. User-private objects
are excluded from the shared inventory. App/global metadata collected by an
operator is shared with the hygiene audience, not re-filtered per viewer. Treat
exports as internal operational data.

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

- `ch_objects`: normalized, immutable scan-qualified objects
- `ch_edges`: directional dependency evidence
- `ch_findings`: scan-specific findings
- `ch_owners`: ownership summaries
- `ch_usage_evidence`: per-object usage observations, window coverage, and
  provenance
- `ch_scan_runs`: lifecycle, counts, warnings, and checkpoints
- `ch_reviews`: durable review workflow state
- `ch_settings`: scan lock and verified inventory manifest
- `ch_exemptions`: reserved app-owned configuration state

Every snapshot uses new storage keys. Counts and reference integrity are
verified before an operational manifest is published. Failed or cancelled runs
cannot overwrite the baseline. A bounded or incomplete scan does not replace
an established complete baseline. A 30-minute app-local lock prevents overlap;
an expired or superseded lock cannot publish a snapshot. Cancel stops further
browser requests; an already accepted server request may finish.

After publication, retention preserves the baseline, the latest run, three
recent immutable inventory snapshots, and three recent usage runs with their
inventory bases. Superseded derived records are retired by exact app-owned scan
ID; scan summaries and durable reviews remain. Legacy pre-0.4 snapshots are not
trusted as baselines and their derived cache is retired after a verified scan.
Retirement refuses malformed or missing scan identities and can never issue an
empty deletion filter. KV checkpoints preserve full documents because Splunk's
update endpoint replaces records rather than applying partial merges.

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
- Usage evidence expires for decision-making seven days after its window ends.
  Inventory mismatches and later object modifications also invalidate it.
  Historical evidence is labeled and cannot establish current readiness.
- Back up app-owned KV Store data under the same policy as other internal
  operational metadata.
- Treat review notes and assignees as potentially sensitive.

## Troubleshooting

**No snapshot is shown after upgrade:** run a complete scan from Settings to
establish an immutable baseline. Existing reviews remain available. The app
intentionally has no fallback dataset.

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
