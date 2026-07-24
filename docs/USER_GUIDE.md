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
