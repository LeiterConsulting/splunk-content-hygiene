# User guide

## Start with a scan

Open **Settings & Scan Status**. A bounded scan reads at most 100 records from
each collector and is the quickest permission and connectivity check. A
complete scan paginates through visible records up to the documented
10,000-record cap per collector and performs dependency analysis.

Keep the browser tab open while a scan runs. If any collector is incomplete,
the scan and every page retain a visible warning. The app does not substitute
sample data for missing results.

A complete baseline remains in use after a bounded or incomplete check; the
scan banner explains when it is being retained. Cancel stops further collection
without replacing that baseline. Private objects are excluded from the shared
hygiene inventory. Your assigned hygiene role determines whether collection
and review controls are available.

## Collect usage evidence

After an inventory scan, choose a 30, 90, or 180-day window in **Settings &
Scan Status** and select **Collect usage evidence**. The app runs bounded,
on-demand searches against the saved-search audit trail and Splunk Web access
log visible to the signed-in user.

Usage collection records only derived counts, last-observed timestamps, source
coverage, and provenance in `ch_usage_evidence`. Raw user SPL and actor lists
are not persisted. The customer object is never executed, changed, disabled, or
deleted by this workflow.

Each telemetry source is capped at 10,000 attributable rows and a 140-second
interactive request budget. Reaching either guardrail produces incomplete
coverage rather than a silent conclusion.

Every supported object receives one of these evidence states:

- **Activity observed** — attributable executions or dashboard accesses were
  found.
- **No activity, complete window** — source records span the requested window
  and no attributable activity was found. This supports investigation but is
  not proof that the object is unused.
- **Partial window** — visible telemetry does not span the requested period.
- **Unavailable** — the source was empty, inaccessible, or the search failed.
- **Not measured** — no applicable usage run exists for the object.
- **Historical** — the inventory differs, the object changed after the window,
  or the window ended more than seven days ago. Counts remain context, not
  current decision evidence.
- **Unsupported** — this resource type has no directly attributable telemetry
  source; it is not reported as unused.

Only a complete current window with zero observations can increase abandonment
confidence. Observed activity can lower abandonment confidence. Partial,
unavailable, stale, or post-modification evidence never produces an inactivity
classification.

## Understand the status groups

- **Active**: current evidence does not identify a hygiene concern.
- **Dormant**: available evidence suggests review, but usage telemetry is not
  yet sufficient for an automated removal conclusion.
- **Orphaned**: dependency or ownership evidence suggests an object is no longer
  connected as expected.
- **Broken**: a supported explicit reference could not be resolved in the
  visible, complete catalog.
- **Unowned**: ownership evidence requires review.
- **Protected**: the object should not be treated as a routine cleanup
  candidate.
- **Unknown**: permissions, catalog completeness, or missing evidence prevent a
  defensible classification.

These are investigation aids, not deletion instructions.

## Environment Overview

The **Live inventory by app** tile includes every app in the latest live
snapshot. Search by app name, sort by app name, object count, or any displayed
health percentage, reverse the sort direction, and choose 5, 10, or 25 rows per
page.

Select a health-composition bar to see exact counts and percentages for that
app. Select the app name or **View app candidates** to open Cleanup Candidates
with the app filter applied. Pagination and sorting change only the Overview
presentation; exports continue to include the complete live app summary.

## Cleanup Candidates

Filter by health group, usage-evidence state, app, object type, free text, or
Review Library stage.
Open an object to inspect identity, ownership, reference counts, reasons, and
suggested next steps. Exports include the full filtered result set, not just the
current page.

Selecting a row opens a full-width workspace. **Explore dependencies** is in the
object header, above its evidence. Use **Back to candidates** to return to the
same filters and results page, or Previous/Next to move through the filtered
results. A link to a known inventory object opens that exact object even when it
is outside the cleanup-candidate filters; the workspace labels that context.

Use the **Review decision** tab to store a stage, investigation note, and optional
assignee. Evidence, decision editing, and revision history have their own tabs.
The underlying Splunk object is not changed.

### Bulk candidate review

Select rows, **Select all on this page**, or **Select all N filtered results**.
Paging and sorting preserve selection; changing a filter or scan clears it.
Choose **Review N selected**, enter a stage, optional shared note and assignee,
then preview the exact identities, type counts and proposed saves/skips before
confirming. Selection alone never saves a decision.

Existing reviews are skipped by default, including archived decisions. Explicit
active-review updates append the shared note, preserve an assignee left blank,
and never silently reaffirm an earlier evidence baseline. Archived or unverifiable
histories must be handled individually. Each new review captures available current
evidence using the same policy as an individual save; missing evidence stays
unverifiable. A shared decision is not removal approval.

Saves are sequential, conflict checked, and not atomic. **Stop after current item**
leaves completed saves intact and reports the remainder as not saved. Conflicts,
unconfirmed saves, failures and skips remain distinct in the CSV/JSON receipt.
Authentication failures or unconfirmed writes stop further saves. Retry only
explicit failed items after recheck; inspect conflicts and unconfirmed outcomes
individually. The result receipt includes each saved revision, actor and time.
An earlier bulk batch does not retain newly discovered objects automatically.
Use a separate, explicitly confirmed [app-wide retention policy](#app-wide-retention-policies)
when that is your intent; a bulk decision never creates one implicitly.

## In-use and required content

Open **In-use Content** from navigation or Overview. The default starting set is
current attributable dashboard/saved-search activity, active **Retain** review
decisions and verified active app-policy roots. Each has a separate reason.
Choose activity kinds and whether saved-search activity must include a
successful execution. Scheduled and manual saved-search runs cannot be separated
by the available telemetry. Failed/skipped attempts are disclosed, not called
successful runs. Historical, modified or expired observations are not silently
reused as current activity.

Retain remains a human decision, not proof of usage. The report records the
reviewer, review date and evidence status, and still includes a retained identity
whose current definition is no longer visible with an explicit missing-definition
warning. Archived or unverifiable persisted decisions are not accepted as roots.
**Retained content report** in Review Library starts with individual Retain and
verified app-policy roots, not activity roots. Missing/unverifiable policy scope
remains a blocker to cleanup but does not fabricate verified required objects.

Use **Explicitly selected objects** to choose one or more exact starting identities
without claiming usage. **Required content report** on an Explorer center opens
that identity directly. The picker shows 200 matches; refine its search to reach
other objects. Missing identities are disclosed, not replaced with a default.

The report follows all supported outbound dependency hops, including macro,
lookup and lookup-file chains, deduplicates identities, and handles cycles. App
containment/ownership links are metadata, not required-content closure. Retaining
an App object individually does not imply retaining every object in that app.
An explicit app-wide policy instead selects the currently visible shared
identities in its exact namespace as independently labeled starting objects.
Groups and display
filters help browse the result; filtering a type/app does not alter the underlying
closure. Each required row has one shortest witness path, with conservative path
confidence. Inspect it or drill into Explorer to investigate further.

When a starting-set, activity or inventory change removes a selected type/app
from the footprint, that display filter resets to **All** with a status notice.
Valid selections and search text are preserved. A loading inventory is not
treated as a missing option. The reset does not change starting objects,
dependency traversal or the full JSON export, and an obsolete selection does
not silently return when earlier options reappear.

Tables show 50 rows at a time. Only path presentation is bounded to 100 identities;
the complete supported closure is still calculated. A 50,000-object or
250,000-relationship traversal ceiling produces an explicit **Truncated** warning.
Full JSON preserves parameters, root reasons, witness parents, all traversed
relationships, the usage run/window and source summaries, and coverage diagnostics.
Mapping and source warnings remain visible even when telemetry covers the complete
requested window; complete time coverage does not mean every activity row maps to
an object. Object CSV is grouped by type and uses
compact parent/root IDs; export coverage CSV alongside it. A filtered CSV is
explicitly labeled and is not the full dependency footprint.

This is always a **partial shared static footprint**, not a complete migration
manifest. Shared event-type/tag, declared field-lineage and 1.6
workflow/navigation coverage are bounded as described below. Complete
effective props behavior remains unverified. Automatic
lookups and declared field paths have bounded potential coverage, not runtime closure. Private,
dynamic, external and ad-hoc consumers may require more content. Missing activity
or absence from this list never establishes inactivity or removal eligibility.

## Dependency Explorer

Choose a center object to see inbound and outbound relationships. Each edge
shows direction, relation, confidence, resolution state, source location, and
evidence.

Filters can restrict the center objects and related results by cleanup group or
Review Library stage. Select a resolved related object to continue the
investigation as a multi-step drill-through. Cross-view links preserve the
selected object context.

### Caller-supported cross-dimension paths (1.11)

A consumer scoped to a sourcetype can potentially use an earlier producer scoped
to a host or source. That relationship is now recorded only if one captured
Saved Search, Report, Alert or Dashboard query has a supported strict initial
conjunction selecting both scopes. Separate panels, OR/NOT/IN, grouping, macros,
subsearches, generated/rewritten fields and post-pipe filters cannot supply this
evidence. Source/sourcetype matches are case-sensitive; host matches are not.

In a producer relationship's details, **Scope compatibility** names the captured
conjunction basis and both declarations. Expand **Inspect supporting callers**
to filter or page through independent receipts. Each underlined caller link
opens that exact cached object in Dependency Explorer. The receipt includes its
app, original query location, declared selectors and selector locations—not the
full query, event data or a claim that the caller executed.

Existing extraction → alias → parallel calculated field → lookup restrictions
still apply. The caller app must see both declarations and the exact REPORT
transform binding; private or local shadows withhold guessed shared paths.
All links remain potential; precedence, field availability, activation, runtime
execution and hidden/external consumers remain unverified. No supporting caller
is not evidence that an object is unused.

CSV/JSON investigations and required-content/impact witnesses carry the same
compact receipts. Review Library keeps the original decision and captured
baseline; explore current relationships separately and re-review explicitly if
evidence changed. A new complete scan records `shared-static-v10` and
`props_callers=1.0.0`; older caches and v1–v9 reviews stay readable unchanged.
Settings explains work/visit/size ceilings and captured counts. Capped evidence
remains partial; zero counts are not a completeness claim.

The phase restriction follows Splunk's
[search-time operation sequence](https://help.splunk.com/en/splunk-enterprise/manage-knowledge-objects/knowledge-management-manual/10.2/get-started-with-knowledge-objects/the-sequence-of-search-time-operations).
The application records a conservative static possibility, not the outcome of
those operations on real events.

### Declared producer-domain compatibility (1.10)

A declared alias, calculated field or automatic lookup input may have an
earlier-phase producer in a compatible props domain. Open the relationship's
context to inspect **Scope compatibility**, its **Consumer** and **Producer**
scopes, exact namespace and output attribution. The basis is one of:

- Same literal event scope.
- Overlapping bounded declaration patterns (ASCII literal text, `*`, `...`).
- Captured shared default fallback.

These are static declaration possibilities, not observed events or proof a
particular field exists, a regex matches, a default wins or a declaration runs.
Source/sourcetype domains compare case-sensitively; host domains compare
ASCII-insensitively. Unlike ordinary case-insensitive SPL selector possibilities,
case-only source/sourcetype producer domains are disjoint. Field names themselves
remain case-sensitive.

No field-name join is made between unrelated host/source/sourcetype dimensions.
Private/local shadows and phase restrictions remain: no alias-to-alias,
calculated-to-calculated or lookup-output chain is inferred. Unknown inputs,
unsupported scopes and hidden configuration remain coverage gaps, not proof of
no dependency. Possible lower/default paths are never pruned as safe fallbacks.

The matcher keeps direct exact-scope indexes and limits candidate visits to
5,000/source and 100,000/scan, with 250 edges/source and 50,000/scan. Bounded
intersection processes at most 65,536 states/pair, two million work units/source
and 20 million/scan. Rejected candidates consume visits. Exhaustion stays partial;
no customer PCRE, SPL, EVAL, event samples or lookup rows are executed/read.
Cached page loads do not run the matcher or collect native configuration.

Settings shows the `props_domains: 1.0.0` scan marker and compatibility counts.
Old caches request a new complete scan; existing decisions and baselines do not
change. Export relationship JSON/CSV for the full compact scope receipt, and use
the required-content report for multi-hop witnesses. Library decisions can open
Explorer at the exact identity; no new review save is needed to investigate.
See the [#8 acceptance boundaries](STATIC_COVERAGE_ACCEPTANCE.md).

### Event types and tag bindings (1.3)

Run a **complete scan** after upgrading to 1.3.
An older snapshot requests that scan instead of inventing missing coverage.
Event Type identities include their app namespace. A Tag Binding is one specific
tag assignment to a native field/value stanza; it is not a single object shared
by every use of the tag's name. Scan reports distinguish native stanzas from the
assignment records produced from them.

Explorer retains literal equality/IN filters and their inclusion or exclusion
meaning, including field-qualified tag filters. **May** links are conditional:
disabled/unknown-state targets, encoded values, exported reusable definitions and
invoking-app context cannot establish a single proven runtime binding. Literal
tag-to-event-type declarations can be followed through the existing drill-down,
impact and required-content actions. Inspect full relationship context for source
locations and qualifications; exports retain the same identity and semantics.

Private definitions are excluded. Ambiguous namespaces, system inheritance,
wildcards, dynamic names, transformed-event contexts and encoded field values
remain explicit gaps. The app neither evaluates event classification nor silently
decodes a different target identity. No graph match is proof of execution; no
missing edge is proof of non-use. Inclusion and exclusion both matter when
assessing removal: a lost exclusion can broaden results if that binding applies.

Saved Library stages, notes, assignments, revisions and evidence baselines are
unchanged by scans. Moving from the earlier coverage policy to the expanded
policy can require **Needs re-review**; inspect the changes and explicitly reaffirm
only after investigation. Do not edit review KV rows to force a Current badge.

### Workflow actions and navigation menus

Version 1.6 adds two shared catalogs. Run a **complete scan** after upgrading;
older cached scans remain readable but do not contain this coverage. Settings
reports native entries separately from retained shared objects. Private/system
definitions and uncertain identities are not silently treated as shared content.

Select a **Navigation Menu** in Explorer. Literal `<view name>` and `<saved name>`
references identify configured views/reports in the exact app namespace. Explicit
`search_view` and saved-report rendering views are retained. Root-relative
`/app/<app>/<view>` links, optionally locale-prefixed, identify literal app/view
destinations; app-only links do not invent a landing view. Same-name views in
other apps are not substituted. Built-in/system inheritance or a missing shared
target stays unverified rather than being called a proven broken link.

Select a **Workflow Action** to inspect declared search/view/app targets.
Static search bodies use the existing lexical parser. A literal `search.app`
provides a search namespace; when absent or dynamic, the runtime invoking app is
unknown and owning-app references are not guessed. A field-token search template
is not partially interpreted as runnable SPL. Workflow field availability,
event-menu applicability and actual execution remain unverified.

Use **Relationships**, **Removal impact**, **Required content** and CSV/JSON to
follow the supported paths. Relationship evidence and source locations identify
the exact declaring attribute/menu position. These are configured interactions,
not observed clicks or executions, and do not manufacture activity roots.
External URLs, POST actions, query/fragment bodies, dynamic menu lists (`source`,
`match`), unknown/custom XML and runtime field tokens are not evaluated or fetched.
Raw XML, URLs/query values and workflow search bodies are not stored in the
inventory cache; only compact identities, fingerprints and relationship evidence
are retained.

Parsing is bounded to 1,048,576 source characters, 250 references per source, 1,000 menu
nodes and two nested collection levels. The whole scan permits 8,388,608 UTF-16 source
characters and 50,000 inspected interaction references; duplicates/unresolved
references still spend that budget. A ceiling produces an explicit gap, never
a claim of no dependencies. See [troubleshooting](TROUBLESHOOTING.md#workflow-or-navigation-targets-are-missing).

New scans use `shared-static-v5`. Existing decisions, notes, assignees, history
and v1–v4 baselines remain unchanged. Inspect expanded evidence before explicitly
reaffirming a review. Missing links or activity never establish removal eligibility.

The supported syntax follows Splunk's [navigation XML reference](https://dev.splunk.com/enterprise/reference/dashboardnav/)
and [workflow configuration reference](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.2/configuration-file-reference/10.2.0-configuration-file-reference/workflow_actions.conf),
with the deliberately narrower uncertainty and privacy limits above.

### Shared props precedence and inheritance

Run a new complete scan, select a props-backed object in **Dependency Explorer**
or **Review Library**, and open **Inspect shared props contexts** near the top of
its declared field details. Relationship-context dialogs show the same evidence
for participating props objects. Find an app/object, filter by binding status,
or page through contexts without issuing more native reads.

| Status | Interpretation |
| --- | --- |
| Local merged match | Native rule ownership and the merged exact-stanza value agree with the captured definition in this app. |
| Inherited merged match | Both native reads agree with a captured globally shared definition returned from another app. |
| Shadowed in this context | Both reads agree on a different captured shared binding. Follow **Returned binding** to investigate it. The original potential path remains as a possible fallback. |
| Unverified | A scope, access, snapshot, handler or budget limitation prevents this cross-check. Read the specific reason; do not interpret it as absence. |

The cross-check uses `nobody` plus the qualified app namespace. Rule-level ACL
and captured value/access digests must agree; a whole-stanza ACL, equal values in
two apps or an app-name ordering alone cannot establish attribute origin. Native
reads are observations, not an atomic configuration transaction or proof that
settings have activated in memory. No raw props value is cached or exported.
Captured fingerprints retain the app's existing configuration-normalization
policy; they do not assert byte-for-byte source-file equality or file-layer origin.

This resolves a bounded shared exact-stanza question, not every effective-props
question. Search-time app/user precedence differs from global indexing
precedence. Matching source, host and sourcetype stanzas can interact; the app
does not evaluate pattern/default scopes or turn unrelated positive selectors
into a proven event domain. Per-file local/default provenance, user/private and
system inheritance, field availability and execution remain unverified. See
Splunk's [configuration context rules](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.2/administer-splunk-enterprise-with-configuration-files/configuration-file-precedence)
and [within-props priority rules](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.2/administer-splunk-enterprise-with-configuration-files/attribute-precedence-within-a-single-props.conf-file).

Context checks are scan-time, deduplicated and bounded: complete scans inspect
at most 256 native attribute/app pairs (two GETs each, four workers, 90 seconds);
bounded scans use 32 pairs and 15 seconds. Each response is capped at 128 KiB,
each read at eight seconds, without hidden retries.
Calculated-field requests use a narrowly filtered native REST catalog, not an
event search job or an additional Web exposure. Candidate visits, stored
tasks and per-object/edge context rows also have explicit ceilings. Fixed caller
contexts are prioritized before reusable and own-app inspection. Budget-limited
contexts and truncated evidence remain unknown; there is no page-load crawl.

CSV/JSON retain compact observations in declared field facts and relationship
provenance, including required-content and removal-impact reports. They do not
remove shadowed dependencies or grant removal readiness. New scans use
`shared-static-v6`; v1–v5 decisions, notes, assignees, baselines and journals remain
unchanged. Changed context evidence can require explicit re-review.

### Bounded props patterns and defaults (1.9)

Run a new complete scan, then use the existing **Declared field lineage**,
**Inspect shared props contexts** and **Inspect cross-stanza order** disclosures
in Dependency Explorer, relationship dialogs or Review Library. The event-scope
label distinguishes literal scopes, bounded patterns, captured default fallbacks
and unsupported scopes. Viewing/filtering/exporting never saves a review or runs
another metadata scan.

Supported stanza patterns contain literal ASCII text, `*` (zero or more
non-separator characters) and `...` (zero or more arbitrary characters), and must
match the entire name. Dots outside `...` are literal. Matching uses a small
bounded algorithm, never a customer-supplied regular expression. Host matching
is ASCII-insensitive; source/sourcetype case-only possibilities remain unverified
for conditional ordering because ordinary SPL selectors are case-insensitive.
PCRE operators/classes/groups/modifiers, backslashes/Windows escapes, encoded or
non-ASCII scopes and patterns longer than 256 characters are unsupported, not
evidence of no dependency. Pattern selector values over 1,024 characters remain
budget-limited. See the [native props specification](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.2/configuration-file-reference/10.2.0-configuration-file-reference/props.conf).

A **may apply** path needs a positive exact original-event selector. Broad,
generated or runtime-expanded searches remain gaps; app containment is not a
caller witness. Only an actually captured shared `[default]` declaration adds a
potential default path. It is not proof that a default is effective, that an
uncaptured default is absent or that system/private defaults were inventoried.
Field-name producer joins are still exact-scope only; matching two pattern names
does not establish that their event domains overlap.

Existing native rule/merged-attribute checks now admit the bounded stanza subset,
with the same GET-only read/time/byte ceilings. Within a category, absent native
priority defaults to 100 for literals and 0 for patterns. A captured default is
below any specific matching stanza regardless of numeric priority. Same-attribute
comparisons still require one supported conjunction, verified native observations
and complete declared catalogs; every lower/default/shadowed path is retained.
This is conditional subset ordering, not full effective props or runtime proof.

Prefix/namespace indexes avoid inspecting every rule for every caller. Pattern
comparison has separate ceilings of 2,000,000 character cells per source and
20,000,000 per matcher per scan (field and automatic-lookup callers); conditional
cross-stanza comparison has its own 20,000,000-cell ceiling and five-second
deadline, alongside the existing candidate/edge ceilings. Failed
matches consume work. Exhaustion produces a coverage gap and blocks a highest
claim; `props_scope_*` counters expose supported/unsupported rule counts. The
scan marker `props_patterns: 1.0.0` distinguishes new evidence from old caches.
Impact, required-content, scan, Library and investigation CSV/JSON retain the
same compact scope/context evidence and limitations.

New scans use `shared-static-v8`; v1–v7 decisions, captured baselines and journals
are not rewritten. Expanded evidence can request **Needs re-review**. No pattern,
priority, default fallback or missing edge establishes safe removal.

### Conditional cross-stanza props order (1.8)

The original literal-only behavior below is extended in 1.9 by the bounded
pattern/default contract above; unsupported/runtime scopes remain unverified.

Run a new complete scan, then expand **Inspect cross-stanza order** in a
props-backed object's details or an original-event relationship. The same
disclosure is available in Review Library without saving or changing a decision.
Search by caller, app, attribute or selector; filter status, page through four
contexts at a time, and follow the caller or a higher captured binding.

The comparison is deliberately narrow: the same exact native attribute, a
qualified shared app context, and one supported initial-search conjunction of
literal original-event selectors. It never joins independent OR branches,
subsearches, dashboard queries, post-process searches or runtime macro expansions.
Patterns, escaped literals, grouping, IN/NOT, conflicting selectors and
non-ASCII/case-ambiguous matches remain unverified. Separate source queries retain
separate locations. The broader **may apply** graph is not reduced to this subset.

| Status | Interpretation |
| --- | --- |
| Highest captured precedence (conditional) | Highest in this compared literal subset, if the recorded scopes match the same event. Not a full effective-props winner. |
| Lower captured precedence (possible fallback) | Another compared binding takes precedence under the same condition. The original path remains because removing an override can expose it. |
| Unverified | No supported comparison, only one distinct stanza, incomplete/changed/denied metadata, case ambiguity or a safety ceiling prevents ordering. Never proof of absence. |

For a shared attribute, source-category settings precede host, then sourcetype.
Within a category, numeric stanza priority is considered before ASCII name
ordering; priority cannot reverse different categories. The app uses native merged
priority metadata, or the documented literal default of 100 when that setting is
absent. Unsupported priority values remain unknown. Numeric evidence is shown
when a within-category comparison uses it. See the
[props specification](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.2/configuration-file-reference/10.2.0-configuration-file-reference/props.conf)
and [precedence rules](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.2/administer-splunk-enterprise-with-configuration-files/attribute-precedence-within-a-single-props.conf-file).

Different attribute names—even ones declaring the same output field—are not
treated as competing settings. Same-stanza app shadowing remains a separate
observation. No relationship, confidence, removal blocker or usage root is removed
or upgraded by an ordering result. This is not event matching, field availability,
runtime activation, source-file origin, private/system inheritance, pattern/default
precedence, sourcetype rewriting or execution evidence.

Checks reuse the existing native reads and remain scan-only. The comparison
ceiling is 100,000 indexed work items, 10,000 groups, 16 members per group and
five seconds. Compact projections are capped at 32 rows/32 KiB per object or
relationship and 50,000 stored projections overall. Strict parsing considers at
most 512 initial-clause tokens, 250 dashboard query contexts and 50,000 retained
scan scopes. Unsupported or omitted contexts remain unknown; navigation and
filtering do not launch new native reads. Check `props_cross_stanza_*` diagnostics
in the scan report. CSV/JSON retain the same identities, selectors, priorities,
source locations, compared members and qualifications.

New complete scans use `shared-static-v7`. Earlier v1–v6 baselines, stages, notes,
assignees and journals stay unchanged. New evidence can request explicit re-review;
no scan reaffirms a decision or approves removal.

### Declared field lineage

Run a complete scan after upgrading to 1.4 to collect output
attribution; earlier field inventories remain readable. Explorer can select **Field
Extraction**, **Field Alias**, **Calculated Field** and **Field Transform** objects
using their exact native name and app namespace. Use **Selected object** for the
declared scope, inputs/outputs, processing phase, AS/ASNEW assignments, ordered
REPORT targets and native source location. Long field lists expand through a
keyboard-accessible Splunk disclosure. Review Library shows the same facts under
**Object & usage details**, without changing a saved decision.

REPORT references retain every one-based list position, including repeated
targets. Potential input paths connect compatible exact event scopes and visible
namespaces: extraction → alias → calculated → lookup. Calculated EVAL definitions
run in parallel; the app does not invent calculated-to-calculated or alias-to-
alias chains. Attributable transform outputs can identify a possible REPORT producer.
Supported inline named captures also identify possible extraction producers;
customer regex is never compiled or executed. Constants have a known
output but no invented input field. Unsupported expressions retain the output
identity and an explicit input-lineage gap.

**May apply** links from positive exact original-event selectors identify possible
scope callers, not proven output-field consumption. Negative/wildcard selectors,
transformed or post-process event streams, and reusable owning-app assumptions do
not create these links. Exported definitions can have multiple possible invoking
app contexts; private shadows, missing metadata, duplicate targets and omitted
system inheritance remain unverified rather than proven broken references.

Open graph **Details** for the matched field names, phases, transform provenance,
REPORT positions and namespace qualification. Required-content and removal-impact
paths retain their weakest confidence and remain conditional through subsequent
hops. CSV/JSON include compact declared facts and field provenance. No expression
body, regex, lookup row or customer field value is included as lineage evidence.
An empty output list means the supported decoder did not establish names—not that
the definition produces nothing. No path or missing path approves removal.

Extraction-output scans use `shared-static-v4`; earlier v1/v2/v3 reviews remain readable
and unchanged. Investigate the expanded coverage before explicitly reaffirming a
decision. Full props precedence, cross-scope interactions, regex matching, effective
values, dynamic expressions and runtime execution are not established.

In 1.4, **Output attribution** identifies supported
inline/transform named captures, literal FORMAT capture mappings or DELIMS/FIELDS
declarations. Expand **Output declaration locations** to see each field,
one-based capture number and zero-based UTF-16 position in the native attribute.
Graph relationship details offer the matching producer declaration and identity.
These positions help an operator verify the source configuration separately;
the app neither retains the pattern nor claims that it compiles or matches.

Inline `in <field>` clauses retain the declared input but do not create guessed
same-phase extraction chains. Transform capture mappings require recognized group
numbering and key-cleaning-safe names (or explicit CLEAN_KEYS opt-out). Literal
FORMAT/FIELDS names without unambiguous attribution stay visible as facts but
do not create producer links. Dynamic output names, unsupported regex constructs,
index-time/routing attributes and competing mechanisms remain qualified gaps.
Run a new complete scan after upgrading; old cached facts are not silently
reinterpreted and existing decisions/history are not rewritten.

### Automatic lookups and implicit props

After upgrading to 1.2, run a **complete scan**. In Explorer, use **Find center
object** to search for a props rule and choose its **Automatic Lookup** entry
under **Selected object**. Its name identifies the stanza and
`LOOKUP-*` class; the app namespace is part of its identity. Follow its configured
lookup definition and backing file, or inspect inbound possible callers. You can
also start at a search/dashboard or lookup and follow the chain in either
direction. Use **Assess removal impact**, **Required content report**, or the
existing review actions at the top of the selected object.

“May apply” means a positive exact sourcetype, host or source event selector
matches a visible rule. It does **not** mean Splunk executed the rule: confirm
input fields, props precedence, sourcetype renames and the invoking app. An
exported rule can have several potential lookup-definition bindings in different
apps. Pattern stanzas, broad searches, macro/data-model caller context, other
props families and private/hidden configuration remain gaps. No match is not
proof of non-use. The app never runs the inventoried search to establish a match.

The new catalog uses existing read permissions. A denied or truncated collector
is not an empty catalog and cannot replace an established complete baseline.
Matching is also bounded to 250 inferred links per source and 50,000 per scan;
omitted possibilities are disclosed in diagnostics. The map retains its normal
grouping, render budget and evidence-table pagination.

Potential status follows every hop of a chosen report/impact path, including
the final lookup file. Details say **Potential implicit dependency** or
**Potential implicit path**; CSV includes an explicit potential-path column and
JSON retains relations, confidence and coverage. This does not turn a potential
caller into observed usage or a removal recommendation.

Existing review decisions are not changed. New rules, configuration or neighbors
can make their evidence need re-review; inspect **Changes since review** and
reaffirm explicitly only after investigation. Do not delete or edit review KV
records to force a Current badge. Automatic rules and lookup inbound coverage
remain partial where implicit applicability is not established.

The **Relationships** tab puts consumers on the left and dependencies on the
right. Inspect a card to update its details without changing the center. Use
**Center on this object** or table **Drill in** to continue the path. High-degree
relationships group by app or type; expand groups in batches of twelve or
choose individual objects. Zoom, fit the center, and scroll/keyboard-pan inside
the contained map. The map discloses represented and omitted counts; the
paginated evidence table and full filtered exports remain available. The center
picker shows up to 200 matches; refine its search to reach any other object.
Filters and the reset action remain available even when a group is empty.

Graph cards wrap names across three lines and reserve a separate area for status
and actions. Hover or keyboard-focus a name for its full name, type and app.
**Details** opens the complete object context without moving the graph center;
group Details lists individual members in pages of 25. **Inspect object** opens
the existing full-width investigation workspace.

Relationship labels wrap in reserved lanes between cards, above the connector
graphics. Hover or focus a label for its endpoints and full relationship names,
or click/press Enter for **Relationship context**: complete endpoint identities,
weakest confidence, potential/configured explanation, evidence and source
locations. An arrow representing multiple relation types shows **+N more**;
grouped arrows retain every underlying reference, paginated 25 at a time in the
dialog. Escape or **Close context** returns keyboard focus to the invoking
control. Only one quick preview is shown at a time; graph previews close while
full context is open so they cannot cover the dialog. Opening or closing context changes no filters, graph center, saved
decisions or customer objects.

A supplied object link never falls back to another graph center. While inventory
loads its exact identity is retained. If the object is outside the center group,
**Show requested object** broadens that group explicitly. If it is unavailable,
the page keeps the identity visible and disables center-specific investigation
actions until a valid center is chosen. Missing inventory is not proof of deletion.
Links from Candidates, Library, and Ownership carry their originating scan ID;
a notice identifies when Explorer is using a different inventory snapshot.
Related-object filters never silently change a requested center.

The map and evidence tables use the full workspace width. Inspecting a graph
card name or an object in the relationship table opens **Selected object**, with its identity and actions at
the top. **Review decision** applies to that inspected object; its title names
the object explicitly. **Review center object** instead selects the graph center
for review. Switching tabs preserves an in-progress review draft.

**Export investigation** separates filtered relationship CSV/JSON from the full,
unfiltered removal-impact CSV/JSON. View filters never reduce impact calculations.

### Impact of removal

In the **Removal impact** tab, **Impact of removal** analyzes the complete
unfiltered relationship snapshot even when the visible graph is filtered. Its
depth control follows known dependents for one, two, three, or five hops.

The simulation reports:

- direct consumers whose captured reference would be broken;
- indirect consumers reachable through a cascading dependency path;
- affected app namespaces and protected or unresolved blockers;
- the exact path, relation, confidence, evidence, and likely outcome for every
  affected object;
- dependencies that may have no other known consumer after the selected object
  is retired; and
- an ordered validation, owner-confirmation, remediation, rollback, controlled
  change, and post-change verification plan.

Impact readiness is intentionally conservative. Protected content,
retain/blocked review decisions, partial scans, collector warnings, unresolved
targets, traversal limits, known direct dependents, observed recent activity,
and absent or incomplete current usage windows prevent an eligible result. Even
an eligible result means only that captured graph and observation prerequisites
are satisfied; it is not authorization or proof of safety.

Use the impact CSV for an affected-object register and the JSON report for the
complete analysis, consequences, caveats, follow-ups, and recommended sequence.
The application never performs the removal.

The **Changes since review** tab compares the selected object's full captured
direct neighborhood with its explicitly saved evidence baseline. Definition,
owner/sharing/ACL, relationship confidence, and adjacent-object configuration
changes are explained independently of graph filters. Filter center or related
groups by review-evidence status to focus an investigation. Drill from changed
relationships into the current object; unavailable targets cannot be centered.
Impact calculations continue to use the full current graph, not the change list.

## Review Library

The Review Library is durable app-local workflow state:

- **Triage** — saved for initial review and prioritization.
- **Investigating** — dependency, usage, or ownership evidence is under review.
- **Awaiting owner** — an owner or subject-matter expert must confirm intent.
- **Confirmed eligible** — evidence supports eligibility for a separate future
  cleanup process.
- **Retain** — the object was reviewed and should remain.
- **Blocked** — missing evidence, policy, or a dependency prevents a decision.

Select a record to open its full-width workspace. **Explore dependencies** and
**View candidate evidence** sit beside the object title. **Review decision** is
the default tab; **Evidence & changes**, **Object & usage details**, and
**Revision history** keep supporting material readable without a narrow sidebar
or an independent scrolling pane. Back/Previous/Next retain the list's filters.
Exports clearly distinguish the filtered Library from the selected review.

Review records retain an object identity snapshot and scan provenance even if
the object is not visible in the latest scan. Creating a review snapshots the
current usage coverage, observation count, last-observed time, and usage-run
identifier. Later note/stage edits retain those original at-review facts.
**Archive library record** asks for confirmation and archives only the active app-local entry. Select
**Archived** or **All** in the Library state filter to inspect it and restore the
preserved decision. Customer content is never archived or removed by this action.

### App-wide retention policies

Expand **App-wide retention policies** in the Library list. Only a Content Hygiene
operator or administrator can manage them; viewers and reviewers can inspect and
export the same app-local policy history. Policies do not edit individual stages,
notes, assignees, original at-review facts, evidence baselines or revision history.

1. Choose an exact app namespace and select **Preview app policy**.
2. Inspect its app identity, current visible shared-object count, preview scan,
   conflicts and full-scope preview export. The App object itself is included.
3. Choose Active, record the reason and explicitly confirm that this includes
   **current and future shared objects** in that exact namespace.
4. Select **Confirm policy revision**. This appends an attributable policy
   revision; it does not bulk-create individual Retain reviews.

An active policy is an additional protective reason. **Confirmed eligible** remains
visible as the individual's decision, but cannot override policy retention.
Candidates can filter by policy state or policy/individual-decision conflict.
Explorer impact blocks planning for policy-protected or unverifiable scope, without
inflating the dependency-impact score or calling it observed activity. Required
content and CSV/JSON preserve the separate policy reason and revision identity.

Scope binds the exact logical app identity and its returned configuration/ACL
fingerprint from a complete preview scan. Newly discovered shared objects in that
unchanged app acquire policy protection, not fabricated review decisions. Changed
app metadata/ACL or missing app identity requires explicit scope reconfirmation;
it remains a cleanup blocker, not proof of verified policy roots. Private content
and unseen objects are not enumerated. Renamed/different app IDs never inherit a
policy. Native metadata may not distinguish a same-name reinstall, so review that
case explicitly. Retention does not prove activity or complete dependency coverage.

**Review or change policy** can append Disabled or Archived without erasing earlier
revisions, even if the app is missing. Neither state applies policy retention.
Reactivation requires a current complete preview and renewed confirmation. Policy
lists and history are paginated; history exports include all accepted loaded
journal revisions, not only the visible page. The journal has a 10,000-revision
safety capacity; preserve/export/back it up and involve the administrator before
that limit. Do not prune individual revisions.

If another operator saves first, the policy draft remains visible. Reload saved
history, compare the accepted revision, explicitly use it as the new draft base,
and confirm again. Saves are never silently merged or automatically retried.
Unavailable or invalid policy history means **unknown**, not “unprotected.”

### Concurrent edits and history

Switching evidence/history tabs keeps your draft in place. Changing objects,
following an investigation link, or leaving the app asks you to keep editing or
explicitly discard unsaved changes. Nothing is automatically saved or merged.
Browser reload/close uses the browser's own unsaved-change prompt. Save form
edits before capturing/reaffirming evidence or archiving the record.

Each editor starts from the revision it loaded. If someone saves first, your
draft is retained and Save is blocked. Select **Compare with latest saved review**,
read the saved stage/note/assignee alongside your draft, then either use the saved
values or select **Save reconciled draft**. A later collision repeats this check;
there is no blind overwrite option. An uncertain network response must be
reloaded before retrying.

**Show saved revisions** loads revision history on demand. **Load older
revisions** fetches another page. History exports contain only loaded revisions,
not an implied full archive. New revision names and timestamps are recorded by
the authenticated server coordinator; this is application history, not a
tamper-proof audit. Legacy records are retained
separately and their first new edit starts journal history.

### What changed since I reviewed this?

The saved stage is your decision; **Review evidence** is a separate derived status:

- **Current** — a recent comparable scan has complete supported shared static coverage and its
  returned configuration, access, and parsed direct relationships match the
  evidence baseline. This is not live verification or permission to remove.
- **Needs re-review** — a known configuration, access, coverage, relationship,
  adjacent-object, or attributable-usage change warrants investigation. Any
  remaining coverage limits are also shown.
- **Cannot verify** — the object is no longer observed, no supported baseline
  exists, fingerprints are unavailable, or coverage/freshness cannot establish
  validity. No longer observed does not mean deleted.

Use the Library evidence-status filter or its summary buttons to work through
these groups. CSV/JSON exports include status, reasons, limits, and scan provenance.
The change panel offers its own filtered CSV and full evidence JSON exports.
Tables are paginated; exports include all matching rows, not just the visible page.

The coverage panel separates returned configuration, returned ACL, outbound
references, and potential inbound references. Read the reason and possible-source
examples for each partial or unavailable dimension. Open a possible source to
investigate it; it is not automatically a confirmed dependency. Dynamic names,
default index scope, unknown runtime commands, private sources, or unmodeled
external callers can leave a dimension partial. Library/Explorer exports retain
the policy and coverage details. A supported object can be Current even when an
unrelated part of the full scan is partial; removal-impact planning still retains
all of its broader blockers.

New records capture a recent fingerprint when available. Existing reviews are
never silently migrated to Current. After reviewing the evidence, save any form
edits, then choose **Capture review evidence** or **Reaffirm review evidence**.
This explicit action retains the saved stage, note, assignee, original at-review
facts, and first-capture history. Reaffirming partial evidence does not make its
coverage complete. A changed/unverifiable confirmation cannot satisfy removal
planning prerequisites. Retain/blocked decisions remain blockers regardless of
evidence status.

Configuration fingerprints are hashes, not raw definitions. Runtime counters,
collection times, scan IDs, JSON property ordering, and ACL role ordering do not
invalidate a review. The complete direct adjacency is fingerprinted; durable
manifests retain at most 200 relationship rows per object. If a neighborhood is
larger, the app can detect a changed full fingerprint but explicitly limits exact
row comparisons rather than inventing added/lost relationships. First and recent
prior baselines survive rolling inventory retention.

These checks cover only returned configuration and supported parsed references.
Lookup contents, external callers, filesystem scripts, and unsupported dynamic
references need separate investigation. Run a complete scan after upgrading to
establish fingerprints; old scans remain readable but cannot verify new reviews.

## Ownership

Use ownership summaries to find content associated with missing, disabled,
shared, or unknown owners. Drill into an app or object in the other views before
making a decision. Global or app sharing is not automatically an ownership
defect.

## Reporting

Overview, candidates, dependency relationships, review records, ownership, and
scan status expose CSV and/or JSON export controls. Exports are generated in
the browser from the current live snapshot and active filters. Candidate,
dependency, review, environment, and scan exports include applicable usage
coverage and observations. Review exported files before sharing because object
names, apps, owners, notes, and evidence may be sensitive.
Object evidence exports include validity and observation-window provenance.
CSV strings that could execute as spreadsheet formulas are neutralized; JSON
retains original strings.
