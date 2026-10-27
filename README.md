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
- It stores scan results, review workflow records and retention policies only in
  app-local KV Store collections.
- Every finding carries reasons, evidence, and a suggested investigation step.

## Version 1.9.0 — bounded props patterns and default fallbacks

[Release 1.9.0, build 94](https://github.com/LeiterConsulting/splunk-content-hygiene/releases/tag/v1.9.0)
extends dependency investigations to a deliberately small props
pattern language: literal ASCII text, `*` within a path segment and `...` across
segments, matched against existing positive exact original-event selectors.
Explicitly captured shared `[default]` declarations remain visible as potential
fallbacks. No customer regex, search, field expression or lookup data is executed.

Explorer, relationship details and Review Library explain whether the scope is
literal, a supported bounded pattern, a default fallback or unsupported. Native
stanza observations and conditional same-attribute ordering retain every possible
path. Literal priority defaults to 100, pattern priority to 0; a captured default
never outranks a specific stanza. Candidate and character-work ceilings leave
unassessed paths unknown. No field-name joins across pattern/default scopes are
guessed.

`shared-static-v8` preserves existing decisions, journals and v1–v7 baselines.
Expanded evidence may request explicit re-review, never silently reaffirm a
decision. Full effective props, arbitrary PCRE/modifiers, escaped Windows paths,
encoded/non-ASCII scopes, private/system/file layers and runtime execution remain
outside this slice. Follow-up #8 remains open. See the
[pattern/default guide](docs/USER_GUIDE.md#bounded-props-patterns-and-defaults-19)
and [coverage matrix](docs/DEPENDENCY_COVERAGE.md).

![Qualified, wrapping props context in native Dark mode](docs/images/props-pattern-context-dark.jpg)

The native capture intentionally retains **Unverified** instead of inventing an
effective winner. [Light-mode context](docs/images/props-pattern-context-light.jpg).

Build 94 passes 1,024 automated checks and pre-cert AppInspect with zero
errors/failures. Native/cache/schema replay, all seven pages in Light/Dark,
103 accepted captures and 29 JSON / 27 paired CSV downloads cover Enterprise
10.2.5, 10.2.8 and 10.4.4. Original decisions, journals and appearance choices
are preserved; customer content remains read-only. Native catalogs include 24
supported pattern declarations but no positive pattern-caller or captured-default
witness. Those positives and props-specific Library cases have automated
contracts, not manufactured native content. Emulated readiness recoveries and
the bounded qualification are documented in the
[compatibility notes](docs/COMPATIBILITY.md#190-bounded-patterndefault-qualification).

## Version 1.8.0 — conditional cross-stanza props order

[Release 1.8.0, build 93](https://github.com/LeiterConsulting/splunk-content-hygiene/releases/tag/v1.8.0)
compares the same exact props attribute across captured shared literal stanzas
for one supported initial-search conjunction. It distinguishes conditional
highest/lower precedence from unverified context, explains source → host →
sourcetype ordering and same-category numeric priority/ASCII ties, and retains
every possible dependency path, including lower bindings as removal fallbacks.

Explorer, relationship context and Review Library reuse accessible, wrapping,
searchable, filtered and paginated details. The compact evidence travels through
freshness, impact, required-content reports and CSV/JSON. Checks run only during
explicit scans, reuse existing native reads and never execute customer searches
or regexes. Existing decisions, history and v1–v6 evidence baselines remain intact
under `shared-static-v7`; a scan never silently reaffirms a decision.

This is **not full effective-props evaluation**. Separate query branches are never
combined; patterns, defaults, private/system/file layers, runtime activation and
execution remain unverified. No ordering result establishes safe removal. See
the [cross-stanza investigation guide](docs/USER_GUIDE.md#conditional-cross-stanza-props-order-18)
and [coverage matrix](docs/DEPENDENCY_COVERAGE.md). Follow-up #8 remains open.

Build 93 passes 968 automated checks and pre-cert AppInspect with no
errors/failures. Fresh native/cache/schema comparisons, all seven pages in
Light/Dark, keyboard drill-through and 29 JSON / 27 paired CSV downloads cover
Enterprise 10.2.5, 10.2.8 and 10.4.4. Existing decisions and appearance choices
are preserved. Native catalogs contain no cross-stanza host/source collisions;
positive category/priority/ASCII ordering and props-specific Library cases have
automated contracts, not manufactured native witnesses. See the
[qualification and limits](docs/COMPATIBILITY.md#180-conditional-cross-stanza-qualification).

![Cross-stanza investigation in native Dark mode](docs/images/cross-stanza-context-dark.jpg)

This built-in-metadata capture deliberately shows an unverified comparison:
incomplete coverage does not become a highest-binding or safe-removal claim.
[Light-mode example](docs/images/cross-stanza-context-light.jpg).

## Version 1.7.0 — shared props precedence and inheritance

[Release 1.7.0, build 89](https://github.com/LeiterConsulting/splunk-content-hygiene/releases/tag/v1.7.0) cross-checks native rule-level ownership/export scope
against the merged value of the same exact props stanza/attribute. Explorer and
Review Library distinguish **local merged match**, **inherited merged match**,
**shadowed in this context**, and **unverified**, with reasons, filtering,
pagination and a drill-down to a different returned binding. Shadowed paths stay
in the graph as possible fallbacks after removal; no execution is inferred.

Checks run only during explicit inventory scans, not page navigation. Values are
compared transiently; only compact IDs, status/reason and digests are cached.
Read, byte, candidate, fan-out and wall-clock ceilings leave unassessed contexts
explicitly unknown. The same evidence travels through impact, required-content,
freshness and CSV/JSON. Existing decisions and v1–v5 baselines remain intact under
coverage policy `shared-static-v6`.

This is **not full effective-props evaluation**: user/private/system inheritance,
per-file local/default provenance, cross-stanza priority, runtime activation and
execution remain unverified. See the [props investigation guide](docs/USER_GUIDE.md#shared-props-precedence-and-inheritance)
and [coverage matrix](docs/DEPENDENCY_COVERAGE.md).

Build 89 passes 907 automated checks and pre-cert AppInspect with no
errors/failures. Fresh native catalog/cache/schema comparisons and all seven pages
in Light/Dark cover Enterprise 10.2.5, 10.2.8 and 10.4.4. Actual JSON/CSV exports,
original decisions, policy history and restored appearance preferences are
verified. See the [qualification and limits](docs/COMPATIBILITY.md#170-shared-props-qualification),
including automated-only shadowing and props-specific Library positives. Broader
dependency follow-up #8 remains open.

![Shared props relationship context in native Dark mode](docs/images/props-context-dark.jpg)

The capture uses built-in native metadata, not demonstration data or execution
evidence. Long context details wrap in a persistent, paginated disclosure.
[Light-mode example](docs/images/props-context-light.jpg).

## Version 1.6.0 — workflow and navigation dependencies

[Release 1.6.0, build 85](https://github.com/LeiterConsulting/splunk-content-hygiene/releases/tag/v1.6.0) adds shared **Workflow Action** and **Navigation Menu**
inventory, exact named view/report links and literal internal app/view routes.
Static workflow searches distinguish explicit namespaces from inherited runtime
contexts; app-scoped bindings are never guessed from the declaration app.
Field-token templates and dynamic menus remain unverified. Configured links are
not clicks or execution evidence.
External/POST links are never followed, and raw definitions are not cached.

Expanded coverage policy `shared-static-v5` preserves existing stages, notes,
assignees, history and v1–v4 evidence baselines. It can request explicit re-review;
a scan does not reaffirm a decision. A new complete scan is required to collect
the two catalogs. See the [interaction guide](docs/USER_GUIDE.md#workflow-actions-and-navigation-menus)
and [qualification and limits](docs/COMPATIBILITY.md#160-interaction-qualification).
The [coverage matrix](docs/DEPENDENCY_COVERAGE.md) separates collection, parsing,
resolution, configuration and execution evidence.

Evidence-heavy investigation reads use smaller pages without increasing request
timeouts or truncating the verified inventory.

Build 85 passes 862 automated checks, portable packaging and pre-cert AppInspect
with no errors/failures. Fresh native catalog/cache/schema checks and targeted
light/dark investigations cover Enterprise 10.2.5, 10.2.8 and 10.4.4, including
real menu-to-view removal impact, grouped report links and downloaded CSV/JSON.
Original decisions, policy history and appearance preferences are preserved.
Static workflow-search namespace positives also have synthetic contracts; native
examples do not cover every supported syntax. Full effective-props and dynamic
runtime closure remain unverified, so #8 remains open.

![Declared navigation relationship in native Dark mode](docs/images/navigation-context-dark.jpg)

The app's own menu is shown—not a demonstration dataset. Source locations,
exact destinations and configuration-versus-execution qualifications are retained.
[Light-mode example](docs/images/navigation-context-light.jpg).

## Version 1.5.0 — context accuracy and app retention

[Release 1.5.0, build 82](https://github.com/LeiterConsulting/splunk-content-hygiene/releases/tag/v1.5.0) adds explicit possible configuration contexts,
literal automatic-lookup OUTPUT/OUTPUTNEW/AS mappings, and independent exact-app
retention policies for current and future shared content. Individual decisions,
notes, assignees, baselines and history are not rewritten. Policy conflicts remain
visible; operator-only policy revisions are reversible and exportable.

Build 82 passes 775 automated checks, packaging and pre-cert
AppInspect with no errors/failures. Fresh read-only catalog/cache/schema checks,
seven-page Light/Dark smoke checks, detailed context/mapping checks and actual
report downloads cover Enterprise 10.2.5, 10.2.8 and 10.4.4. Native app-policy
saves, role denials, concurrent-edit conflicts, reversible lifecycle and history
exports also pass on all three runtimes. Existing individual decisions and user
appearance preferences are preserved. See the [qualification and limits](docs/COMPATIBILITY.md#150-context-and-policy-qualification).

Workflow actions and navigation menus remain outside the published 1.5.0 coverage;
version 1.6 adds a bounded subset. Full effective-props evaluation remains
unverified and follow-up #8 remains open. See [policy behavior](docs/USER_GUIDE.md#app-wide-retention-policies).

![Exact-app retention scope preview for Content Hygiene's own shared content](docs/images/app-policy-scope-light.jpg)

The native Light-mode preview distinguishes policy protection from individual
decisions. The object count is an example from installed content, not a fixed
scope or a demonstration dataset.

## Version 1.4.0 — declared extraction outputs

[Release 1.4.0, build 79](https://github.com/LeiterConsulting/splunk-content-hygiene/releases/tag/v1.4.0) adds bounded, names-only attribution for inline `EXTRACT-*`
captures and unambiguous search-time transform `REGEX`, literal `FORMAT` and
`DELIMS`/`FIELDS` declarations. Existing Explorer/Library details expose expandable
source locations, capture numbers and declared inputs without caching patterns
or event values. This is declared provenance, not regex execution or field
availability. Unsupported/dynamic cases remain explicit gaps.

New scans use coverage policy `shared-static-v4`; v1/v2/v3 decisions and captured
baselines remain readable and unchanged. A scan never reaffirms a decision.
Build 79 passes 680 automated checks and pre-cert AppInspect with zero
errors/failures, three reviewed warnings and one manifest skip. Native catalog/
cache and schema comparisons, targeted Light/Dark checks and 22 actual report
downloads cover Enterprise 10.2.5, 10.2.8 and 10.4.4. Original review records and
captured baselines remain unchanged. See the [qualification and limits](docs/COMPATIBILITY.md#140-extraction-output-qualification),
including emulated-VM cold-load timeouts and bounded native Library coverage.

## Version 1.3.0 — dependency accuracy

[Release 1.3.0, build 77](https://github.com/LeiterConsulting/splunk-content-hygiene/releases/tag/v1.3.0) adds shared
**Event Type** and **Tag Binding** inventory, literal inclusion/exclusion filters,
namespace-aware resolution and explicit uncertainty through investigations,
required-content reports, review freshness and CSV/JSON. Existing decisions and
their captured evidence are preserved; a coverage-policy expansion can require
explicit re-review, not automatic reaffirmation.

The bounded field-lineage increment inventories shared **Field Extraction**, **Field
Alias**, **Calculated Field** and **Field Transform** definitions. Ordered REPORT
bindings, declared field-input paths and exact event-scope callers are explicitly
potential. Existing object details show field names, phases and provenance;
reports retain the same qualifications. Customer SPL, expressions and PCRE are
never executed to infer lineage, and raw declaration bodies are not cached.

Release **build 77** passes 588 automated checks, packaging and pre-cert
AppInspect with no errors or failures (three reviewed warnings). Fresh native scans and catalog/cache
comparisons cover Enterprise **10.2.5, 10.2.8 and 10.4.4**; targeted light/dark
checks cover field facts, wrapped graph/context details and the existing review
workflow. Real CSV/JSON retains potential-path provenance and partial coverage.
Saved decisions and evidence baselines remain unchanged. Earlier candidates
73/74 qualify event/tag coverage only; they do not contain installed field coverage.
See the [compatibility scope](docs/COMPATIBILITY.md#130-dependency-accuracy-qualification)
and [field-lineage investigation guide](docs/USER_GUIDE.md#declared-field-lineage).

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
- Native automatic-lookup rule inventory, configured lookup-definition/file
  chains, and explicitly potential caller links from exact event selectors
- Shared event-type/tag inventory and bounded declared extraction, alias,
  calculated-field and transform lineage, with exact identities and provenance
- Shared workflow/navigation inventory and bounded declared internal targets,
  with source locations, exact app resolution and explicit runtime uncertainty
- A persistent Review Library with triage, investigation, owner-confirmation,
  eligibility, retain, and blocked stages, with independent review-evidence
  validity, scoped coverage, change explanations, explicit reaffirmation,
  conflict-safe saves, recoverable archiving, revision history, and evidence exports
- Independent exact-app retention policies for current and future shared objects,
  with explicit scope confirmation, operator-only coordinated revisions,
  preserved individual decisions, recoverable lifecycle and history exports
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

The complete scan inventories installed apps, saved searches, dashboards, macros,
event types, tag bindings, workflow actions, navigation menus, field extractions, aliases, calculated fields,
field transforms, automatic lookup rules, lookup definitions and files,
data models, indexes, sourcetypes, and users visible to the initiating Splunk user.
Private objects are excluded from
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

The support baseline is Splunk Enterprise **10.2.5 or later** on a standalone
Linux x86-64 search head with KV Store. Release 1.7.0 **build 89** has
real-data qualification on **10.2.5, 10.2.8 and 10.4.4**: fresh bounded/full scans,
native catalog/cache and schema comparisons, all seven pages in Light/Dark,
shared-props investigations, required-content and removal-impact exports, and the existing
Review Library. Saved decisions, policy journals and evidence baselines are
preserved. Broader backend permission/concurrency and native policy
lifecycle evidence from 1.5.0 remains separately documented. This is bounded static
coverage, not execution telemetry or a large-estate benchmark.

Release 1.2.0 (build 72) adds wrapped labels, opaque
relationship surfaces, hover/focus previews and full-context dialogs. Targeted
real-data UI checks cover Enterprise 10.2.8 and 10.4.4 in both themes. The minimum
runtime evidence above is distinct from these final UI checks; see the exact
qualification scope in the compatibility policy below.

App 1.1.1 build 67 retains its broader qualification on
10.2.5, 10.2.8 and 10.4.4: all seven pages in light/dark modes, real-data scans,
filter recovery and preservation of existing decisions. Targeted native-browser
checks include actual 200% zoom, keyboard review/draft flows and operator-assisted
VoiceOver announcements. These are bounded checks, not accessibility certification.
Classic/modern navigation and native launcher icons retain their earlier runtime
qualification. Maintenance patches do not each require separate release
qualification without a known regression. See the
[compatibility policy](docs/COMPATIBILITY.md)
for the tested matrix and deployment boundaries, and
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

After upgrading to 1.5, run a complete scan to collect output mappings, possible
configuration contexts, output attribution and the expanded shared event/tag and
field catalogs alongside automatic lookup rules. Follow configured
definitions and declared field paths in Explorer. **May apply**, **may read** and
**may use** links remain explicitly potential through
multi-hop reports, impact explanations and exports. New evidence may require
re-review; the scan does not change your saved decision or reaffirm its baseline.

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
- [Compatibility and minimum-version policy](docs/COMPATIBILITY.md)
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
`app/dist/content_hygiene-<VERSION>.tar.gz` (currently 1.7.0, build 89).
Run `yarn release:prepare` to
perform the complete validation and update `SHA256SUMS`.

## Current limitations

- The required-content report is a partial shared static footprint, not a complete
  migration manifest. Automatic lookup callers are possible exact event-scope
  matches, not observed use. Pattern scopes, other implicit props, uninventoried
  types, private/dynamic content and ad-hoc consumers remain explicit gaps. See
  [automatic lookup investigations](docs/USER_GUIDE.md#automatic-lookups-and-implicit-props).
- Declared field-lineage paths do not establish effective values or runtime
  use. Capture attribution is a bounded names-only subset, not PCRE compilation
  or matching. Unsupported/dynamic outputs and expressions, cross-scope
  precedence, alias chaining and EVAL-to-EVAL chaining remain unverified.
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
