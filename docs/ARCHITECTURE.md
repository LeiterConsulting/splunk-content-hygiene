# Architecture

Splunk Content Hygiene is a client-driven Splunk UI Toolkit application. It
uses the current Splunk Web session to call supported Splunk REST endpoints,
normalizes visible content, analyzes explicit dependencies, and persists the
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
- The app has no custom backend, custom REST endpoint, or external service.
- Production views read only the latest persisted live snapshot.
- End-user writes are limited to app-local inventory, usage-evidence, lifecycle,
  and `ch_reviews` workflow state.
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
lookup files, data models, indexes, sourcetypes, and users. Bounded mode limits
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
shortest known path, relation, confidence, source evidence, and likely outcome.
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

JSON Schemas in [`schemas/`](../schemas/) document the normalized records.

## Frontend

Six standard Simple XML dashboards provide only a mount point and native
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
