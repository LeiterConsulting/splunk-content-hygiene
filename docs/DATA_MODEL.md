# Data model

Every analytical record carries a scan identifier so a displayed result can be
traced to the inventory that produced it. The canonical JSON Schemas are in the
repository [`schemas`](../schemas/) directory.

## Objects

An object records canonical identity, display name, type, app, owner, sharing,
enabled and scheduled state, update and usage timestamps when known, health
status, evidence, suggested action, reference counts, protection state, and
source provenance.

Logical saved-search identity is stable across Saved Search/Report/Alert display
types. Storage keys are qualified by scan ID. `inventoryScanId` and per-source
`analysisWarnings` accompany normalized UI objects; JSON exports add the shared
`usageValidity` result.

New scans also persist versioned `configuration_fingerprint` and `review_evidence`
fields in `ch_objects`. SHA-256 field digests cover returned non-operational
configuration; a separate ACL digest includes owner, sharing, and sorted read/write
role lists. Raw definitions and role lists are not retained by this feature.
Equivalent macro boolean encodings and read-generated data-model editor
`calculationID` values are normalized; calculation expressions, output fields,
and other definition settings remain fingerprinted. Field names are stored as
array values to meet KV Store batch-write restrictions.
Evidence contains scan/time provenance, normalized metadata, a full sorted direct
adjacency digest, at most 200 compact relationship rows, scanning identity/role and
collector-scope digest, completeness, and explicit limitations. Adjacent-object
configuration/access digests detect changed consumers even when edge identity is
stable. Indexes are built once per scan; Library loading does not require the
full edge collection.

Supported health values are `active`, `dormant`, `orphaned`, `broken`,
`unowned`, `protected`, and `unknown`.

## Edges

An edge points from a source object to a target identity and records relation,
confidence, evidence, source location, resolution state, and scan provenance.
Unresolved targets remain valuable evidence and are not discarded.
`uses_file` connects a lookup definition to its configured backing file;
`belongs_to` points from app-scoped content to its containing app. These are
configuration relationships, not observed executions.

## Findings

A finding references an object and records a finding type, evidence-backed
reasons, suggested action, optional abandonment/removal-impact scores, creation
time, and scan provenance.

Finding types include cleanup candidate, broken reference, unowned, protected,
needs review, repair required, and insufficient evidence.

## Owners

Owner summaries contain the visible owner state and object counts used by the
Ownership view. Shared app/global content is represented separately from a
genuinely missing or disabled owner.

## Scan runs

A scan run records mode, lifecycle status, start and completion times, analysis
status, object/edge/finding counts, per-collector cached and visible totals,
warnings, and errors. Status may be queued, running, partial, succeeded, failed,
or cancelled.

Snapshot version 2 uses a `ch_settings` manifest with separate complete-baseline
and latest-run pointers. Retirement removes only superseded derived evidence;
scan summaries and reviews are retained independently.
Settings can report a newer bounded check separately while operational views
retain the complete baseline; scan JSON exports include both identities.

Usage runs use scan type `usage` and additionally record the inventory scan
used for attribution, requested window, overall coverage, eligible and observed
object counts, and per-source coverage summaries.

## Usage evidence

A usage-evidence record is keyed by usage run and object identity. It contains:

- the source and attributable activity kind;
- inventory and usage-run provenance;
- requested window and visible source coverage;
- source-event and object-observation counts;
- successful, failed, and skipped outcomes when reported;
- the last observed activity time; and
- plain-language evidence and caveats.

Coverage is `complete`, `partial`, or `unavailable`. A zero observation count
has no inactivity meaning unless coverage is complete, the evidence belongs to
the current inventory, and the object was not modified after the evidence
window, and the window ended no more than seven days ago. Historical, modified,
expired, unsupported, and not-measured states remain distinct from source
coverage. Unsupported telemetry does not mean inactivity.

## Reviews

A review is a durable, app-local record keyed by object identity. It contains
an identity snapshot, health status at review, workflow stage, note, optional
assignee, scan provenance, timestamps, and updater identity.
The record also snapshots usage coverage, observation count, last-observed
time, and usage-run provenance at the time of review.

Review stages are `triage`, `investigating`, `awaiting_owner`,
`confirmed_eligible`, `retain`, and `blocked`. A review record does not
represent or perform a mutation of its referenced Splunk object.

Optional `evidence_baseline` contains capture time/actor, the versioned object
evidence manifest, and usage evidence at capture. `evidence_history` retains the
first capture plus the four most recent prior captures; the active baseline is
separate. These fields belong to `ch_reviews`, independent of snapshot retirement.
Normal edits preserve baselines and original at-review facts. Only explicit
capture/reaffirmation changes the baseline. A pre-save timestamp check rejects
known concurrent edits; it is not a transactional compare-and-swap guarantee.

Review validity (`current`, `needs_review`, `cannot_verify`, `unreviewed`) is
derived, never written into the decision stage. Unsupported/malformed evidence
versions are unverified, not automatically upgraded. The evidence JSON Schema
documents the camel-case manifest nested in the snake-case KV record.

## Derived removal-impact reports

Removal-impact reports are derived from the selected object, current edge set,
scan status, and Review Library state. They contain direct and indirect
affected objects, shortest known paths, likely outcomes, cross-app scope,
dependency follow-ups, evidence caveats, readiness, and an ordered
change-control plan. They are exportable but are not persisted as authority to
remove content.
