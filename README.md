# Splunk Content Hygiene

[![CI](https://github.com/LeiterConsulting/splunk-content-hygiene/actions/workflows/ci.yml/badge.svg)](https://github.com/LeiterConsulting/splunk-content-hygiene/actions/workflows/ci.yml)

Splunk Content Hygiene is an evidence-first Splunk Enterprise app for
inventorying knowledge objects, exploring dependencies, finding ownership and
repair concerns, and managing a review workflow before any separate cleanup
process begins.

The beta is deliberately safe:

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
- Directional dependency exploration, multi-step drill-through, candidate-group
  and review-stage filters, graph-derived removal-impact simulation, ordered
  remediation guidance, and relationship/impact export
- A persistent Review Library with triage, investigation, owner-confirmation,
  eligibility, retain, and blocked stages
- Ownership reporting and cross-view navigation
- Bounded and complete live scans with progress, warnings, collector counts, and
  scan-report export

The complete scan inventories installed apps, saved searches, dashboards,
macros, lookup definitions and files, data models, indexes, sourcetypes, and
users visible to the initiating Splunk user.

## Install the beta

1. Download `content_hygiene-0.2.1-beta.tar.gz` and `SHA256SUMS` from the
   corresponding GitHub prerelease.
2. Verify the SHA-256 digest.
3. In Splunk Web, open **Apps > Manage Apps > Install app from file** and upload
   the archive.
4. Open **Splunk Content Hygiene > Settings & Scan Status**.
5. Run a bounded scan first, then a complete scan when the permission and
   connectivity check succeeds.

The beta is verified on Splunk Enterprise 10.0.1. Broader Splunk Enterprise
10.x and Splunk Cloud certification is not yet complete. See
[Installation](docs/INSTALLATION.md) for upgrade and verification details.

## Investigation workflow

1. Start with a complete scan and review any partial-result warnings.
2. Filter **Cleanup Candidates** by health group, app, type, or review stage.
3. Inspect inbound and outbound relationships in **Dependency Explorer**.
4. Add an object to **Review Library**, record evidence, assign it, and move it
   through the appropriate confirmation stage.
5. Export the filtered evidence for external review or reporting.

“Confirmed eligible” is an investigation conclusion, not an action. Removal or
remediation remains outside this app.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Installation](docs/INSTALLATION.md)
- [Administration](docs/ADMINISTRATION.md)
- [Architecture and data flow](docs/ARCHITECTURE.md)
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
`app/dist/content_hygiene-0.2.1-beta.tar.gz`. Run `yarn release:prepare` to
perform the complete validation and update `SHA256SUMS`.

## Current limitations

- Scans run in the initiating browser session and are not scheduled.
- Each complete-scan collector is capped at 10,000 visible records and reports
  truncation.
- Usage-history and dashboard-view telemetry are not collected, so “last used”
  remains unknown and abandonment conclusions stay conservative.
- Dynamic SPL and token references are disclosed but not resolved as broken.
- Inline dashboard panels are analyzed through their parent dashboard.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Leiter Consulting.
