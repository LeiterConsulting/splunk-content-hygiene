# Installation

## Compatibility

The support baseline is Splunk Enterprise **10.2.5 or later** on a standalone
Linux x86-64 search head with healthy KV Store. The minimum is a project support
boundary, not a claim that earlier patches lack a required feature. See the
[compatibility policy](COMPATIBILITY.md) for representative testing and how
maintenance releases are treated. Current runtime evidence is:

| Version | Validation |
| --- | --- |
| 10.2.5 | Isolated Linux VM: installation/KV Store, bounded/full inventory, usage coverage, dependency targeting, review concurrency/permissions, all seven pages in light/dark, and representative CSV/JSON delivery |
| 10.2.8 | Installed; all seven views, light/dark themes, real-data scan, review/bulk workflow, graph/impact, required-content report, and exports |
| 10.4.4 | Installed; all seven native-navigation views, expanded/collapsed sidebar, home launcher and app-switcher icons, light/dark workspace, real-data graph/impact, app-local review/bulk workflow, required-content report, and exports |
| 10.0.1 | Historical beta smoke test only; below the current 10.2.5 support floor and not qualification of the current review protocol |

Review coordination requires a standalone POSIX search head with
Splunk's Python 3 runtime. Search-head clusters and Windows coordinated writes
are unsupported; the endpoint fails closed rather than claiming cross-host
serialization. Keep all review editors on the matching app version.

This is not certification of every 10.x release, Splunk Cloud, or search-head
clustering. The workspace now mounts in a standard Simple XML host and keeps
Splunk's native chrome. It no longer packages a custom Mako template or needs
a server-wide template exception. The empty dashboard header is collapsed only
inside the app host; native Splunk navigation and account controls remain intact.
Modern navigation uses visually verified 10.4-compatible semantic icons. See
[Branding](BRANDING.md) for image placements and native asset-cache
troubleshooting after installation or upgrades.

Use a desktop viewport of at least 1024 pixels for full native Splunk navigation.
The app workspace reflows at narrower widths, but classic Splunk's own navigation
retains a wider minimum canvas. Narrow viewport checks do not substitute for
manual browser/text-zoom accessibility acceptance.

Install on a non-production search head first. KV Store must be
available.

## Verify the download

Download the release archive and `SHA256SUMS` into the same directory:

```bash
shasum -a 256 -c SHA256SUMS
```

The check must report `OK` before installation.

## Install with Splunk Web

1. Sign in as a Splunk administrator.
2. Open **Apps > Manage Apps > Install app from file**.
3. Upload the versioned `content_hygiene-*.tar.gz` package.
4. Restart Splunk only if the installation workflow requests it.
5. Open **Splunk Content Hygiene > Settings & Scan Status**.
6. Confirm that the app reports no cached data rather than sample results.
7. Run a bounded live scan.
8. Review collector warnings, then run a complete live scan.
9. Select a 30/90/180-day window and run **Collect usage evidence**. Access to
   `_audit` and `_internal` determines which telemetry sources can establish
   coverage; unavailable sources remain visible and do not produce inactivity
   conclusions.

## Upgrade

Install the newer archive through Splunk's app-management workflow and allow the
existing app to be upgraded. Do not delete the installed app directory first:
the app-owned KV Store contains scan and review state that should survive an
upgrade.

Back up the Splunk deployment according to your normal change-control process
before upgrading. Afterward, confirm the displayed app version, load the
existing Review Library, assign the appropriate hygiene roles, and run a fresh
complete scan. Version 0.4 does not trust legacy mutable snapshots as a baseline.
It rebuilds the derived cache without changing existing reviews. After a
verified snapshot publishes, legacy derived evidence is retired. Export any
old reports required for your retention policy before upgrading.

Version 0.5 adds review-evidence fingerprints to new scans. Old reviews remain
unchanged and show Cannot verify until a reviewer explicitly captures a supported
baseline. Reaffirmation does not make partial evidence complete. The native entry
script has a build-specific filename, so upgrades do not require refreshing the
server-wide static cache merely to obtain the matching app JavaScript.

Version 1.0 keeps `ch_reviews` unchanged as the legacy decision source. New edits,
captures, archives, and restores are inserted into `ch_review_revisions`. There
is no destructive migration. Both collections are required for recovery. Back
them up together using your supported Splunk KV Store backup process; a CSV or
filtered Library export is a report, not a complete journal backup.

After upgrading from 0.5, run a fresh complete scan. Evidence and fingerprint
policies are versioned; old decisions remain visible, but old unscoped evidence
cannot silently become Current. Review the four coverage dimensions, save any
form edits, then explicitly reaffirm. A normalization-policy upgrade is not
reported as definite proof of a configuration edit.

Close old editing tabs before upgrading. Non-administrator reviewer/operator
roles can no longer write `ch_reviews`; their new writes use the journal. An old
administrator client can still change a legacy origin directly. The new app
detects that divergence and blocks subsequent edits until the records are
reconciled. Do not downgrade and edit reviews with an older client: it cannot
understand journal-only decisions. See [Troubleshooting](TROUBLESHOOTING.md).

## Uninstall

Removing a Splunk app can remove its app-owned KV Store data. Export any review
or scan reports needed for retention and follow the supported uninstall process
for your Splunk deployment. The app does not modify the customer knowledge
objects it inventories.

## Initial verification

- All seven navigation pages load without browser-console errors.
- **Settings & Scan Status** identifies the data source as live Splunk data.
- A bounded scan completes or reports actionable permission warnings.
- A complete scan persists objects, relationships, findings, owners, and scan
  metadata.
- A usage scan persists only derived activity counts, timestamps, source
  coverage, and provenance in app-local KV Store. It does not persist raw SPL
  or actor lists.
- A disposable app-owned review can be saved, reloaded, exported, archived,
  restored, and inspected in revision history.
- A second editor receives a conflict instead of replacing a newer decision.
- Archiving the review does not change the referenced Splunk object.
