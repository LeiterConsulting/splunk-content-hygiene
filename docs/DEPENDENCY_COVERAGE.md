# Dependency coverage and interpretation

Content Hygiene maps a bounded shared configuration graph. It does not execute
customer searches, expressions, regex or workflow actions to prove dependencies.
No missing edge, usage gap or review stage authorizes removal.

## Supported sources

The final #8 static source-family contract is recorded in the
[#8 acceptance ledger](STATIC_COVERAGE_ACCEPTANCE.md). Version 1.10 adds bounded
declared producer-domain compatibility, not runtime closure.
Version 1.11 adds separately scoped caller-supported cross-dimension paths, not
field-name-only joins or complete co-applicability/effective configuration.
See the [current qualification](COMPATIBILITY.md#1110-caller-supported-qualification)
and the [1.10 contract baseline](COMPATIBILITY.md#1100-producer-domain-qualification).
The earlier bounded props pattern/default extension was qualified in 1.9.0 build 94;
see its [qualification](COMPATIBILITY.md#190-bounded-patterndefault-qualification).
Earlier shared props observations are documented separately below that section.
Workflow/navigation rows were introduced in 1.6.0 build 85, whose
[interaction qualification](COMPATIBILITY.md#160-interaction-qualification)
remains separately documented. Neither increment establishes runtime execution.

| Source family | Supported evidence | What it does not establish |
| --- | --- | --- |
| Saved searches, reports, alerts, macros, dashboards and data models | Supported literal lexical references, namespace/arity resolution and declared source locations | Full SPL semantics, generated/tokenized queries, execution or every external/embedded caller |
| Automatic lookup rules | Literal definition/file bindings, explicit input/output mappings and potential callers from compatible exact original-event selectors | Effective props precedence, actual enrichment, runtime field availability or complete implicit closure |
| Event types and tag assignments | Supported literal inclusion/exclusion filters and distinct shared field/value/tag assignments | Implicit event classification, wildcard/encoded-value reinterpretation, system inheritance or actual matching |
| Extraction, alias, calculated-field and transform definitions | Bounded declared field names, supported output attribution, ordered REPORT positions and potential compatible input paths | PCRE validity/matching, expression execution, full field-phase availability, dynamic outputs or cross-scope effective configuration |
| Shared exact-stanza props contexts (1.7) | Native rule-level ownership/export and merged-attribute cross-check against captured value/access digests; local, inherited, shadowed or unverified observations | File-layer origin, atomic configuration, private/system or cross-stanza precedence, runtime activation or execution; shadowed fallback paths stay in the graph |
| Conditional cross-stanza props order (1.8) | Same-attribute ordering among captured shared literal stanzas in one supported initial-search conjunction; category before within-category numeric priority/ASCII | Full effective winners, patterns/defaults, separate Boolean/query branches, source-file origin, private/system layers, sourcetype rewrites or runtime execution; possible fallback edges remain |
| Bounded props pattern/default extension (1.9) | Whole-name ASCII literal / `*` / `...` potential caller paths and captured shared default fallbacks; native stanza cross-checks and conditional same-attribute ordering, retaining all fallbacks | Arbitrary PCRE/modifiers, escaped Windows paths, encoded/non-ASCII or oversized patterns, cross-pattern field-producer joins, uncaptured defaults, full effective props or actual matching/execution |
| Declared producer-domain compatibility (1.10) | Same-dimension bounded language intersection and captured shared default fallback paths, both scopes, exact phase/namespace/shadow/output provenance; source/sourcetype strict case, host insensitive | Observed events, cross-dimension field-name joins, arbitrary PCRE, uncaptured defaults, full effective assignment, runtime values or execution |
| Caller-supported cross-dimension producers (1.11) | Earlier-phase producer/consumer scopes both selected by one strict captured original-event conjunction in a fixed caller app; exact caller/query/selector provenance, bounded supported patterns and existing namespace/shadow/REPORT checks | Unwitnessed field-name joins, separate queries/panels, OR/NOT/IN/macros/subsearches, runtime field availability, effective precedence, actual events or execution |
| Workflow actions | Literal internal app/view destinations and supported static search references with explicit namespace qualifications | Field-token substitution, invoking-app defaults, event-menu applicability, clicks or execution; external/POST actions are never followed |
| Navigation menus | Literal named views/reports, explicit rendering/search views and supported root-relative internal app/view routes | Dynamic lists/matches, custom XML, inherited built-ins, query/fragment bodies, embedded/external callers or clicks |
| App containment | Native metadata places a shared object in an app | Runtime use, ownership approval or deployment/removal completeness |

Detailed syntax and investigation steps are in the [user guide](USER_GUIDE.md#dependency-explorer).
Only native metadata visible to the scanning identity is assessed. Private
objects are excluded from the shared cache; system inheritance and unsupported
catalog semantics remain explicit limitations. Never widen source permissions
or grant customer-content write access just to clear a coverage warning.

## Three separate questions

1. **Collection:** Were the authoritative native pages returned with stable totals,
   within the declared collector ceiling? A denied, unstable or capped check does
   not establish absence and cannot replace an established full baseline.
2. **Parsing:** Did the source fit the supported bounded syntax? A retained object
   can have partial analysis. Dynamic syntax and budget ceilings produce gaps,
   not an empty assertion of no dependencies.
3. **Resolution:** Does the exact reference have one supported visible target in
   its qualified namespace? Duplicate candidates, private shadows, missing scope
   or omitted inheritance remain unknown rather than guessed bindings.

For supported ordinary SPL references, visible local versus exported definitions
follow the resolver's documented namespace rules. Explicit navigation routes and
named menu views use their exact app and case: a same-name exported view in
another app is not substituted. A workflow's declaration app is not silently
assumed to be its runtime invoking app. Globally meaningful index/sourcetype
references are distinct from app-scoped knowledge-object names.
Unparsed query/fragment parameters can redirect or add consumers outside the
literal route's app; their uncertainty is not confined to that route namespace.

## Read relationships conservatively

**High confidence** means the captured static binding is supported, not that it
executed. **May** relationships are explicitly potential, and that qualification
propagates through downstream footprint and impact paths. **Unknown** resolution
or partial coverage prevents absence from being treated as a proven broken
reference or a removal justification. Built-in view targets intentionally remain
unverified when the supported shared catalog does not establish their binding.

The required-content report includes deliberately selected roots, current
attributable usage roots and verified retention roots as separate reasons.
Selecting a menu or workflow never manufactures an observed-activity root.
Historical usage may remain visible, but it is not current execution evidence.
Full JSON retains the supported closure, witness relationships and limitations;
filtered CSV is explicitly narrower. App containment is not traversed as an
outbound requirement.

Version 1.12 adds a separate, bounded **chosen-witness context** annotation.
Captured invoking apps and exact caller/query/conjunction receipts are
intersected along scoped hops, not unioned across searches/panels/branches.
Shared-caller, app-only, mixed, unverified and bounded states preserve the same
conservative closure and removal blockers. Ordinary static links are not runtime
traces; a weak chosen witness does not classify all alternative paths. This is
derived cached evidence, not broader collection or a new coverage policy. See
[the path-context guide](USER_GUIDE.md#context-aware-witness-paths-112).

Version 1.14 adds explicit bounded comparison of alternative directed witnesses
for the same endpoint pair. It keeps the original witness, checks each path's
context independently, and offers up to three alternatives from a six-hop,
20,000-edge-visit / 2,048-state / 64-candidate search. Display preference is not
an upgrade to relationship confidence or removal readiness. App containment is
not traversed as an outbound requirement. No returned path is not absence;
depth, work, state, context and identity limits remain visible and exportable.
See [alternative investigations](USER_GUIDE.md#alternative-path-investigations-114).

Version 1.15's caller-context diagnostic view explains the same narrow
initial-conjunction grammar; it does not widen it. First rejection and overlapping
syntax features are distinct, no-selector queries do not prove absent consumers,
and post-process/chain queries stay excluded. Old/unavailable/budgeted facts remain
unknown. No new edge, stronger confidence, coverage policy or removal conclusion
is inferred. See [diagnostics](USER_GUIDE.md#caller-context-diagnostics-115).

Removal impact is a read-only simulation, not a cleanup command. New menu/report
links can expose affected destinations and preparation steps; partial coverage,
protection, unknown usage or unresolved evidence still blocks readiness. Perform
any customer-content change through a separate approved administration process.

## Existing decisions and later scans

Version 1.11 scans use `shared-static-v10`. Policies v1–v9 remain readable, with
stages, notes, assignees, captured baselines and revision history unchanged.
Expanded evidence can request **Needs re-review**; only an explicit review action
can reaffirm a decision. Inventory scans never migrate or rewrite saved choices.

The [shared props cross-check](USER_GUIDE.md#shared-props-precedence-and-inheritance)
adds bounded native context observations without relabeling the whole graph as
effective configuration. The [cross-stanza comparison](USER_GUIDE.md#conditional-cross-stanza-props-order-18)
orders a strictly qualified subset, extended by the [bounded pattern/default
contract](USER_GUIDE.md#bounded-props-patterns-and-defaults-19); it does not establish event matching
or complete effective precedence. Full effective props evaluation, private/system runtime inheritance, dynamic or
external consumers and comprehensive scheduled/manual/ad-hoc usage attribution
remain outside this bounded coverage. These limits are not silently relabeled as
complete. See [troubleshooting](TROUBLESHOOTING.md) before relying on an apparent
absence, failed scan or changed evidence status.
