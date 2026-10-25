# Splunk Content Hygiene

![Content Hygiene](docs/images/content-hygiene.svg)

[![CI](https://github.com/LeiterConsulting/splunk-content-hygiene/actions/workflows/ci.yml/badge.svg)](https://github.com/LeiterConsulting/splunk-content-hygiene/actions/workflows/ci.yml)

Splunk Content Hygiene is an evidence-first Splunk Enterprise app for
inventorying knowledge objects, exploring dependencies, finding ownership and
repair concerns, and managing a review workflow before any separate cleanup
process begins.

The app keeps customer content read-only:

- It reads real Splunk data and never falls back to a demonstration dataset.
- It does not delete, disable, reassign, or rewrite customer content.
- It stores scan results and review workflow records only in app-local KV Store
  collections.
- Every finding carries reasons, evidence, and a suggested investigation step.

## What it includes

- Overview reporting for the latest live scan, including searchable, sortable,
  paginated per-app health composition
- Cleanup-candidate filtering, evidence inspection, review stages, and CSV/JSON
  export
- Bulk review of selected/page/all-filtered candidates with confirmation,
  existing-decision protection, cancellation and per-object results
- An in-use/required-content footprint grouped by type, combining current
  attributable activity and explicit Retain decisions, or following deliberately
  selected starting objects through their supported outbound dependencies
- Grouped, expandable directional dependency exploration, multi-step drill-through, candidate-group
  and review-stage filters, graph-derived removal-impact simulation, ordered
  remediation guidance, and relationship/impact export
- A persistent Review Library with triage, investigation, owner-confirmation,
  eligibility, retain, and blocked stages, with independent review-evidence
  validity, scoped coverage, change explanations, explicit reaffirmation,
  conflict-safe saves, recoverable archiving, revision history, and evidence exports
- Full-width selected-object workspaces with investigation actions at the top,
  focused evidence/decision/history tabs, previous/next review navigation, and
  unsaved-draft protection
- Exact dependency targeting with explicit unavailable/filtered-out states and
  source-scan change notices instead of unrelated fallback objects
- Ownership reporting and cross-view navigation
- Bounded and complete live scans with progress, warnings, collector counts, and
  scan-report export
- On-demand 30/90/180-day usage-evidence windows for directly attributable
  saved-search executions and dashboard access, with explicit complete,
  partial, and unavailable source coverage

The complete scan inventories installed apps, saved searches, dashboards,
macros, lookup definitions and files, data models, indexes, sourcetypes, and
users visible to the initiating Splunk user. Private objects are excluded from
the shared cache; access is restricted to explicit hygiene roles.

## Install

1. Download the release archive and `SHA256SUMS` from the
   corresponding GitHub release.
2. Verify the SHA-256 digest.
3. In Splunk Web, open **Apps > Manage Apps > Install app from file** and upload
   the archive.
4. Open **Splunk Content Hygiene > Settings & Scan Status**.
5. Run a bounded scan first, then a complete scan when the permission and
   connectivity check succeeds.

The app has real-data browser validation on Splunk Enterprise
10.2.8 and 10.4.4, including modern navigation, native launcher icons, and both
workspace themes. Broader 10.x,
search-head-cluster, and Splunk Cloud certification is not complete. See
[Installation](docs/INSTALLATION.md) for upgrade and verification details.

## Investigation workflow

1. Start with a complete scan and review any partial-result warnings.
2. Collect a bounded usage-evidence window and resolve any source-coverage
   warnings.
3. Filter **Cleanup Candidates** by health group, usage evidence, app, type, or
   review stage.
4. Inspect inbound and outbound relationships in **Dependency Explorer**.
5. Add an object to **Review Library**, record evidence, assign it, and move it
   through the appropriate confirmation stage.
6. Export the filtered evidence for external review or reporting.
7. Before relying on a saved decision, check **Review evidence** and
   **Changes since review**. Investigate changes, then explicitly reaffirm the
   evidence; scans never overwrite your decision.

Coverage separates returned configuration, returned ACL, declared outbound
references, and potential inbound references. **Current** means the supported
shared static scope matches a recent reviewed baseline—not that no hidden,
private, dynamic, or external consumer exists. Removal-impact planning retains
its wider, conservative blockers.

Concurrent saves cannot silently replace one another. A conflicting editor keeps
its draft and offers comparison with the latest saved revision. Archiving removes
only the active Library entry; its decision and revision history remain available.

## Screenshots

The 1.1 required-content report keeps explicit selections separate from observed
activity and Retain decisions. This capture starts from Content Hygiene's own
application metadata: an App is not an app-wide retain rule, so containment does
not expand its footprint. The partial-coverage warning remains visible.

![Explicit required-content investigation in dark mode](docs/images/required-content-dark.jpg)

[Light-mode report capture](docs/images/required-content-light.jpg) starts from
the app's own Dependency Explorer dashboard through its **Required content report**
action; neither capture uses demo data.

Bulk review uses a native decision editor, followed by an exact-scope confirmation
and per-object results. See the [bulk-review workflow](docs/USER_GUIDE.md#bulk-candidate-review)
for scope, conflict, cancellation, and export behavior.

The 1.0.1 Review Library gives a selected object the full workspace width,
places investigation actions beside its title, and separates decisions,
evidence, object details, and history into native tabs. These real-data captures
show Content Hygiene's own application metadata; customer content, user identity,
and lab navigation are excluded. **Current** compares a captured inventory
snapshot with the reviewed baseline, not live content or removal eligibility.

![Full-width Review Library workspace in light mode](docs/images/review-workspace-light.jpg)

![Full-width Review Library workspace in dark mode](docs/images/review-workspace-dark.jpg)

Dependency links retain the exact requested identity. A center-group mismatch
offers explicit recovery instead of silently showing another object. This
capture uses the app's own protected metadata, outside the broken-candidate group.

![Explicit dependency-target recovery in dark mode](docs/images/dependency-targeting-dark.jpg)

The directional map groups the app's real dashboard and lookup consumers by
type, with on-demand expansion and a full evidence table alongside the map.

![Grouped dependency neighborhood for Content Hygiene itself](docs/images/dependency-neighborhood-dark.jpg)

“Confirmed eligible” is an investigation conclusion, not an action. Removal or
remediation remains outside this app.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Installation](docs/INSTALLATION.md)
- [Administration](docs/ADMINISTRATION.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Architecture and data flow](docs/ARCHITECTURE.md)
- [Branding and native navigation](docs/BRANDING.md)
- [Data model](docs/DATA_MODEL.md)
- [Development and testing](docs/DEVELOPMENT.md)
- [Release process](docs/RELEASE.md)
- [Support](SUPPORT.md)
- [Security policy](SECURITY.md)

## Build from source

Node.js 22 or newer and Yarn 1.22 are required.

```bash
cd app
yarn install --frozen-lockfile
yarn validate
```

The verified installable archive is written to
`app/dist/content_hygiene-1.1.0.tar.gz`. Run `yarn release:prepare` to
perform the complete validation and update `SHA256SUMS`.

## Current limitations

- The required-content report is a partial shared static footprint, not a complete
  migration manifest. Implicit props/automatic lookups, uninventoried knowledge
  object types, private/dynamic content and ad-hoc consumers remain explicit gaps.
- Bulk review is not atomic or an app-wide retain rule. Existing decisions are
  skipped by default; completed saves remain if later items fail or are cancelled.
- Scans run in the initiating browser session and are not scheduled.
- Each complete-scan collector is capped at 10,000 visible records and reports
  truncation.
- Usage evidence is limited to saved-search and dashboard activity directly
  attributable through `_audit` and `splunk_web_access` records visible to the
  initiating user. Retention, permissions, and unmappable private namespaces
  are reported rather than treated as inactivity.
- Dynamic SPL and token references are disclosed but not resolved as broken.
- Inline dashboard panels are analyzed through their parent dashboard.
- Review history is application history, not a tamper-proof audit. Authorized
  direct KV access can alter it. App saves use a server-side coordinator;
  coordinated writes require a standalone POSIX search head, not SHC or Windows.
- Journal history grows with accepted edits. Library loading reads compact
  revision headers and the required decision/evidence documents; history details
  load in pages. Plan KV capacity and backups for your review volume.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Leiter Consulting.
