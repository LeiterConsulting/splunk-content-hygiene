# Data model

Every analytical record carries a scan identifier so a displayed result can be
traced to the inventory that produced it. The canonical JSON Schemas are in the
repository [`schemas`](../schemas/) directory.

## Objects

An object records canonical identity, display name, type, app, owner, sharing,
enabled and scheduled state, update and usage timestamps when known, health
status, evidence, suggested action, reference counts, protection state, and
source provenance.

Supported health values are `active`, `dormant`, `orphaned`, `broken`,
`unowned`, `protected`, and `unknown`.

## Edges

An edge points from a source object to a target identity and records relation,
confidence, evidence, source location, resolution state, and scan provenance.
Unresolved targets remain valuable evidence and are not discarded.

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

## Reviews

A review is a durable, app-local record keyed by object identity. It contains
an identity snapshot, health status at review, workflow stage, note, optional
assignee, scan provenance, timestamps, and updater identity.

Review stages are `triage`, `investigating`, `awaiting_owner`,
`confirmed_eligible`, `retain`, and `blocked`. A review record does not
represent or perform a mutation of its referenced Splunk object.

## Derived removal-impact reports

Removal-impact reports are derived from the selected object, current edge set,
scan status, and Review Library state. They contain direct and indirect
affected objects, shortest known paths, likely outcomes, cross-app scope,
dependency follow-ups, evidence caveats, readiness, and an ordered
change-control plan. They are exportable but are not persisted as authority to
remove content.
