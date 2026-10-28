# Compatibility policy

## Minimum runtime

The project support baseline is **Splunk Enterprise 10.2.5 or later** on a
standalone Linux x86-64 search head, with healthy KV Store and the bundled
Splunk Python runtime. The coordinator declares Python 3.9 and 3.13 support;
installing a separate system Python is not required.

This minimum is a deliberately bounded support policy, not a claim that a
required feature first appeared in maintenance release 10.2.5 or that every
earlier version is incapable of running the app. An earlier beta smoke test on
10.0.1 does not qualify the current review protocol on that release.

The workspace uses native Simple XML hosts, supported REST APIs, KV Store,
ordinary SPL, and Splunk UI Toolkit controls. Modern navigation and its semantic
icons are used where Splunk provides them; 10.4 navigation is not a prerequisite
for the classic-navigation workflow. There is no SPL2 requirement.

Search-head clustering, Windows coordinated review writes, and Splunk Cloud
remain outside the supported deployment scope. Minimum app compatibility also
does not supersede Splunk's operating-system, CPU, licensing, or product-support
requirements. Use a vendor-supported, security-patched maintenance release;
the minimum is not a recommendation to downgrade or remain on an old patch.

## Representative runtime matrix

| Runtime | Purpose | Current evidence |
| --- | --- | --- |
| 10.2.5 | Exact minimum; classic navigation; coordinator and reported regressions | App 1.11.0 build 96: isolated Linux VM at 1280 × 720; fresh bounded/full scans, native/cache/schema and caller/producer comparisons, all seven pages in Light/Dark, keyboard/context checks, real exports and empty Library; owned-VM/control recoveries documented below |
| 10.2.8 | Representative 10.2 maintenance release and real-estate regression | App 1.11.0 build 96 at 1434 × 940: fresh scans/comparisons, all seven pages in Light/Dark, retained literal producer paths and pattern-declaration details, keyboard/context checks and preserved Library evidence/exports |
| 10.4.4 | Modern navigation, current theme host, and newer bundled runtime | App 1.11.0 build 96 at 1434 × 940: fresh scans/comparisons, all seven pages in Light/Dark, new diagnostics, keyboard/context checks, real exports and empty Library; original decisions unchanged |

### 1.11.0 caller-supported qualification

The exact build 96 archive passes 1,107 automated checks, lint/style/types/build
and portable-package gates. Pre-cert AppInspect 4.3.1 reports zero errors,
failures and future failures, with three existing reviewed advisories and one
manifest skip. Trusted-library updates use the existing cache. The main bundle
retains its size advisory (approximately 1.51 MiB).

The same archive was installed on all three runtimes without shared restarts.
Fresh native catalogs, merged props reads, source-hashed offline replay, cached
facts/provenance/counters and all 21 app-owned page definitions agree. All 11
schemas pass validation over 21,104 current object/edge/scan records and the
preserved exported review baseline. Additional synthetic schema contracts check
one positive and seven malformed/oversized receipt cases; these are not native
content. Sequential reads are not atomic snapshots or runtime field evidence.

The captured catalogs contain 16 strict multi-dimension queries across the
representative runtimes, but no qualifying cross-dimension producer/consumer
pair. The new index withholds field-name-only joins and reports zero such links.
Positive cross-dimension semantics, filtering/pagination/drill-through of
supporting callers and props-specific Library cases are automated-only contracts.
No native source fixtures or new review/policy records were created to manufacture
positive evidence. Existing 46 literal producer paths and 24 bounded pattern
declarations remain inspectable; pattern/default/runtime closure is not inferred.

All seven pages pass in Light/Dark with 108 accepted native captures. Native
controls/underlined links, context filtering/pagination, keyboard caller selection,
rapid Escape dismissal/focus restoration and real producer details retain their
qualification. No measured horizontal overflow, graph-label overlap or modal
scope clipping occurs in these captures; minimum sampled active text/link contrast
is 5.78:1. Actual 34 JSON / 32 paired CSV downloads match cached facts, provenance,
required-content witnesses, impact blockers, scan diagnostics and review baselines.
The corrected attribution banner and new caller diagnostics match current cache
versions/counts in both themes on all three runtimes.

Original stages, notes, assignees, captured baselines, review/revision and policy
journals retain their hashes. Original native appearance settings are restored
and read back; captured app browser errors are zero. No customer objects,
source permissions, new accounts, reviews or policies were changed. The owned
minimum-version guest retains its disk, authentication and original read-only
seed and is shut down after qualification.

Qualification retains recovery evidence. The owned emulated guest's 180-second
startup wrapper expired after starting the daemon while waiting for Web; fresh
KV-ready health and native sign-in verified readiness without reset/reseed or
repeating startup. Two multi-action browser-control batches reached their
45/30-second limits during VM navigation. Complete captures/downloads were kept,
the same tab was reconnected, and interrupted/transient steps were freshly
verified with navigation separated from readiness checks. No frozen production
source, application timeout, assertion or source permission was changed. These
representative checks are not zero-timeout, production-latency or full runtime
dependency certification.

### 1.10.0 producer-domain qualification

The exact build 95 archive passes 1,065 automated checks, lint/style/type/build
and portable-package gates. Pre-cert AppInspect 4.3.1 reports zero errors,
failures or future failures; three existing advisories and one manifest skip
retain their documented dispositions. Trusted-library updates use the existing
cache. The main bundle retains its size advisory (approximately 1.50 MiB).

The same archive was installed on all three runtimes without shared restarts.
Fresh native collection, merged props reads, source-hashed offline caller and
producer replay, cached facts/provenance/counters and all 21 app-owned page
definitions agree with the qualified candidate. All 11 public schemas are valid;
21,118 current object/edge/scan records validate against their applicable schemas,
and the preserved exported review baseline remains valid. Sequential observations
are not an atomic configuration snapshot or proof of runtime field availability.

All seven pages pass in Light/Dark with 106 accepted native captures, native
themed links/controls, context filtering/pagination, keyboard caller and modal
focus flows. No measured horizontal overflow, graph-label overlap or modal
scope clipping occurs in those captures. Minimum sampled active text/link
contrast is 5.78:1. Actual 34 JSON reports and 32 paired CSV downloads match the
captured facts, relationships, witnesses, partial coverage and review baselines.
Native Library checks use existing non-props decisions and empty states;
props-specific reviewed-object cases are automated contracts only.

The available native catalogs contain 46 literal-scope producer links and 24
bounded pattern declarations, but no compatible captured pattern/default
producer or caller positives, captured shared defaults, exact source/host
ordering or positive priority/ASCII-collision witnesses. Positive extension,
shadow/namespace/phase/budget and preserved v1–v8 baseline cases are adversarial
automated contracts, not fabricated native objects. No customer expressions,
regex, lookup rows or event samples were executed/read to create witnesses.

One native Indexes collection exceeded its existing 20-second request ceiling;
the app correctly retained the prior complete baseline. A later complete scan
succeeded. An unstable native pagination total was also rejected before a stable
capture passed the comparisons. The emulated guest's cold startup wrapper expired
after daemon start while waiting for Web; fresh KV/browser readiness confirmed
recovery without reset/reseeding. One initial emulated Settings navigation and
one shared bounded-control wait needed fresh settled-state checks. No production
source or timeout changed for recovery. These are disclosed qualification limits,
not a zero-timeout or production-latency certification.

Existing decisions, captured baselines, review revisions and app-policy journals
retain their original hashes. No new native reviews, policies, accounts, source
permissions or customer content were created/changed. Original native appearance
choices were restored and read back; app browser errors are zero on all three
runtimes. The owned guest was gracefully stopped with its disk/authentication
preserved, and its task-owned listeners/tunnel removed.

The [#8 acceptance ledger](STATIC_COVERAGE_ACCEPTANCE.md) defines completion of
the bounded shared-static source-family contract. Full effective/private/system/
file configuration, arbitrary PCRE/encodings, cross-dimension joins without
independent witnesses, rewrites and runtime/external/ad-hoc closure remain
explicit limits. Missing evidence never establishes safe removal.

### 1.9.0 bounded pattern/default qualification

The exact build 94 archive was installed on all three runtimes without shared
restarts. Bounded scans retain the previous full baseline. Fresh complete scans,
GET-only native rule/merged reads, source-hashed offline caller-edge replay and
cache comparisons agree on supported identities, field facts, actual selector
locations, context/conditional-order evidence and counters. Real object, edge
and scan records pass all 11 published schemas; no customer searches or PCRE are
executed to manufacture a matching witness.

There are 103 accepted native captures across all seven pages in Light/Dark,
including object/relationship details, filters, pagination, real pattern labels,
status menus, keyboard caller navigation, focus restoration and rapid Escape
during opening animation. At the viewports above, measured surfaces have no
document/detail horizontal overflow, graph-label overlap or dialog-control
overflow. Sampled active text/links have contrast of at least 5.78:1. Props links
remain native, underlined Splunk UI controls. The new scope labels and budget
qualifications wrap, remain selectable and do not require a new native read on
navigation. These are bounded desktop checks, not comprehensive accessibility
or production-scale certification.

All 29 JSON and 27 paired CSV downloads were independently compared against the
fresh cache, including original review stages, notes, assignees and captured
baselines, compact facts/provenance, partial scope and removal blockers. Original
review/revision and policy-journal hashes are unchanged. Native appearance
choices are restored. No customer content was changed; no new reviews/policies/
accounts or shared restarts were used for qualification. Existing coordinator readiness is
confirmed; earlier permission/concurrency qualification remains separate below.

The catalogs include 24 supported pattern declarations on the representative
maintenance runtime, with zero compatible captured callers and budget-limited
native contexts shown explicitly unverified. None of the three shared catalogs
exposes a default declaration. Positive pattern/default caller ordering,
priority/ASCII collisions, shadowing and props-specific Library cases have
adversarial automated contracts, not synthetic native content. No captured
pattern caller or default is not proof that runtime consumers/defaults are absent.

The emulated minimum-runtime startup wrapper expired while waiting for Web after
the daemon started; a fresh native readiness check then passed on the same
disk/authentication without restarting/resetting the guest. Three Dark initial-
navigation readiness waits also expired. Fresh exact page/root checks and the
complete assertions subsequently passed; navigation and verification were
separated, with no production timeout, code or assertion changed. No app browser
errors were recorded. Those retained recoveries are not a claim of production
timing performance or a zero-timeout emulated run.

The frozen archive passes 1,024 checks: 977 overview, 16 native-host, 22 backend
and nine archive-policy checks, with no failing/skipped cases. Lint, style,
types, branding, build and the metadata-free portable 70-entry package pass.
Pre-cert AppInspect 4.3.1 has zero errors/failures/future failures, three reviewed
advisories and one missing-manifest skip. Trusted-library checking uses the
existing cache; existing bundle-size advisories remain. This is not Cloud
certification. Public screenshots contain only reviewed built-in metadata, with
private host chrome excluded; raw validation reports remain private.

This is a bounded shared static scope extension, not full effective props.
Arbitrary PCRE/modifiers, Windows/encoded/non-ASCII scopes, private/system/file
layers, cross-pattern producer joins, sourcetype rewrites, runtime field
availability/activation/execution and dynamic/external/ad-hoc consumers remain
unverified. Every lower/default/shadowed possible path stays in the graph.
`shared-static-v8` preserves v1–v7 baselines and requires explicit re-review,
never a silent reaffirmation or removal approval. Follow-up #8 remains open.

### 1.8.0 conditional cross-stanza qualification

The same checksum-identified build 93 archive was installed on all three runtimes
without restarting the shared installations. Fresh bounded scans preserve the
previous full baseline. Complete scans, independent GET-only native replay and
cache comparisons agree on supported field identities, native shared bindings,
numeric priority projections, strict caller scopes, cross-stanza observations
and diagnostic counters. Real objects, relationships and scan records pass the
published schemas. No extra native requests are added by cross-stanza comparison.

There are 101 accepted native captures, covering all seven pages in both themes
plus object/context filtering, pagination, open status menus, graph relationships,
keyboard caller drill-through and impact. Both ordinary dialog close and rapid
Escape during the opening animation remove the modal and restore focus. At the
viewports above, measured surfaces have no document/detail horizontal overflow,
graph-label overlap or dialog-control overflow. Sampled active text, including
the new caller links in object details and portals, has contrast of at least
5.78:1. Props drill-through uses native themed, underlined Link controls rather
than inheriting classic host anchor colors. These bounded desktop checks are not
comprehensive accessibility or production-scale certification.

Actual downloads include 29 JSON reports and 27 paired CSV files. Independent
comparisons retain the captured facts/provenance, partial scope and blocked
removal readiness through investigation, impact, required-content, scan and
Library reports. Original decisions, captured baselines, review journals and
app-policy history are unchanged. All native appearance choices are restored.
No new reviews, policies, accounts or customer objects were saved for this slice.

The native catalogs have no exact host/source props rules and no positive
cross-category or same-category priority/ASCII collision witness. They verify real
caller scopes and explicit unknowns, not a fabricated highest-binding example.
Positive collision ordering, shadowing and props-specific Library cases have
adversarial automated coverage. The existing native Library contains a non-props
decision on one runtime and is empty on the other two. Full-catalog limitations
and work ceilings remain unverified and never become absence assertions.

The emulated minimum-runtime host needed a readiness reload after its initial
cold native-dashboard load. Two combined Light caller-navigation waits later
expired although the correct object subsequently rendered without a browser
error. Recorded keyboard activation/focus/contrast and a separate fresh ready-
state, exact-selection and capture check passed; no assertion was removed and
no production timeout was increased. Emulated cold-load timing is not a
production performance claim. Earlier candidates and their findings are retained
privately and are not substituted for final-candidate qualification.

The exact candidate passes 968 automated checks: 921 overview, 16 native-host,
22 backend and nine archive-policy checks, with no skipped/failing cases. Lint,
style, types, branding, production build and metadata-free portable packaging
pass. Pre-cert AppInspect 4.3.1 has zero errors, failures or future failures, with
the same three reviewed advisories and one manifest-related skip. Existing bundle-
size advisories remain; this is not Cloud certification. Earlier native backend
permission/concurrency and policy-lifecycle qualification remains separate below.

This is conditional ordering among compared captured shared exact stanzas for
one declared initial-search conjunction, not full effective props or proof of
event matching. Patterns/defaults, private/system/file layers, sourcetype rewrites,
field availability, runtime activation/execution and dynamic/external/ad-hoc
closure remain unverified. Lower and shadowed possible paths remain in the
graph as removal fallbacks. Coverage policy v7 preserves v1–v6 baselines and
requires explicit re-review, never a silent reaffirmation. Follow-up #8 stays open.

### 1.7.0 shared props qualification

The same checksum-identified build 89 archive was installed on all three runtimes
without restarting the shared installations. Fresh bounded scans preserve the
prior complete baseline. Complete scans and fresh GET-only native replay agree
with cached rule identities, local/inherited observations, source locations and
compact context evidence. Real objects, relationships and scan records pass the
local published schemas. Budget-limited and unsupported-scope contexts remain
explicitly unverified; they are not counted as absent or effective matches.

Calculated fields use the existing native collection route with an escaped exact
stanza/attribute result filter and strict single-result identity checks. This
works through classic Splunk Web without adding an entry-route exposure or
running an event search. The merged props attribute is independently cross-checked.

There are 63 accepted native captures: all seven pages in both themes on each
runtime plus focused object, filtered context, relationship and removal-impact
checks. Measured surfaces have no document/detail horizontal overflow, graph
label/card overlap or dialog-control overflow at the viewports above. Sampled
active text contrast exceeds 4.5:1. Native appearance preferences are restored.
These are bounded desktop checks, not comprehensive accessibility certification.

Actual downloads include 29 JSON reports and 27 paired CSV files. They retain
captured props provenance, partial scope and blocked removal readiness; six
positive required-content investigations use real caller-to-props witnesses.
Existing decisions, captured baselines, review journals and policy history are
unchanged. The native Library contains a non-props decision on one runtime and
is empty on the other two; props-specific Library positives and shadowing
collisions have automated adversarial coverage, not a manufactured native witness.
No reviews, policies, temporary accounts or customer objects were saved for this slice.

The exact release candidate passes 907 automated checks: 860 overview, 16 native
host, 22 backend and nine archive-policy checks, with no skipped/failing cases.
Lint, style, types, branding, production build and portable packaging pass.
Pre-cert AppInspect 4.3.1 reports zero errors, failures or future failures, with
the same three reviewed advisories and one manifest-based skip as 1.6.0. The
existing bundle-size advisories remain; this is not Cloud certification.
Earlier candidates are not substituted for final-candidate evidence. Native test
locator/reload adjustments are separate from production fixes.

This qualifies a bounded shared exact-stanza observation, not full effective props
or byte-for-byte source-file provenance. Private/system inheritance, per-file
layers, cross-stanza priority, runtime activation/field availability and dynamic,
external or ad-hoc consumer closure remain unverified. No dependency confidence
is upgraded to execution, and shadowed paths remain possible removal fallbacks.
Follow-up #8 remains open. Earlier backend permission/concurrency and native
policy lifecycle qualification remains separately documented below.

### 1.6.0 interaction qualification

The same checksum-identified build 85 archive was installed on all three runtimes
without restarting the shared installations. Bounded scans preserve the prior
full baseline. Complete scans, fresh GET-only native catalogs, source-hashed
offline replay and cache comparisons verify the supported interaction identities,
exact namespaces, configured relationships and source locations. Real cached
objects, edges and scan records pass local-only Draft 2020-12 schema checks.
Original review rows, revision journals, captured baselines and app-policy history
remain unchanged. No customer workflow, link or search body was executed.

All three runtimes have targeted Light/Dark checks for navigation graphs,
keyboard-opened relationship context, required-content reporting, removal impact,
Settings and the existing/empty Review Library. The real-content runtime also
exercises grouped report links, group expansion, preserved selected-review
evidence and runtime-inherited/tokenized workflows. A view-removal simulation
identifies its real menu dependent and retains blocked readiness. At the tested
1434×940 desktop viewport, accepted captures have no horizontal document/detail
overflow, label/card overlap or out-of-card graph controls; sampled graph/context
text exceeds 4.5:1 contrast. Native appearance preferences are restored. The owned
minimum-runtime VM is shut down with its disk/authentication preserved.

Actual downloaded JSON payload comparisons, with paired CSV checks where
available, verify native/cache relationship provenance, complete supported
explicit-root footprints, menu-removal consequences, scan count units and
unchanged existing decisions. Configured interactions do not manufacture activity
roots. Historical telemetry stays distinct from current usage evidence.

Shared workflow examples are absent on two runtimes because their native entries
are system-scoped; this is not a failed catalog. Captured search workflows use
tokens or runtime-inherited namespaces. Positive literal static-search namespace
bindings and adversarial syntax/visibility/budget cases have synthetic contracts,
not fabricated native witnesses. One thousand same-name view namespaces are an
indexed unit contract, not an estate-scale benchmark.

The full automated pipeline passes 862 checks (815 overview, 16 host, 22 server,
9 archive), lint/stylelint, types, branding, production build and portable package
checks. AppInspect 4.3.1 pre-cert reports zero errors/failures/future failures,
three existing advisories and one manifest skip; trusted-library updates were
explicitly skipped. Bundle-size advisories remain. Browser ready-state and
native-host loading failures are retained separately from accepted captures.
A pre-publication candidate exposed oversized evidence-heavy snapshot reads
under emulation. Build 85 uses 100-object detail pages while keeping 1,000-record
summary/edge pages and complete identity/relationship checks. No application
timeout was increased; earlier candidates do not qualify this build.

These are targeted interaction checks, not a repeat of backend permission/
concurrency, full accessibility, smaller-viewport or seven-page qualification.
Earlier evidence is described separately below. This does not establish Cloud,
cluster, every workflow syntax or production-scale support.

The supported subset and intentional limits are documented in the
[interaction guide](USER_GUIDE.md#workflow-actions-and-navigation-menus). Neither
literal links nor static workflow bodies prove applicability or execution.
Full effective props, private/system inheritance and dynamic/external runtime
closure remain unverified; #8 stays open. The support minimum is unchanged.
No customer-content write capability or external-network access is introduced.

### 1.5.0 context and policy qualification

The exact release build 82 was installed on the three representative runtimes
above without requiring a restart. Fresh bounded scans preserve the prior full
baseline; complete scans and GET-only native comparisons verify shared identities,
declared automatic-lookup field mappings and possible configuration contexts.
Real cached rows pass local-only Draft 2020-12 schema validation. Original review
rows, journals, stages, notes, assignees and captured baselines remain unchanged.

All seven pages have native Light/Dark smoke checks on Enterprise 10.2.5, 10.2.8
and 10.4.4. Targeted checks cover wrapped lookup mapping disclosures, keyboard-
expanded declaring/invoking-app context, grouped relationship details and exact-
app policy previews at 1280×720 and 1434×940. Sampled new field/dialog text exceeds
4.5:1 contrast; captured graph labels do not overlap cards or one another. Actual
relationship CSV/JSON, removal-impact JSON, an exact-app scope preview and an
existing review-library export agree with the current native/cache evidence.
These are bounded checks, not full accessibility or production-scale certification.

Source-shadow exclusions and ordinary multivalue-expression cases also have
adversarial synthetic contracts. The native captures do not supply every shadow,
expression, future-object or conflicting-decision scenario; no removal of false
native dependency paths is claimed merely from passing those contracts. No new
individual review is saved or reaffirmed solely for this increment.

The full automated pipeline passes 775 checks (728 overview, 16 host, 22 server,
9 archive), lint/stylelint, types, branding, production build and package checks.
Pre-cert AppInspect 4.3.1 reports zero errors/failures/future failures, three known
advisories and one manifest skip. Bundle-size advisories remain. Emulated-VM UI
readiness/download waits needed fresh ready-state checks and a verified download
retry; those failed harness attempts are distinct from accepted captures, without
increasing application timeout limits.

Native own-app policy validation also passes on all three runtimes. Viewer and
reviewer writes are denied; operator writes use server attribution. Changed
fingerprints, stale previews and spoofed attribution are rejected without saved
rows. Six competing edits accept one revision and reject five stale parents;
exact replay creates no duplicate, and changed-content replay is rejected.
Installed Light/Dark dialogs exercise scope confirmation, save, disable and
reactivation. Native history and required-content CSV/JSON, impact JSON and final
recoverable archive readback pass. These checks add 42 parsed downloads and 40
accepted captures; an initial capture that raced document readiness is excluded.

The policy contributes 17 own-app roots while active and zero while disabled.
Removal-impact protection clears after archival without changing the dependency
score or affected-object set. Candidate policy-filter checks supply no positive
cleanup candidates in this own-app scope, so no live conflicting individual
decision is invented. New/deleted/renamed-object and
individual-stage conflict behavior is covered by synthetic contracts, not
claimed as a native witness. All original individual review data remains
unchanged, temporary role accounts are removed, test policy history is archived
and native appearance preferences are restored. The isolated VM is shut down
with its disk and authentication preserved.

Workflow actions, navigation menus, full effective props precedence,
private/system inheritance, dynamic expressions and observed lookup execution
remain outside this bounded #8 slice. Same-name app reinstallation cannot always
be distinguished using native metadata and requires explicit scope review.

### 1.4.0 extraction-output qualification

The exact release build 79 archive was installed without a restart on all three
representative runtimes. Fresh bounded checks retained the prior full baseline;
complete scans, native catalog/cache attribution, declaration positions, potential
edge provenance and local JSON Schema comparisons passed. Original review rows,
revision journals and captured baselines remained unchanged through installation,
scanning and UI/export checks. Native appearance preferences were restored.

| Runtime | Attributed shared inline definitions | Attributed shared transforms | Observed complete-scan duration |
| --- | ---: | ---: | ---: |
| 10.2.5 | 22 | 0 eligible examples | 33.691 seconds |
| 10.2.8 | 39 | 77 | 14.499 seconds |
| 10.4.4 | 21 | 0 eligible examples | 4.572 seconds |

These are single lab observations, not load-time promises or production-scale
benchmarks. The 10.2.8 transform set includes 22 named-REGEX, 54 literal-FORMAT
and one DELIMS/FIELDS attribution. On the other two estates, existing shared
transforms remain excluded by their index-time/routing configuration rather than
fabricating search-time outputs. Non-default inline source clauses were absent
from these native captures and are covered by adversarial synthetic contracts.

Targeted native light/dark checks cover inline details, persistent graph context,
wrapped output locations, field-name disclosure and existing/empty Review Library
states on all three runtimes. The larger estate additionally exercises transform
attribution, matched producer context and a 16-position declaration list in both
themes. Tested desktop viewports were 1280×720 and 1434×940; captured field facts
had no horizontal overflow, graph labels did not overlap cards/other labels, and
sampled field/label text contrast exceeded 4.5:1. New field-specific Library
review/baseline rendering uses both-theme synthetic contracts; no live review was
created or reaffirmed solely to test it.

Two cold page loads in the emulated minimum-version VM reached the existing
20-second inventory-read timeout. Warm retries passed without increasing request
limits or replaying a scan; the failed attempts are retained separately from
accepted captures. This is not evidence of production load-time performance.

Actual CSV/JSON downloads are compared with the native cached identities/facts,
potential edge provenance, required-content witnesses, removal impact and retained
review stages. Impact remains blocked where coverage is incomplete. All 680
automated checks pass (643 overview, 16 host, 12 server, 9 archive), along with
lint/stylelint, types, branding, production build and portable-package checks.
AppInspect 4.3.1 pre-cert reports zero errors/failures/future failures, three
reviewed warnings and one manifest skip, with the existing trusted-library cache
explicitly used without updating it. These checks are not Cloud, full
accessibility, backend-concurrency or production-scale certification.

The native-qualified release SHA-256 is
`63946c830f18d0734c4277c1c8dfbffaa75e43e430458c2c947b884c3777432d`.
The published 1.3.0 archive is preserved unchanged. Release 1.4.0 does not make
broader #8 coverage complete. PCRE compilation,
matching, field values, full effective props precedence and dynamic outputs remain
unverified; customer content stays read-only.

### 1.2.0 coverage increment

The same checksum-identified build 69 candidate was installed without a restart
on all three representative runtimes. Native `data/props/lookups` GET catalogs,
rule/definition relationships, potential callers, resolved endpoints and original
review records were independently checked against real installed content.
Dependency Explorer, removal impact, required-content reporting and Review
Library were exercised in light and dark modes; layouts and controls were checked
at the observed desktop viewports. A real three-hop rule/definition/CSV chain
retained potential status in details and downloaded CSV/JSON, with exact identity
parity. A representative downloaded removal-impact JSON retained conditional
paths and execution caveats. These are targeted feature checks, not a repeat of
all seven-page, accessibility or backend permission/concurrency qualification.

The emulated minimum-version VM hit a bounded persistence timeout during warm-up
and one bounded inventory-read timeout. It retained its previous baseline and
showed the failure rather than substituting data. A fresh complete scan and
subsequent view checks passed without relaxing request limits. This VM is
functional compatibility evidence, not production performance qualification.
Shared real-estate scans and source catalogs completed without these failures.
No review decisions or customer knowledge objects were changed for this increment;
native user theme preferences were restored after testing.

### 1.2.0 graph-readability qualification

The graph-readability increment has targeted native-browser checks on Enterprise
10.2.8 and 10.4.4 in both themes: wrapped long names, opaque relationship labels,
keyboard previews, full object/relationship context, focus return, dense-group/member
pagination, captured evidence/source locations and contained graph zoom. Final
build 72 repeated both-theme context checks on both runtimes after correcting
background-preview layering; dense-group pagination and graph zoom also retain
their earlier increment checks and automated regressions. These UI-only checks
reuse the existing cached inventory; they do not repeat minimum-version VM,
backend, permission, export or accessibility qualification. The build 69 minimum
runtime evidence above remains distinct. Test-harness timing improvements do not
change the final build 72 production payload or its review-persistence protocol.

The 1.2.0 automated release gate passes 348 checks: 312 overview tests, 15 native
host tests, 12 backend tests and 9 archive-policy tests, with no skipped test cases or
increased UI timeouts. Lint, type checks, branding, production build and package
verification pass. Pre-cert AppInspect reports zero errors, failures or future
failures, with three reviewed advisories (native SplunkJS telemetry, the legacy
Python-migration notice and KV Store configuration); one `app.manifest`-based
check is skipped. The build retains webpack's
bundle-size advisories. These are release checks, not Splunk Cloud certification
or a production-scale performance benchmark.

### 1.3.0 dependency-accuracy qualification

Release build 77 is the final qualified artifact. Builds 73/74 below are earlier
event/tag milestones, not separate released versions or installed field coverage.

Checksum-identified candidate **build 73** was installed without a restart on
Enterprise 10.2.5, 10.2.8 and 10.4.4. All native collectors completed; shared
event-type/tag identities, disabled assignments, native-versus-normalized counts
and edge provenance were independently compared with GET-only native catalogs.
The analysis correctly remains partial for unsupported system inheritance,
encoded tag values, implicit classification and invoking-app ambiguity. Complete
collection is not complete dependency coverage.

Targeted native-browser checks cover Explorer drill-down, full context, grouped
expansion, keyboard graph pan, pagination, required-content reporting and Review
Library in light/dark modes. Actual downloaded relationship, impact, required-
content, coverage, scan and review CSV/JSON files were parsed and compared.
Existing decisions, revisions and saved evidence remained unchanged; new policy
coverage can require re-review. Empty libraries stayed empty. These are bounded
feature checks, not a new full accessibility, backend-concurrency or production-
scale qualification.

The exact build 73 release-preparation pipeline passed 450 automated checks,
lint, types, branding, production build and package verification. Pre-cert
AppInspect reported zero errors, failures or future failures, three known
advisories and one skipped manifest check, using the existing trusted-library
cache without updating it. Bundle-size advisories remain.

Candidate **build 74** verifies the follow-up status/impact wording and public
schema contracts. Its full release-preparation pipeline passes 525 checks with
the same AppInspect advisory scope. Fresh full scans, native/cache identity and
state parity, original-review preservation and targeted light/dark Explorer,
required-content and Library checks pass on all three representative runtimes.
Rendered modes were checked explicitly rather than assuming a default preference
meant light. Actual CSV/JSON verifies scan-count units, complete filtered export
scope, potential-path propagation and the broadening consequence of a potential
exclusion. Bounded graph expansion/pagination and full context retain their
layout/contrast checks; native user appearance preferences were restored.

Draft 2020-12 validation of real cached rows and the preserved exported baseline
also passes against local-only schema references. These are data-contract checks,
not a change to the server review protocol. Builds 73/74 do not contain installed
field coverage.

Field-lineage release **build 77** passes the full 588-check pipeline, including
decoder/matcher, persistence, cross-view, both-theme synthetic and dense-budget
regressions. Its exact archive passes package verification and pre-cert
AppInspect with zero errors, failures or future failures and the same three
known warnings and one manifest skip. Fresh bounded/full scans complete all 18
collectors on Enterprise **10.2.5, 10.2.8 and 10.4.4**. Independent GET-only native
comparisons verify shared identities, ACL/state, normalized versus native counts,
compact field facts, ordered REPORT bindings and phase-qualified potential paths.
Real cached rows and preserved historical evidence pass local-only schema checks.

Targeted native light/dark checks cover field details, wrapped graph labels,
expanded relationship provenance, long-name disclosure and the existing Review
Library. Actual relationship, required-content, impact, scan and review downloads
retain identity, field provenance and conditional/partial qualifications. Original
review stages, notes, revisions and evidence baselines remain unchanged. Native
field-specific Library saves were not added solely for validation; that rendering
and export contract is covered by synthetic tests and the reused native detail
component. Existing libraries were inspected without saving or reaffirming them.

Classic runtimes receive one exact GET-only Web exposure for the calculated-field
catalog. It activates through normal app installation without a restart; source
ACL enforcement and the review backend are unchanged. No source-write methods,
roles or capabilities are added. A cached-read timeout during an emulated
minimum-version theme reload recovered after a healthy-state check and fresh
reload; its failed attempt is retained separately, not counted as a passing run.
These remain bounded compatibility checks, not full accessibility, Splunk Cloud,
new backend-concurrency or production-scale certification. Unsupported expressions,
regex outputs, effective precedence and implicit invocation remain explicit gaps.
The 1.3.0 release uses the exact checksum-identified build 77 archive.

### Earlier 1.1.1 qualification

The same checksum-identified 1.1.1 archive was installed on all three runtimes
without a restart. Inventory identities, published object/relationship counts,
resolved endpoints and original review rows were independently checked. No new
review records were saved for this UI/packaging patch. The coordinator,
permission boundaries, request-size enforcement and concurrent-write protocol
are unchanged; their exact-minimum runtime qualification was performed with
1.1.0 build 64, not repeated as new backend testing for 1.1.1. Native launcher
icons and classic/modern navigation also retain that earlier qualification.

An isolated VM exercises actual installed Splunk content and telemetry, not a
packaged demonstration dataset. Its small inventory and short event history do
not qualify large-estate performance or establish inactivity. An emulated VM
provides functional compatibility evidence, not a production benchmark or
vendor certification of the host architecture.

The 1.1.1 minimum-version browser pass confirmed required-content CSV and JSON
downloads end-to-end. Parsed object identities matched across formats; JSON
matched the live published scan identity and retained coverage gaps and traversed
relationships. The earlier 1.1.0 pass also qualified environment-summary CSV/JSON.
This is representative export evidence, not a claim that every browser, export
context, or dataset size was exercised.

## Bounded accessibility checks

The 1.1.1 pass covered all seven pages in both themes on each representative
runtime, with targeted 1024px layouts and an actual native Chrome 200% zoom pass
in light/dark mode. The zoom check found and verified a fix for compressed page
headings. Native keyboard checks exercised dropdown selection, an export menu,
review text entry, confirmation-button focus, keeping a draft and discarding
only that unsaved draft. An operator confirmed VoiceOver announced the report
heading and the Starting set control's name/value on the minimum runtime.

The app uses native Splunk UI Toolkit controls and theme tokens. Button colors
change without intermediate foreground/background interpolation. These targeted
checks are not a formal WCAG audit, full assistive-technology/browser matrix, or
certification of Splunk's own navigation chrome. At increased zoom the classic
Splunk toolbar can wrap independently of the app; the app does not override the
host toolbar's layout or colors.

## Maintenance releases are not individual release gates

- Within a qualified minor-version family, maintenance releases at or above
  the minimum are expected to be compatible unless a specific regression or
  documented breaking change is identified. They do not each require their own
  VM before the app can ship.
- Keep the exact tested versions visible. Do not label an untested patch as
  individually runtime-verified, or mistake that evidence gap for a known app
  incompatibility.
- Test the minimum and a representative modern-navigation runtime for changes
  affecting shared platform contracts. The existing 10.2 maintenance lab remains
  useful for real-data regression work; it is not a requirement to duplicate
  every test on every patch.
- Add one representative runtime when a new minor/major family changes a
  relevant contract: native navigation, theme/JavaScript hosting, bundled Python,
  REST configuration, KV Store, or permissions. A new major version is not
  automatically qualified merely because its version number exceeds the floor.
- A reproducible compatibility defect must be fixed or explicitly excluded.
  Reporter confirmation is useful, but an untested maintenance revision alone
  does not block a release or negate a fix validated against the same contract.

## Baseline qualification checklist

Use the exact release archive and record its checksum. Verify:

1. Fresh installation, effective REST configuration, and healthy KV Store.
2. Honest empty state, bounded/full scans, unique identities, valid relationship
   endpoints, and permission/partial-coverage disclosures.
3. Real usage collection with short retention remaining partial/unavailable,
   rather than being interpreted as unused content.
4. Viewer/reviewer/operator boundaries, coordinator request-size limits,
   concurrent saves, stale-write rejection, archive/restore and revision history.
5. Exact dependency targeting and reload, including names with spaces; no
   substitution when the requested target is unavailable or filtered out.
6. All seven native pages, light/dark workspaces, review dialogs, dependency
   investigation, required-content reporting, and representative CSV/JSON exports.
7. Preserved existing decisions and no customer-object writes; remove only
   explicitly temporary app-local test state after retaining private recovery
   evidence.

Keep credentials, host details, VM images, raw inventories and validation reports
out of the public repository. Publish only sanitized outcomes and limitations.

See [Installation](INSTALLATION.md), [Release process](RELEASE.md), and the
official [Splunk 10.2 REST handler configuration reference](https://help.splunk.com/en/splunk-enterprise/administer/admin-manual/10.2/configuration-file-reference/10.2.0-configuration-file-reference/restmap.conf).
