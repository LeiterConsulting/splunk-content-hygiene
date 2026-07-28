# User guide

## Start with a scan

Open **Settings & Scan Status**. A bounded scan reads at most 100 records from
each collector and is the quickest permission and connectivity check. A
complete scan paginates through visible records up to the documented
10,000-record cap per collector and performs dependency analysis.

Keep the browser tab open while a scan runs. If any collector is incomplete,
the scan and every page retain a visible warning. The app does not substitute
sample data for missing results.

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

Filter by health group, app, object type, free text, or Review Library stage.
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
targets, traversal limits, and known direct dependents prevent an eligible
result. Even an eligible result means only that captured graph prerequisites
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
the object is not visible in the latest scan. Removing a review record removes
only the app-local workflow entry.

## Ownership

Use ownership summaries to find content associated with missing, disabled,
shared, or unknown owners. Drill into an app or object in the other views before
making a decision. Global or app sharing is not automatically an ownership
defect.

## Reporting

Overview, candidates, dependency relationships, review records, ownership, and
scan status expose CSV and/or JSON export controls. Exports are generated in
the browser from the current live snapshot and active filters. Review exported
files before sharing because object names, apps, owners, notes, and evidence may
be sensitive.
