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
| 10.2.5 | Exact minimum; classic navigation; coordinator and reported regressions | App 1.1.0 build 64: isolated Linux VM; core scan/dependency/review/permission workflows, native icon bytes, seven pages in light/dark, targeted 1024px layouts, and representative CSV/JSON delivery |
| 10.2.8 | Representative 10.2 maintenance release and real-estate regression | App 1.1.0 build 64: real-data scans, review/bulk workflow, graph/required-content report, exports, light/dark |
| 10.4.4 | Modern navigation, current theme host, and newer bundled runtime | App 1.1.0 build 64: native icons/navigation, real-data workflows, exports, light/dark |

An isolated VM exercises actual installed Splunk content and telemetry, not a
packaged demonstration dataset. Its small inventory and short event history do
not qualify large-estate performance or establish inactivity. An emulated VM
provides functional compatibility evidence, not a production benchmark or
vendor certification of the host architecture.

The 10.2.5 browser pass confirmed representative environment-summary CSV and JSON
downloads end-to-end. The saved files were parsed and checked against inventory
counts; the JSON also matched the live published scan identity and preserved
partial-analysis disclosures. This is representative export evidence, not a
claim that every browser, export context, or dataset size was exercised.

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
