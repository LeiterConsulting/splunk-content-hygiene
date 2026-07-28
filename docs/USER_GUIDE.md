# User guide

## Start with a scan

Open **Settings & Scan Status**. A bounded scan reads at most 100 records from
each collector and is the quickest permission and connectivity check. A
complete scan paginates through visible records up to the documented
10,000-record cap per collector and performs dependency analysis.

Keep the browser tab open while a scan runs. If any collector is incomplete,
the scan and every page retain a visible warning. The app does not substitute
sample data for missing results.

## Collect usage evidence

After an inventory scan, choose a 30, 90, or 180-day window in **Settings &
Scan Status** and select **Collect usage evidence**. The app runs bounded,
on-demand searches against the saved-search audit trail and Splunk Web access
log visible to the signed-in user.

Usage collection records only derived counts, last-observed timestamps, source
coverage, and provenance in `ch_usage_evidence`. Raw user SPL and actor lists
are not persisted. The customer object is never executed, changed, disabled, or
deleted by this workflow.

Each telemetry source is capped at 10,000 attributable rows and a 140-second
interactive request budget. Reaching either guardrail produces incomplete
coverage rather than a silent conclusion.

Every supported object receives one of these evidence states:

- **Activity observed** — attributable executions or dashboard accesses were
  found.
- **No activity, complete window** — source records span the requested window
  and no attributable activity was found. This supports investigation but is
  not proof that the object is unused.
- **Partial window** — visible telemetry does not span the requested period.
- **Unavailable** — the source was empty, inaccessible, or the search failed.
- **Not measured** — no applicable usage run exists for the object.

Only a complete current window with zero observations can increase abandonment
confidence. Observed activity can lower abandonment confidence. Partial,
unavailable, stale, or post-modification evidence never produces an inactivity
classification.

## Understand the status groups

- **Active**: current evidence does not identify a hygiene concern.
- **Dormant**: available evidence suggests review, but usage telemetry is not
  yet sufficient for an automated removal conclusion.
- **Orphaned**: dependency or ownership evidence suggests an object is no longer
  connected as expected.
- **Broken**: a supported explicit reference could not be resolved in the
  visible, complete catalog.
- **Unowned**: ownership evidence requires review.
- **Protected**: the object should not be treated as a routine cleanup
  candidate.
- **Unknown**: permissions, catalog completeness, or missing evidence prevent a
  defensible classification.

These are investigation aids, not deletion instructions.

## Environment Overview

The **Live inventory by app** tile includes every app in the latest live
snapshot. Search by app name, sort by app name, object count, or any displayed
health percentage, reverse the sort direction, and choose 5, 10, or 25 rows per
page.

Select a health-composition bar to see exact counts and percentages for that
app. Select the app name or **View app candidates** to open Cleanup Candidates
with the app filter applied. Pagination and sorting change only the Overview
presentation; exports continue to include the complete live app summary.

## Cleanup Candidates

Filter by health group, usage-evidence state, app, object type, free text, or
Review Library stage.
Open an object to inspect identity, ownership, reference counts, reasons, and
suggested next steps. Exports include the full filtered result set, not just the
current page.

Use **Review candidate** to store a stage, investigation note, and optional
assignee. The underlying Splunk object is not changed.

## Dependency Explorer

Choose a center object to see inbound and outbound relationships. Each edge
shows direction, relation, confidence, resolution state, source location, and
evidence.

Filters can restrict the center objects and related results by cleanup group or
Review Library stage. Select a resolved related object to continue the
investigation as a multi-step drill-through. Cross-view links preserve the
selected object context.

### Impact of removal

For the selected center object, **Impact of removal** analyzes the complete
unfiltered relationship snapshot even when the visible graph is filtered. Its
depth control follows known dependents for one, two, three, or five hops.

The simulation reports:

- direct consumers whose captured reference would be broken;
- indirect consumers reachable through a cascading dependency path;
- affected app namespaces and protected or unresolved blockers;
- the exact path, relation, confidence, evidence, and likely outcome for every
  affected object;
- dependencies that may have no other known consumer after the selected object
  is retired; and
- an ordered validation, owner-confirmation, remediation, rollback, controlled
  change, and post-change verification plan.

Impact readiness is intentionally conservative. Protected content,
retain/blocked review decisions, partial scans, collector warnings, unresolved
targets, traversal limits, known direct dependents, observed recent activity,
and absent or incomplete current usage windows prevent an eligible result. Even
an eligible result means only that captured graph and observation prerequisites
are satisfied; it is not authorization or proof of safety.

Use the impact CSV for an affected-object register and the JSON report for the
complete analysis, consequences, caveats, follow-ups, and recommended sequence.
The application never performs the removal.

## Review Library

The Review Library is durable app-local workflow state:

- **Triage** — saved for initial review and prioritization.
- **Investigating** — dependency, usage, or ownership evidence is under review.
- **Awaiting owner** — an owner or subject-matter expert must confirm intent.
- **Confirmed eligible** — evidence supports eligibility for a separate future
  cleanup process.
- **Retain** — the object was reviewed and should remain.
- **Blocked** — missing evidence, policy, or a dependency prevents a decision.

Review records retain an object identity snapshot and scan provenance even if
the object is not visible in the latest scan. Saving a review also snapshots the
current usage coverage, observation count, last-observed time, and usage-run
identifier so later evidence changes remain visible. Removing a review record
removes only the app-local workflow entry.

## Ownership

Use ownership summaries to find content associated with missing, disabled,
shared, or unknown owners. Drill into an app or object in the other views before
making a decision. Global or app sharing is not automatically an ownership
defect.

## Reporting

Overview, candidates, dependency relationships, review records, ownership, and
scan status expose CSV and/or JSON export controls. Exports are generated in
the browser from the current live snapshot and active filters. Candidate,
dependency, review, environment, and scan exports include applicable usage
coverage and observations. Review exported files before sharing because object
names, apps, owners, notes, and evidence may be sensitive.
