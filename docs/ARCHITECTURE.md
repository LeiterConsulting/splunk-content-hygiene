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
- Usage collection creates only bounded, on-demand search jobs and persists
  derived evidence in app-local KV Store; it never dispatches the inventoried
  saved search or dashboard itself.

## Inventory

Collectors query apps, saved searches, dashboards, macros, lookup definitions,
lookup files, data models, indexes, sourcetypes, and users. Bounded mode limits
each content collector to 100 records. Complete mode requests 200 records per
page and stops at 10,000 records per collector, marking the result incomplete
when the visible total exceeds that cap.

Object identities incorporate type, app namespace, name, and user namespace
when needed. Stable keys prevent same-name private objects from overwriting one
another.

## Dependency analysis

The parser recognizes explicit saved-search references in dashboards and
static references in SPL to macros, lookups, saved searches, data models,
indexes, and sourcetypes. It preserves direction, relation, confidence,
evidence, source location, resolution state, and scan provenance.

Dynamic or wildcard names are not declared broken. Command-like text inside SPL
string literals is ignored. An absent sourcetype is not treated as proof of a
broken reference because the visible catalog may not be authoritative.

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
not modified after collection. Zero observations are always described as
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
the latest successful or partial snapshot is then read consistently by every
view. Usage evidence is persisted under its own run identifier and overlaid
conservatively at read time. Review records remain independent from snapshot
replacement, snapshot current usage provenance when saved, and survive when an
object is no longer visible.

JSON Schemas in [`schemas/`](../schemas/) document the normalized records.

## Frontend

The source is a Yarn 1 workspace:

- `app/packages/overview`: reusable React application, pages, services, exports,
  and tests
- `app/packages/content-hygiene`: Splunk page entries, configuration resources,
  metadata, and production packaging

Webpack emits one JavaScript entry for each Splunk view. Production source maps
are disabled and generated staging output is not committed.
