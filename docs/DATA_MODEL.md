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

Evidence version 2 records policy `shared-static-v1` and four independently
fingerprinted coverage dimensions: returned configuration, returned ACL,
declared outbound references, and potential inbound references. Each includes
status, bounded reasons, a source count, and at most five visible possible-source
examples. Private-source gaps retain aggregate app/type counts, not private
object names or owners. Static parser gaps are scoped by namespace and possible
target type/name; missing source catalogs propagate conservatively. Data-model
base searches, constraints, lookup calculations, and inherited query scope are
analyzed. Boolean branches and independent subsearches must establish their own
positive index scope. A possible source is not an asserted dependency.

The 1.3 event-type/tag milestone introduced `shared-static-v2`; the
field-lineage increment generates `shared-static-v3`. The 1.4 development
increment generates `shared-static-v4` while retaining read support for v1/v2/v3
baselines. A policy expansion
requires explicit re-review, not migration of saved decisions or evidence. The
evidence schema accepts every supported policy and rejects no historical record
merely because the current scanner uses the newer policy.

Event Type identities use their exact native name and app namespace. Tag Binding
canonical names encode `[nativeFieldValueStanza, tagName]` as a JSON array; display
names are not identity keys. Disabled assignments remain separate records.
URI-like values remain verbatim and do not become guessed decoded identities.
Raw event-type SPL is used transiently for bounded parsing and fingerprinting,
not retained as a shared-cache definition body.

Field Extraction, Field Alias, Calculated Field and Field Transform identities
retain their exact native name/app namespace. Optional `field_lineage` stores only
versioned, fixed-key facts: operation, props stanza/attribute, exact-or-unverified
scope, nullable enabled state, literal input/output names, AS/ASNEW assignments,
ordered REPORT names, syntax status, provenance and limitations. Names remain
values, never dotted/dollar-prefixed KV keys. Raw declaration bodies are hashed
transiently and are not retained. See [field metadata schema](../schemas/field-lineage.schema.json).

Optional `outputProvenance` version 1 stores the attribution method, declared
source field/origin, recognized capture count and at most 250 output declarations.
Each has a literal field name, nullable one-based capture number, zero-based
UTF-16 offset and native attribute (`value`, `REGEX`, `FORMAT`, `FIELDS`). Repeated
capture/mapping positions remain distinct. These are source locations, not
event offsets or field values. Old facts without this optional metadata remain
readable; the scan's `field_lineage` collector version requests recollection.
Ambiguous literal FORMAT/FIELDS names may remain visible without attribution;
such partial names are not producer evidence.

Configuration fingerprint version 2 uses locale-independent canonical ordering.
Different normalization versions are not direct proof of a configuration edit.
Legacy evidence is retained and remains unverified until a supported scan and
explicit reaffirmation. An object's supported static scope can be complete while
the overall scan remains partial; this does not relax removal-impact blockers.

Supported health values are `active`, `dormant`, `orphaned`, `broken`,
`unowned`, `protected`, and `unknown`.

Shared props observations (1.7) are optional `propsContexts` arrays in field facts
and relationship provenance. Each fixed-key row contains version, object ID,
qualified app, status, selected shared object ID or null, value digest or null,
and a fixed reason code. `propsContextsTruncated` is explicit. No raw native
attribute value, expression, regex, source-file provenance path or private
identity is stored. Configured literal event selectors can contain a path-like
name; retaining that declaration does not read the filesystem or sample events. The
`props_precedence` collector version is 1.0.0; scan parser counters distinguish
checked contexts, native reads, local/inherited/shadowed/unverified rows and
truncation. Coverage policy `shared-static-v6` hashes context evidence, including
for an otherwise unconnected props object. Earlier v1–v5 baselines stay readable
and immutable; a scan does not reaffirm a review.

Conditional cross-stanza observations (1.8) add optional `crossStanzaProps`
arrays and explicit `crossStanzaPropsTruncated` flags to field facts and
relationship provenance. A versioned row contains the props object and caller
IDs, invoking app, exact attribute, original query location, a supported literal
selector conjunction, status (`highest`, `lower`, `unverified`), fixed reason,
selected captured object ID or null, comparison member IDs and numeric priorities
or null. `stanzaPriority` is also an optional native shared-context projection;
omitted/empty native priority uses the documented literal default of 100.
Unsupported priority remains null. No raw SPL or native props value is cached.

The scan-only comparison has ceilings of 100,000 indexed visits, 10,000 groups,
16 members per group, five seconds and 50,000 stored projections. Each object or
edge retains at most 32 rows / 32 KiB of cross-stanza evidence. Unknown syntax,
incomplete catalogs, uncertain bindings/case and work ceilings remain explicit;
unrelated selectors or query branches are never combined. Native props read
counts and customer permissions are unchanged. The collector marker is
`props_cross_stanza: 1.0.0`; parser counters distinguish groups, visits, statuses
and truncation. Coverage policy `shared-static-v7` includes this evidence in
object-scoped freshness. Saved v1–v6 baselines remain readable and immutable.
Conditional order never removes an edge, increases confidence, proves execution
or clears a removal blocker; a lower binding remains a possible fallback.

The 1.9 extension retains the same compact schemas and exact native identities.
`scope.exact` stays false for patterns/defaults; it is never relabeled literal.
The bounded support classifier derives literal / `*` / `...` pattern / captured
default / unsupported from the stanza metadata. No customer regex is compiled,
and no raw attribute values or events are cached. Potential event-scope edges
retain the actual positive exact caller selector and its original query location.
Pattern/default producer joins are not inferred. Default category is below any
specific stanza; missing literal/pattern priorities use 100/0 respectively.
The scan marker is `props_patterns: 1.0.0`, with `props_scope_*` counters and
separate bounded character-work limits. `shared-static-v8` expands freshness
without rewriting v1–v7 baselines, stages, notes, assignees or journals.

## Caller-context diagnostic facts (1.15)

Optional `ch_objects.caller_context` uses the
[`CallerContextSummary` contract](../schemas/caller-context.schema.json#/$defs/summary).
Only shared Saved Search/Report/Alert/Dashboard records receive these scan-time
facts. The independent `caller_context_diagnostics: 1.0.0` scan marker does not
change `shared-static-v10`, receipt identities or review-baseline protocols.

Each row stores query location, exact-text digest, retained/withheld/excluded
outcome, first-rejection code/offset, observed syntax feature codes and a selector
mention flag. Raw SPL, selector values, macro names/bodies and private identities
are not copied into these facts. Counts describe extracted query occurrences,
not every potential consumer. `limited` and `sourceIncomplete` distinguish
detail truncation from extraction uncertainty; `state` distinguishes recorded,
unavailable and scan-budget omissions. Missing/invalid/unknown-version cached
facts remain unavailable, never a positive coverage conclusion.

Retention is bounded to 64 rows / 64 KiB UTF-8 per source object and 8 MiB detailed
facts per scan; after that, small count/limit markers remain. Summary pages omit
these downloads. Dedicated CSV/JSON exports attach current cached identity,
scan/configuration provenance and limitations; zero-row/absent data are explicit.
These diagnostics do not contribute to coverage hashes, scoring, edge resolution,
readiness or saved decisions. A fresh scan can still detect genuine source edits
through the unchanged configuration/dependency evidence process.

## Edges

Version 1.14 adds an on-demand, client-derived
[`PathInvestigation`](../schemas/path-investigation.schema.json) export. It records
one ordered endpoint pair, the original witness and up to three alternatives,
exact ordered object/edge identities, per-path context, relationship provenance,
search ceilings, diagnostics and uncertainty. It is not saved to KV Store and
does not change any review baseline, confidence, blocker or coverage version.
Review Library now reads and integrity-checks cached edges as well as objects;
summary-only pages still omit graph downloads. A missing or incomplete graph is
a load error, not a verified empty investigation.

Version 1.12 derives `pathContext` in investigation outputs, not KV/review records.
It contains `version`, `status`, directed/scoped hop counts, intersected `apps`,
common exact `callerWitnesses`, reason codes and up to eight uncertain-hop
examples (`edgeId`, `sourceId`, `targetId`, `reason`). Required-content stores it
under the chosen row's `via`; impact stores it beside ordered `pathEdgeIds`;
graph nodes expose one center-relative witness. Direct relationship exports
annotate one edge, not a transitive or grouped union. Work/size diagnostics are
included in required-content and impact JSON. No cached edge, original baseline,
collector version or coverage-policy migration is performed. Only explicitly
fixed invocation constrains `apps`; owning-app metadata for unverified reusable
invocation remains unknown and cannot establish an app mismatch.

Version 1.11 adds `captured_conjunction` to the optional compatibility basis.
It requires `callerWitnesses`: bounded original-event receipts with
`callerObjectId`, `app`, `sourceLocation` and two or three distinct literal
`selectors` (field, value, sourceLocation). The declarations must have different
non-default dimensions, with both matched by one strict original query in that
app. `invocation=fixed_app` identifies the captured caller context, not execution.
Independent queries/selectors are never unioned. Readers validate compact shape,
scope/app consistency and caps without re-parsing searches on page load; unknown
receipt properties are dropped. No full query, expression, regex or sampled event value
is cached in a receipt. Old receipts remain readable.

Caller indexes cap 50,000 declarations, scopes and projections, 5,000 candidate
visits per query / 100,000 per scan and 2 million / 20 million pattern-work cells.
Each declaration/edge retains at most 32 receipts / 32 KiB; separate 16 MiB scan
ceilings bound index and edge receipts. Rejected candidates count as visits;
deduplication does not bypass budgets. Diagnostic byte counts are charged receipt
work, not the total size of the KV collections. Exhaustion propagates as gaps.
New scans record `field_lineage=1.4.0`, `props_callers=1.0.0` and
`shared-static-v10`; v1–v9 decisions/baselines/journals are not rewritten.

Version 1.10 adds optional `fieldProvenance.scopeCompatibility` to `field_input`
edges: version 1, exact `consumer` and `producer` scope projections and `basis`
(`same_literal`, `bounded_intersection`, `captured_default`). It contains no
generated event witness, sampled value, expression or regex execution result.
Old edges without it remain readable. Native identities and original
`scope.exact` flags do not change; both pattern scopes remain non-literal.
The compact receipt is validated on cache read without repeating the product
automaton or reconstructing the graph. Existing provenance/export/freshness
digests include it. New scans record `props_domains: 1.0.0`, field lineage 1.3.0,
dependency analysis 1.10.0 and `props_domain_*` edge counters.
`shared-static-v9` retains all v1–v8 baseline readers and does not write reviews,
review revisions or app-policy revisions.

An edge points from a source object to a target identity and records relation,
confidence, evidence, source location, resolution state, and scan provenance.
Unresolved targets remain valuable evidence and are not discarded.
`uses_file` connects a lookup definition to its configured backing file;
`belongs_to` points from app-scoped content to its containing app. These are
configuration relationships, not observed executions.

Automatic Lookup objects use their native props rule identity and app namespace,
not a generated sourcetype identity. `uses_lookup` records a configured rule's
literal lookup definition. `may_apply_automatic_lookup` records a possible
event-selector caller; `may_use_lookup` records a possible exported-rule binding
in another invoking app. These `may_*` relations never prove execution or a
broken target. There is no broad sourcetype-to-rule join across app namespaces.

Field relations are explicitly potential: `may_use_field_transform` retains
ordered REPORT positions; `may_read_extracted_field`, `may_read_aliased_field` and
`may_read_calculated_field` record phase-qualified declared inputs;
`may_apply_field_extraction`, `may_apply_field_alias` and
`may_apply_calculated_field` record positive exact event-scope witnesses.
Optional `field_provenance` retains fields, scope, consumer/producer phases,
one-based REPORT positions, intermediate transform IDs and possible app contexts.
Optional `outputDeclarations` additionally identifies the exact producer object,
attribution method and matching declaration positions for extraction-input paths.
These facts are hashed with relationship evidence so changed provenance can
require re-review. Required-content and impact exports retain them and propagate
potential status/weakest confidence. No synthetic field object or runtime value
is manufactured, and no EVAL-to-EVAL or alias-to-alias chain is inferred.

Derived report witnesses include `conditional: true` if any relationship in their
chosen path is potential, including later lookup-definition/file hops. This flag
and the weakest path confidence are preserved in CSV/JSON; the original edge
relation remains the authoritative configuration-vs-potential distinction.
No review migration or rewrite is performed when the catalog expands.

Version 1.5 adds optional `lookupMapping` facts: literal lookup/event field pairs,
one-based declaration positions and OUTPUT/OUTPUTNEW/implicit output mode. It
never stores lookup rows or effective values. Optional relationship `contexts`
retain declaring/dependency/invoking namespaces, candidate status and original
exact selector witnesses. The strict projector accepts older facts without these
extensions, but new context/output collection requires a fresh complete scan.

## App-wide retention policy revisions

`ch_app_policy_revisions` is independent of review decisions and scan retention.
See [the policy revision schema](../schemas/app-policy-revision.schema.json).
Each immutable revision has a deterministic app/sequence key, expected parent,
exact app identity, Active/Disabled/Archived state, reason, confirmed preview scan,
combined app configuration/ACL fingerprint, request ID, and server actor/time.
The existing standalone coordinator serializes append checks; it never rewrites
individual stages, notes, assignees or baselines. Complete consistent keyset reads
validate every policy lineage before deriving protection.

Policy-derived retention is evaluated against current shared inventory, not
persisted onto individual objects or reviews. Exact unchanged app scope can
protect future shared objects; missing/changed scope remains unverified and blocks
cleanup without fabricating verified roots. Other app identities never inherit
the policy. Same-name physical reinstalls may be indistinguishable. Disabled or
archived heads stop policy effects while preserving history. Reports carry policy
reasons separately from observed activity, individual Retain and impact scores.

The 1.3 named relations include `matches_event_type`,
`excludes_event_type`, `matches_tag`, `excludes_tag` and `tags_event_type`.
Their conditional counterparts use `may_match_*`, `may_exclude_*` and
`may_tag_event_type`. Exclusions retain their polarity; they are dependencies,
not evidence that an object is unnecessary. Reusable exported definitions do
not acquire a guessed owning-app invocation context.

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

The 1.3 scan format separates `collector_counts` (normalized records),
`collector_totals` (visible native entries) and optional `collector_native_counts`
(native entries actually returned). A tag stanza can produce several normalized
assignments. Missing native-entry counts in old snapshots mean unavailable, not
zero. Inventory completeness, source parsing and target resolution remain
separate gates.

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

A review is durable, app-local workflow state associated with object identity. It contains
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
separate. Legacy fields remain in `ch_reviews`, independent of snapshot retirement.
New writes use the version 1 revision protocol in `ch_review_revisions`.

Each accepted revision has a deterministic SHA-256 key for canonical object ID
and sequence number, a parent identity, request identity, operation, compact
decision snapshot, and evidence references. A server coordinator serializes and
rechecks inserts so one successor wins concurrent creates, edits, or save/archive races. The loser
retains its local draft. An uncertain response is read back by key/request ID;
writes are never automatically replayed. Sequence order does not rely on client
clocks. New revision reviewer/time metadata is server-assigned; retained legacy
metadata is not retroactively rewritten. KV uniqueness alone is not relied on
as an atomic compare-and-swap operation.

The first edit of a legacy review retains its exact original document and
origin digest. Subsequent outside changes to that origin block new edits. Missing
revisions or evidence references fail closed. Archive is a tombstone revision;
restoring retains the decision and original at-review facts. Normal edits preserve
baselines. Explicit reaffirmation changes only evidence, never stage, note, or
assignee simultaneously. Captures are stored once and referenced by later
revisions. History is retained independently of scan retirement and is not a
tamper-proof audit against direct privileged KV changes.

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

Consumer follow-ups separate `knownDependentCount` (configured relationships)
from `potentialDependentCount` (additional possible implicit callers). A
potential-only relationship is not an orphaning conclusion; its applicability
must be verified independently. Readiness and recommendations remain conservative.
