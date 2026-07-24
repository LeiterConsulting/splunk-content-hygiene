# Architecture

Splunk Content Hygiene is a client-driven Splunk UI Toolkit application. It
uses the current Splunk Web session to call supported Splunk REST endpoints,
normalizes visible content, analyzes explicit dependencies, and persists the
result in app-local KV Store collections.

```text
Splunk REST resources
        |
        v
bounded or paginated collectors
        |
        v
normalization + namespace-aware identities
        |
        +----> SPL/dashboard reference extraction
        |                 |
        +-----------------+
                |
                v
conservative classification and ownership correlation
                |
                v
app-local KV Store snapshot
                |
                v
Overview / Candidates / Dependencies / Reviews / Ownership / Settings
```

## Runtime boundaries

- Scans are explicit and run in the initiating browser session.
- The app has no custom backend, custom REST endpoint, or external service.
- Production views read only the latest persisted live snapshot.
- The only end-user mutation is app-local `ch_reviews` workflow state.
- Customer knowledge objects are never deleted, disabled, reassigned, or
  rewritten.

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

## Persistence

Scan lifecycle state and a recoverable lock are written before collection.
Objects, edges, findings, and owners are prepared under a new scan identifier;
the latest successful or partial snapshot is then read consistently by every
view. Review records remain independent from snapshot replacement and survive
when an object is no longer visible.

JSON Schemas in [`schemas/`](../schemas/) document the normalized records.

## Frontend

The source is a Yarn 1 workspace:

- `app/packages/overview`: reusable React application, pages, services, exports,
  and tests
- `app/packages/content-hygiene`: Splunk page entries, configuration resources,
  metadata, and production packaging

Webpack emits one JavaScript entry for each Splunk view. Production source maps
are disabled and generated staging output is not committed.
