# Changelog

## 0.2.0-beta — 2026-07-28

- Added a read-only removal-impact simulation with configurable transitive
  depth, direct and cascading blast-radius paths, protected/unresolved blockers,
  cross-app consequences, orphan follow-ups, and type-specific removal guidance
- Added CSV/JSON impact reports and drill-through actions for affected objects
- Required the packaged app license and hardened build wrappers to propagate
  failed production builds
- Verified build 17 against a complete live Splunk snapshot with no collector
  warnings or browser-console errors

## 0.1.0-beta — 2026-07-24

- Added the installable `content_hygiene` Splunk application
- Added Overview, Cleanup Candidates, Dependency Explorer, Ownership, and Settings views
- Added evidence-first candidate filtering, detail inspection, and CSV exports
- Added directional dependency visualization and ownership reporting
- Added application-owned KV Store collection and lookup definitions
- Added a bounded live inventory for apps, saved searches, dashboards, macros, lookup definitions, and owners
- Added KV-backed scan lifecycle, per-collector checkpoints, recoverable scan locking, and partial-result warnings
- Added persisted live-scan status and cached-versus-visible collector counts to Settings
- Removed the packaged demonstration snapshot and connected every view to the latest live KV Store snapshot
- Added explicit pending and empty states so missing analysis is never represented as a clean bill of health
- Added a package guard that rejects production demo-snapshot markers
- Added tests, linting, TypeScript checks, packaging, and package verification
- Completed AppInspect pre-cert with no failures
- Installed and browser smoke-tested the package on Splunk Enterprise 10.0.1
- Added a paginated complete live scan with a 10,000-record per-collector safety cap
- Added lookup-file, data-model, index, and sourcetype collectors
- Added real SPL and dashboard dependency extraction with namespace-aware resolution
- Added conservative classification and persisted repair, ownership, and review findings
- Added candidate sorting, cached pagination, and JSON export
- Distinguished app/global sharing from genuine user-scoped ownership gaps
- Prevented wildcard and non-authoritative sourcetype absence from producing broken findings
- Ignored command-like text inside SPL string literals during dependency extraction
- Added user namespaces to private-object identities so same-name copies cannot overwrite one another
- Kept scheduled background execution and usage-history correlation for a later milestone
- Added a persistent app-local Review Library with six confirmation stages,
  investigation notes, assignees, updater attribution, and scan provenance
- Added candidate and dependency filtering by cleanup group or review stage
- Added multi-step dependency drill-through, relationship evidence tables, and
  exact cross-view object links
- Added CSV/JSON exports for review library, dependency relationships,
  environment summaries, ownership reports, and scan reports
- Preserved review records when an object is no longer visible in the latest
  inventory and explicitly separated workflow writes from customer content
- Added public installation, administration, user, architecture, data-model,
  development, security, support, and release documentation
- Added GitHub Actions validation for the locked Node.js 22 toolchain
- Changed the release artifact to `.tar.gz` and hardened packaging against
  `.DS_Store`, AppleDouble, and `__MACOSX` metadata
- Licensed the source and release package under the MIT License
## 0.1.0-beta-planning — 2026-07-24

- Initial product brief and beta requirements
- Architecture and normalized schemas
- Dependency and scoring specifications
- AppInspect/security guardrails
- UX mockups and view specifications
- Codex implementation prompts and acceptance criteria
- Conservative Splunk app directory skeleton
