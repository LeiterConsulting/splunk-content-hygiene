# Changelog

## 1.0.1 — 2026-10-23

- Replaced narrow, internally scrolling detail sidebars with full-width
  investigation workspaces in Review Library, Cleanup Candidates, Dependency
  Explorer, and Ownership
- Moved dependency exploration and related investigation actions to selected
  object headers; added explicit list/detail navigation with retained filters,
  previous/next records, stable object links, and keyboard focus management
- Separated review decisions, evidence/changes, object details, and revision
  history into native Splunk tabs without resetting drafts when switching tabs
- Added unsaved-draft protection for object changes, drill-through, app links,
  and browser navigation, plus explicit recoverable archive confirmation
- Grouped exports into context-labeled native menus with explicit data scope and
  format; corrected ownership export labels to match their actual scope
- Removed floating-overlay shadows from static cards, kept themed controls and
  responsive layouts, and made partial/failed scan status visually distinct with
  a direct path to scan details
- Restored native primary-action styling through the shared button adapter,
  clarified current shared ownership versus saved owner metadata, and kept
  list navigation actions distinct from toggle/checkbox controls
- Kept an always-visible historical-context warning for retained reviews whose
  objects are no longer observed; saved health and ownership never masquerade
  as current inventory evidence
- Preserved existing decisions, coverage semantics, review coordination, and
  the read-only customer-content boundary; no data migration is required

## 1.0.0 — 2026-10-23

- Split review coverage into returned configuration, returned ACL, declared
  outbound references, and potential inbound references, with scoped reasons
  and drill-through to visible possible sources
- Scoped static uncertainty by app, target type, and known name; retained
  conservative missing-catalog/private-source gaps without publishing private
  source identities
- Expanded data-model parsing to base searches, constraints, inherited query
  scope, lookup calculations, and eval lookups; verified boolean/subsearch index
  scope rather than treating every positive index token as a complete guard
- Versioned locale-independent fingerprints and retained legacy evidence without
  labeling a normalization upgrade as a definite configuration edit
- Added a standalone POSIX server coordinator for app-local review inserts,
  with authenticated role/capability checks, interprocess serialization,
  server-assigned reviewer/time metadata, and stale-parent rejection
- Preserved legacy decisions unchanged and added an insert-only revision journal,
  capture references, explicit draft reconciliation, recoverable archive/restore,
  paged history, and revision/coverage exports
- Added fail-closed handling for missing/inconsistent history, changed legacy
  origins, scan errors, and missing captures; no scan or reaffirmation silently
  changes a saved decision
- Updated upgrade, backup, security, troubleshooting, and deployment guidance;
  customer knowledge objects remain read-only

## 0.5.0-beta — 2026-10-23

- Added independent Current / Needs re-review / Cannot verify evidence states
  without rewriting saved stages, notes, or original at-review facts
- Added versioned SHA-256 configuration/access and full direct-neighborhood
  fingerprints, with bounded durable review manifests independent of scan retention
- Added Library evidence-status filters, Explorer Changes since review,
  relationship change drill-downs, explicit capture/reaffirmation, and CSV/JSON exports
- Made changed, legacy, or unverifiable confirmations insufficient for removal
  planning; retained full unfiltered impact calculations and conservative coverage gates
- Added known concurrent-edit rejection and retained first/recent capture history
- Qualified the native entry script by app build so upgrades load the matching
  shell without a server-wide static-cache refresh
- Used the supported macro configuration endpoint and normalized equivalent
  macro booleans and read-generated data-model editor IDs to avoid false drift

## 0.4.0-beta — 2026-10-23

- Added original vector-derived launcher/wordmark graphics, documented classic
  icon placements, and semantic Splunk 10.4-compatible navigation icons
- Verified native launcher delivery and light/dark browser behavior on 10.2.8
  and 10.4.4; documented stale native asset-cache troubleshooting
- Migrated custom Mako pages to native Simple XML hosts, with explicit
  cache-busted chunk paths and AMD-aware native theme loading
- Removed the empty dashboard-header band without hiding native navigation
- Preserved readable identifier columns with native in-card table scrolling
- Corrected candidate searches for pasted underscore/hyphen object names
- Scoped host input-style corrections to the app's portal-rendered dropdown
  filters, including readable empty placeholders in dark mode
- Corrected implicit/parenthesized SPL filters, static `IN` lists, and exclusions
  to prevent missed dependencies and punctuation-suffixed phantom targets
- Added verified immutable snapshots, retained complete baselines, cancellation,
  bounded REST timeouts, indexed KV queries, and derived-evidence retention
- Corrected SPL/Studio parsing, macro arity, namespace resolution, stable
  saved-search review identity, and lookup-file/app-containment relationships
- Unified current versus historical/modified/expired usage evidence and exports
- Replaced custom controls with Splunk React UI controls and readable semantic
  theme colors; corrected shrinking layouts and empty-filter recovery
- Rebuilt dependency exploration around grouped directional neighborhoods,
  keyboard-operable inspection/expansion, bounded tables, and an impact tab
- Restricted shared metadata to explicit hygiene roles and excluded private
  objects; existing reviews remain durable and customer content stays read-only
- Added deferred page chunks, page-specific downloads, formula-safe CSV,
  regression and scale tests, and upgrade/operator documentation

## 0.3.0-beta — 2026-07-28

- Added bounded, on-demand 30/90/180-day usage-evidence windows for directly
  attributable saved-search executions and dashboard access
- Added complete/partial/unavailable source coverage so missing telemetry is
  never represented as inactivity
- Integrated usage evidence into candidate classification, confidence, filters,
  dependency exploration, removal readiness, review snapshots, reporting, and
  exports
- Added private-namespace attribution safeguards, stale-evidence protections,
  outcome counts, provenance, and app-local `ch_usage_evidence` persistence
- Kept all customer content read-only and excluded raw user SPL and actor lists
  from persisted evidence

## 0.2.1-beta — 2026-07-28

- Made the Overview live-inventory tile searchable and sortable by app name,
  object count, or health percentage
- Added 5/10/25-row pagination across every live app plus expandable exact
  health counts while preserving app-filtered candidate drill-through

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
