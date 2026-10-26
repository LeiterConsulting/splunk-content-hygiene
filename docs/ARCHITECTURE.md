# Architecture

Splunk Content Hygiene is a client-driven Splunk UI Toolkit application. It
uses the current Splunk Web session to call supported Splunk REST endpoints,
normalizes visible content, analyzes explicit and bounded potential dependencies, and persists the
result in app-local KV Store collections.

```text
Splunk REST resources                     Native Splunk telemetry
        |                                          |
        v                                          v
bounded/paginated inventory collectors    bounded usage searches
        |                                          |
        v                                          v
normalization + dependency analysis       coverage + attribution
        |                                          |
        +--------------------+---------------------+
                             |
                             v
                  app-local KV Store evidence
                             |
                             v
       Overview / Candidates / Dependencies / Reviews / Ownership / Settings
```

## Runtime boundaries

- Scans are explicit and run in the initiating browser session.
- Inventory and usage remain browser-driven. One authenticated app-local Python
  endpoint coordinates review inserts; there is no external service.
- Production views read only the latest persisted live snapshot.
- End-user writes are limited to app-local inventory, usage-evidence, lifecycle,
  and `ch_review_revisions` workflow state. Legacy `ch_reviews` records are read
  and preserved, not rewritten.
- Customer knowledge objects are never deleted, disabled, reassigned, or
  rewritten.
- The packaged Simple XML hosts reference a build-qualified entry script;
  deferred chunks are content-hashed. This keeps app upgrades independent of
  server-wide static-cache refreshes and avoids mixing old shells with new chunks.
- Usage collection creates only bounded, on-demand search jobs and persists
  derived evidence in app-local KV Store; it never dispatches the inventoried
  saved search or dashboard itself.

## Inventory

Collectors query apps, saved searches, dashboards, macros, lookup definitions,
lookup files, automatic lookup rules, data models, indexes, sourcetypes, and users. Bounded mode limits
each content collector to 100 records. Complete mode requests 200 records per
page and stops at 10,000 records per collector, marking the result incomplete
when the visible total exceeds that cap.

Logical object identities incorporate resource family, app namespace, and name.
Saved Search, Report, and Alert share one saved-search identity so schedule
changes do not detach reviews. Snapshot storage keys additionally include the
scan ID. Private user-namespace objects are excluded from the shared cache.

## Dependency analysis

The parser recognizes explicit saved-search references in dashboards and
static references in SPL to macros, lookups, saved searches, data models,
indexes, and sourcetypes. It preserves direction, relation, confidence,
evidence, source location, resolution state, and scan provenance.

Dynamic or wildcard names are not declared broken. Command-like text inside SPL
string literals is ignored. An absent sourcetype is not treated as proof of a
broken reference because the visible catalog may not be authoritative.

The lexer preserves quoted strings, comments, command context, subsearches, and
macro argument counts. Dashboard JSON is parsed before extracting queries;
Simple XML uses structured elements. Unsupported and malformed sources retain
per-object diagnostics. Exact-name indexes apply same-app and global-export
visibility rules rather than guessing at foreign app-scoped targets. Explicit
lookup-filename and app-membership relationships use `uses_file` and `belongs_to`.

### Automatic lookups and implicit props

The paginated native `data/props/lookups` GET catalog supplies `LOOKUP-*` rule
identities, ACL namespace, stanza and canonical transform name. Returned rule
fields are fingerprinted before the raw declaration is discarded. No customer
SPL is dispatched and no arbitrary props file or filesystem is read. The
canonical transform is checked against the returned declaration; malformed or
dynamic values remain gaps rather than guessed broken dependencies.

Rules bind to lookup definitions (`uses_lookup`), which retain their existing
configured file edges. A namespace/scope index matches positive exact
`sourcetype`, `host` or `source` event selectors in saved searches and dashboard
base searches. Ordinary SPL field-value filters compare case-insensitively;
matching includes possible case variants while retaining each original props
identity. CASE/TERM directives remain unverified. Selectors after a transform or unexpanded
macro, negative/wildcard filters, non-event generators and dashboard post-process
queries are not treated as original event scope. Macro/data-model invocation
contexts are disclosed rather than assigned their definition app.

`may_apply_automatic_lookup` and exported-rule `may_use_lookup` bindings are
potential configuration possibilities, not execution telemetry. Same-app and
global visibility resolution retains ambiguity/private-shadow protections.
Exported rules can bind differently in another invoking app; alternative visible
definition contexts remain potential and no missing originating-app definition
alone proves the exported rule broken.

Matching is capped at 250 inferred edges per source and 50,000 per scan, with
explicit gaps when capped. Customer regex is not executed: pattern props stanzas,
precedence, sourcetype renames, inherited scopes and input-field availability
remain unverified. Other props families and uninventoried source types remain
separate coverage limitations. Collection, parsing and resolution stay distinct.

Potential status and weakest path confidence propagate through multi-hop
required-content and removal-impact witnesses, UI details and CSV/JSON exports.
New catalog/configuration/adjacency evidence can change review validity, never
the stored stage, note, assignee or evidence baseline. Existing snapshots remain
readable; run a complete scan after upgrading to collect the new catalog.

The source contracts are documented in Splunk's
[knowledge REST endpoint reference](https://help.splunk.com/en/splunk-enterprise/rest-api-reference/9.4/knowledge-endpoints/knowledge-endpoint-descriptions)
(`data/props/lookups`) and
[props.conf specification](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.4/configuration-file-reference/10.4.0-configuration-file-reference/props.conf).
SPL case behavior is documented in
[Use fields to search](https://help.splunk.com/en/splunk-enterprise/search/search-tutorial/9.0/part-4-searching-the-tutorial-data/use-fields-to-search).

### Unreleased event-type/tag extension

Native `saved/eventtypes` and `configs/conf-tags` GET catalogs provide
authoritative per-entry ACL/namespace and paging totals. `search/tags` summaries
are not the shared-inventory authority because their response lacks those
contracts. Each tag assignment has its own canonical identity; stanza paging
counts are distinct from expanded assignment counts.

Bounded literal equality/IN parsing preserves include/exclude polarity.
Name/field/namespace indexes and exact-ID resolution avoid an estate-wide target
scan for each reference. Private shadows, duplicate exports, case collisions,
unknown enabled states and URI-like values remain qualified rather than guessed.
System inheritance and implicit classification are not complete. No inventoried
SPL, regex or expression is executed to prove a relationship.

Explorer, review freshness, required-content, impact and CSV/JSON share the same
edge identities and potential-path semantics. Coverage policies v2 (event/tag)
and v3 (field lineage) never rewrite earlier decisions or captured evidence.
The extension uses the existing app-local cache and permissions; it adds no
server endpoint or restart requirement.

The separately bounded field-lineage increment uses four native GET catalogs:
`data/props/extractions`, `data/props/fieldaliases`, `data/props/calcfields` and
`data/transforms/extractions`. Strict pagination, shared ACL identity, duplicate
omission and 10,000-entry family caps reuse existing app-local snapshot handling.
Decoders retain compact facts rather than raw PCRE or expression bodies.
An exact GET-only Web exposure supplies the native calculated-field collection
route omitted by older Enterprise defaults. Native authentication/ACL checks are
unchanged; no child wildcard, new handler/capability or source-write method is
added. This is not a general-purpose proxy.

An indexed matcher binds literal ordered REPORT targets and compatible field
producers/consumers by exact event scope, literal field name, namespace and phase.
REPORT output provenance is checked again in the consumer's possible app context;
same-name local overrides with different outputs do not leave ghost exported
producers. Calculated fields are parallel; aliases do not chain. Literal automatic
lookup event-input mappings can depend on earlier declared field phases. Positive
exact original-event selectors witness possible props callers without proving
field consumption. Reusable sources do not inherit their owning app as a caller.
Per-source/scan edges, producer-index entries and candidate visits are bounded;
every reached ceiling adds a coverage gap. Inline PCRE, expression execution,
cross-transform availability, full props precedence and effective values remain
outside the supported contract. Installed/native qualification is build-specific;
see the compatibility policy rather than treating decoder tests as runtime proof.

The native shapes and search-time ordering are documented in the
[10.2 knowledge REST reference](https://help.splunk.com/en/splunk-enterprise/rest-api-reference/10.2/knowledge-endpoints/knowledge-endpoint-descriptions)
and [10.2 props.conf specification](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.2/configuration-file-reference/10.2.7-configuration-file-reference/props.conf).

## Usage evidence

Usage runs are separate from inventory snapshots and reference the inventory
scan used for attribution. The saved-search source aggregates distinct search
IDs from `_audit`; the dashboard source aggregates attributable application
view paths from `splunk_web_access`. Same-name private saved searches are
matched only when the observed user namespace identifies one object uniquely.
Ambiguous activity is disclosed and not assigned.

Each source records the requested window, first and last visible source event,
event count, activity-row cap, and warning state. A source is complete only when
visible records span both ends of the requested window within a conservative
tolerance. Empty, inaccessible, truncated, or retention-limited sources remain
unavailable or partial.

The overlay can lower abandonment confidence when current activity is observed.
It can increase confidence or produce a dormant review finding only for a
complete window associated with the current inventory and an object that was
not modified after the observation window. Evidence is current for at most
seven days after its window ends; one validity function drives classification,
filters, details, readiness, and exports. Zero observations are always described as
review evidence rather than proof of non-use.

### Removal-impact derivation

Dependency Explorer performs a cycle-safe breadth-first traversal against the
persisted, unfiltered edge set. Starting from the selected object, it follows
inbound edges to direct consumers and then continues through their consumers up
to the selected one-to-five-hop depth. Each affected object retains its
shortest known path, relation, weakest path confidence, potential-path status,
source evidence, and likely outcome.
Traversal is capped at 500 affected objects and reports truncation rather than
silently presenting a complete result.

The analysis combines the persisted removal-impact indicator with captured
blast-radius evidence, cross-app scope, protected objects, unresolved targets,
scan completeness, and Review Library state. It derives recommendations at
render/export time and does not persist a new decision or change customer
content.

## Persistence

Scan lifecycle state and a recoverable lock are written before collection.
Objects, edges, findings, and owners are prepared under a new scan identifier;
counts, uniqueness, and endpoints are verified before a manifest is published.
The complete baseline is retained across bounded or incomplete checks. Usage
evidence is persisted under its own run identifier and overlaid
conservatively at read time. Review records remain independent from snapshot
replacement, snapshot current usage provenance when created, and survive when an
object is no longer visible.

### Change-aware review evidence

Collectors fingerprint non-operational returned configuration before discarding
raw definitions. Field names are values in compact arrays, not dotted/dollar
document keys that KV `batch_save` rejects. Analysis builds one object/adjacency
index and attaches full neighborhood digests plus bounded manifests in yielding
chunks. Library loading can compare these per-object records without downloading
the entire edge collection; Explorer retains its full graph for impact analysis.
Snapshot publication verifies projected identities/endpoints rather than
re-downloading complete evidence. Overview, Ownership, and Settings omit review
manifests; review-capable views omit duplicate top-level configuration hashes.

Saved decisions and explicit evidence baselines are independent. Comparison maps
are memoized per snapshot/review set and refresh their time gates once a minute
or on window focus, not on each filter keystroke. Known changes remain actionable
even with partial coverage, but partial/old evidence cannot establish Current.
Normal note/stage edits retain the baseline and original at-review facts.

Coverage is indexed by possible target type, namespace, and optional exact name,
so an unrelated dynamic index expression does not invalidate every macro. Missing
source catalogs still propagate uncertainty, private-source identities never enter
the shared cache, and unmodeled external/dashboard navigation remains partial.
The supported static scope is explicit rather than a claim of universal visibility.

Review saves use the authenticated `content_hygiene/review_revisions` coordinator,
which holds a POSIX interprocess file lock, rechecks the parent/legacy origin,
and inserts into the application journal. KV duplicate-key rejection alone is
not assumed atomic. The endpoint uses the caller's session, checks the named
hygiene role and capability, and never accepts a write destination from the
request. It rejects search-head-cluster and non-POSIX use. New reviewer/time
metadata comes from authenticated server context and the server clock.
Compact headers validate sequence continuity; heads and referenced
captures load in bounded batches. A legacy origin digest detects old-client
divergence. The UI freezes an editor's base revision while dirty and offers
explicit comparison/reconciliation after a conflict. Archive/restore appends
history rather than deleting accepted decisions. Collection-level permissions
do not protect against direct journal modification outside the coordinator.
Only standalone POSIX search heads are supported for coordinated review writes.

JSON Schemas in [`schemas/`](../schemas/) document the normalized records.

## Frontend

Seven standard Simple XML dashboards provide only a mount point and native
Splunk chrome, not searches or custom Mako templates. The entry waits for
Simple XML readiness and mounts one React root. Chunk URLs use Splunk's
locale/proxy/build-aware static URL helper rather than inferred script locations.
The native theme API is loaded through AMD under Simple XML (or the standard
helper outside AMD), preserving the signed-in user's preference. Host CSS is
scoped to this workspace's canvas and heading inheritance; native navigation
remains owned by Splunk.

The source is a Yarn 1 workspace:

- `app/packages/overview`: reusable React application, pages, services, exports,
  and tests
- `app/packages/content-hygiene`: Splunk page entries, configuration resources,
  metadata, and production packaging

Webpack emits one shared, cacheable shell and deferred view chunks, avoiding a
full duplicate application entry per view. Summary pages do not download graph
edges or owner records they do not use. REST reads have bounded timeouts and a
single retry for transient status codes; writes are never automatically replayed.
Production source maps are disabled and staging output is not committed.

The relationship workspace uses indexed adjacency and a deterministic
directional layout, rather than a full-estate force simulation. Hubs group by
app/type, expand incrementally, and disclose the 60-card render budget. Graph
inspection and center selection are separate. Related and affected-object
tables paginate; impact traversal retains its independent 500-object safety cap.
