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
| 10.2.5 | Exact minimum; classic navigation; coordinator and reported regressions | App 1.3.0 build 77: isolated Linux VM; fresh bounded/full scans, native catalog/cache and schema parity, field/dependency investigations and CSV/JSON in light/dark; earlier broader 1.1.1 checks remain distinct below |
| 10.2.8 | Representative 10.2 maintenance release and real-estate regression | App 1.3.0 build 77: real-data scans, native catalog/cache and schema parity, targeted light/dark field/dependency/Library investigations and exports; original decisions unchanged |
| 10.4.4 | Modern navigation, current theme host, and newer bundled runtime | App 1.3.0 build 77: real-data scans, native catalog/cache and schema parity, targeted light/dark field/dependency/Library investigations and exports; original decisions unchanged |

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
