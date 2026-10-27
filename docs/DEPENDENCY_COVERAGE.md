# Dependency coverage and interpretation

Content Hygiene maps a bounded shared configuration graph. It does not execute
customer searches, expressions, regex or workflow actions to prove dependencies.
No missing edge, usage gap or review stage authorizes removal.

## Supported sources

The workflow/navigation rows below are in 1.6.0 build 84. See the
[compatibility policy](COMPATIBILITY.md#160-interaction-qualification) for its exact
qualification and publication status; older release evidence is separate.

| Source family | Supported evidence | What it does not establish |
| --- | --- | --- |
| Saved searches, reports, alerts, macros, dashboards and data models | Supported literal lexical references, namespace/arity resolution and declared source locations | Full SPL semantics, generated/tokenized queries, execution or every external/embedded caller |
| Automatic lookup rules | Literal definition/file bindings, explicit input/output mappings and potential callers from compatible exact original-event selectors | Effective props precedence, actual enrichment, runtime field availability or complete implicit closure |
| Event types and tag assignments | Supported literal inclusion/exclusion filters and distinct shared field/value/tag assignments | Implicit event classification, wildcard/encoded-value reinterpretation, system inheritance or actual matching |
| Extraction, alias, calculated-field and transform definitions | Bounded declared field names, supported output attribution, ordered REPORT positions and potential compatible input paths | PCRE validity/matching, expression execution, full field-phase availability, dynamic outputs or cross-scope effective configuration |
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

Removal impact is a read-only simulation, not a cleanup command. New menu/report
links can expose affected destinations and preparation steps; partial coverage,
protection, unknown usage or unresolved evidence still blocks readiness. Perform
any customer-content change through a separate approved administration process.

## Existing decisions and later scans

Version 1.6 scans use `shared-static-v5`. Policies v1–v4 remain readable, with
stages, notes, assignees, captured baselines and revision history unchanged.
Expanded evidence can request **Needs re-review**; only an explicit review action
can reaffirm a decision. Inventory scans never migrate or rewrite saved choices.

Full effective props evaluation, private/system runtime inheritance, dynamic or
external consumers and comprehensive scheduled/manual/ad-hoc usage attribution
remain outside this bounded coverage. These limits are not silently relabeled as
complete. See [troubleshooting](TROUBLESHOOTING.md) before relying on an apparent
absence, failed scan or changed evidence status.
