# Shared static dependency coverage — #8 acceptance

Issue #8 evaluates additional shared knowledge-object sources. Its completion
means the bounded, documented static contracts below are implemented and
qualified. It does **not** mean every possible Splunk dependency is discoverable,
effective configuration is reconstructed, or an object is safe to remove.

Qualified in [1.10.0 build 95](COMPATIBILITY.md#1100-producer-domain-qualification):
1,065 automated checks, all seven pages on three representative runtimes in
Light/Dark, exact native/cache/export comparisons and unchanged decision history.

## Source-family disposition

| Requested source | Supported result | Explicit boundary |
| --- | --- | --- |
| Event types | Literal inclusion/exclusion filters and exact shared identity | Implicit classification and dynamic filters are unverified |
| Tags | Distinct shared field/value/tag assignments and literal references | Encoded/wildcard semantics and actual classification are unverified |
| Extractions | Named capture declarations and REPORT targets/order/output attribution | No PCRE execution, regex validity or runtime values |
| Aliases | Literal AS/ASNEW assignments and potential earlier-phase producers | No same-phase alias chain or proven field availability |
| Calculated fields | Bounded input names and literal outputs; potential earlier phases | No EVAL execution, same-phase chains or dynamic output guesses |
| Transforms | Supported named captures, literal FORMAT/FIELDS and REPORT provenance | No index-time routing, regex execution or inferred dynamic outputs |
| Automatic lookups | Exact definition/file bindings, input/output mappings and potential callers/producers | No lookup rows, enrichment execution or lookup-output chains |
| Workflow actions | Literal internal targets and supported static search references | Never follow external/POST links, substitute event tokens or claim clicks |
| Navigation menus | Exact named views/reports and supported internal routes | Dynamic menus, inherited built-ins and query/fragment consumers stay partial |
| Implicit props | Shared native attribute cross-checks, conditional same-attribute ordering, bounded literal/`*`/`...` callers and declared producer-domain compatibility, captured default fallbacks | Not full effective props; hidden layers, arbitrary PCRE, rewrites and activation remain unverified |

The [coverage matrix](DEPENDENCY_COVERAGE.md) and [user guide](USER_GUIDE.md)
define the actual syntax, namespace and investigation contracts. Collection is
limited to native metadata already visible to the scanning identity. A source
family being supported does not make its entire catalog or parser complete.

## Acceptance boundaries and evidence

| #8 boundary | Implementation / verification |
| --- | --- |
| Collection, parsing and resolution remain separate | Native page counts/caps, per-source gaps, exact target resolution and coverage dimensions remain independent; denied/unstable/unsupported/budget-limited states are not absence |
| Exact identity, namespace and provenance | Qualified native identities, private/local shadow checks, declaration locations, REPORT positions and both producer/consumer scopes; app containment is never closure |
| Partial/unresolved propagates | Potential/unknown paths and coverage limitations reach Explorer, required-content witnesses, removal-impact blockers and actual CSV/JSON exports |
| Preserve decisions and explicit freshness | The 1.10 qualifying scans use `shared-static-v9`; v1–v8 baselines remain readable; stages, notes, assignees, reviews and policy journals are not rewritten or silently reaffirmed |
| Adversarial and scalable qualification | Automated namespace/private/cycle/phase/scale/pattern/budget/schema/UI contracts, followed by exact-archive native/cache checks and Light/Dark flows on representative supported runtimes |
| Customer content stays read-only | No customer searches/regex/expressions/actions executed for inference; no source writes, permission expansion or hidden-content collection; only existing app-local scan/cache workflow writes |

The exact released build and observed native witnesses are recorded in
[compatibility](COMPATIBILITY.md). Automated positive contracts are not presented
as native event/configuration witnesses when those cases are absent from the
available catalogs.

## Deliberate limits after #8

These remain visible uncertainty, not unfinished promises of complete closure:

The separately scoped 1.11 increment adds strict captured-caller support for
different dimensions; it does not reopen #8 or remove the unwitnessed-join limit.

- Arbitrary PCRE/modifiers, escaped Windows paths, encoded/non-ASCII and
  oversized props patterns. Unsupported is not disjoint or unused.
- Cross-dimension producer joins without independent caller evidence. A common
  field name alone cannot join every host, source and sourcetype in the estate.
- Full effective file/private/system configuration, atomic snapshots,
  sourcetype rewrites, activation and actual field availability/execution.
- Dynamic/embedded/external/ad-hoc consumers and scheduled-versus-manual usage
  attribution. Existing telemetry is not relabeled to imply those distinctions.

Expanding these requires separately scoped evidence designs and qualification,
not broader customer permissions or executing customer expressions to make a
coverage indicator green. All current partial/unknown/removal blockers remain.
