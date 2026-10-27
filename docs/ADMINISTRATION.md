# Administration

## Access model

The app uses the signed-in user's Splunk session. Inventory completeness is
therefore limited to REST resources that user is allowed to see.

The server enforces an explicit hygiene audience. Assign these roles only to
trusted operators authorized to see shared operational metadata and review notes:

| Role | View and export | Maintain reviews | Manage app-wide policies | Collect inventory and usage |
| --- | --- | --- | --- | --- |
| `content_hygiene_viewer` | Yes | No | No | No |
| `content_hygiene_reviewer` | Yes | Yes | No | No |
| `content_hygiene_operator` | Yes | Yes | Yes | Yes |
| `admin` / `sc_admin` | Yes | Yes | Yes | Yes |

No role is assigned automatically. Use the named role directly on an account
for the corresponding UI actions. These roles do not grant broader source REST
or index-search capabilities; collection still requires appropriate existing
permissions. Collection data is not exported to other apps. User-private objects
are excluded from the shared inventory. App/global metadata collected by an
operator is shared with the hygiene audience, not re-filtered per viewer. Treat
exports as internal operational data.

For initial evaluation, run scans with a suitably authorized operator. If a restricted role is
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

No arbitrary filesystem scan, external network service, or shell/subprocess
command runs in the installed app. A narrow Python REST coordinator serializes
app-local review writes using a runtime lock under
`$SPLUNK_HOME/var/run/splunk/content_hygiene/`. The Splunk service account must be
able to create this directory and its lock file. The lock releases when the
process exits; do not delete it while saves are active.

## KV Store collections

- `ch_objects`: normalized, immutable scan-qualified objects
- `ch_edges`: directional dependency evidence
- `ch_findings`: scan-specific findings
- `ch_owners`: ownership summaries
- `ch_usage_evidence`: per-object usage observations, window coverage, and
  provenance
- `ch_scan_runs`: lifecycle, counts, warnings, and checkpoints
- `ch_reviews`: preserved legacy decisions, read-only to the application
- `ch_review_revisions`: accepted review revisions, evidence captures, and
  archive/restore history
- `ch_app_policy_revisions`: independent exact-app retention policy revisions,
  with server-attributed actor/time and recoverable disable/archive/reactivation
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

Review journals are not retired with scan snapshots. The application inserts a
new deterministic object/sequence key for every accepted edit. The server-side
coordinator serializes and rechecks saves, admitting only one successor. KV
duplicate-key rejection alone is not an atomicity guarantee. The app never updates or deletes accepted journal
documents. Reviewer/operator KV permissions are collection-level and still allow
direct REST modification outside the app. The journal is not a tamper-proof audit;
new revision reviewer names/times come from the authenticated server context and
server clock, and KV `_user` is the shared storage namespace, not the reviewer.
Restrict direct KV access accordingly. All app editors must use the coordinator;
direct raw KV modification is outside its conflict-safety contract.

This is application-level serialization, not a database transaction or a
cross-host lock. A process, transport, or storage failure can leave a save outcome
uncertain. Writes are not replayed; missing, duplicate, or inconsistent journal
history blocks subsequent edits. Preserve drafts and both collections for
administrative recovery rather than deleting conflicting decisions.

The coordinator accepts the `content_hygiene_review` capability or existing
administrative `admin_all_objects`, verifies the named role, and uses the caller's existing
collection permissions. It receives no system token and has no customer-content
write destination. Coordinated saves require a standalone POSIX search head;
search-head clusters and Windows coordination are not supported in 1.0.
The app capability is inherited by reviewer/operator roles and explicitly enabled
for existing `admin`/`sc_admin` roles so administrators can assign the app roles.
It grants no customer-source capability.

Back up `ch_reviews` and `ch_review_revisions` together. Do not prune individual
revisions: sequence integrity, preserved legacy origins, and evidence references
are required to reconstruct current decisions. Revisions retain compact decision
snapshots; evidence payloads are referenced rather than copied on ordinary edits.
Library loading validates all compact revision headers, then fetches heads and
referenced captures in bounded batches. History details load 20 at a time. This
reduces payload duplication but does not make journal growth free or establish an
unlimited-scale guarantee.

Back up `ch_app_policy_revisions` as well. It is independent from individual
decisions and never retired with scans. Policy writes use the same serialized
coordinator but require the operator/admin role and exact collection permission;
reviewer authority alone cannot manage a policy. The server validates expected
parents and current full-preview app configuration/ACL scope before activation.
Disabling/archiving preserves the last scope and works for missing apps. Policy
history is not tamper-proof against privileged direct KV modification. The UI
requires consistent complete keyset reads; duplicate, gapped, malformed or
over-capacity history is unavailable, never silently treated as no protection.
There is a 10,000-policy-revision safety capacity across all apps, with a warning
at 9,000. Plan supported backup/recovery or capacity work before exhaustion;
do not delete individual revisions as a workaround. Policy/history displays page
25 rows, and full history exports are separate from snapshot/Library backups.

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

**Review updates fail:** verify KV Store health and the assigned hygiene role's
write access to `content_hygiene` collection `ch_review_revisions`. Do not enable
legacy writes as a workaround. See [Troubleshooting](TROUBLESHOOTING.md).
