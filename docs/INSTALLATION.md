# Installation

## Compatibility

The `0.4.0-beta` hardening package requires Splunk Enterprise with KV Store.
The current validation scope is deliberately specific:

| Version | Validation |
| --- | --- |
| 10.2.8 | Installed; all six views, light/dark themes, real-data scan, review workflow, graph/impact, and exports |
| 10.4.4 | Installed; all six native-navigation views, expanded/collapsed sidebar, home launcher and app-switcher icons, light/dark workspace, real-data graph/impact, app-local review workflow, and exports |
| 10.0.1 | Earlier beta smoke test, not repeated for this host migration |

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

Install the beta on a non-production search head first. KV Store must be
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
3. Upload `content_hygiene-0.4.0-beta.tar.gz`.
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

## Uninstall

Removing a Splunk app can remove its app-owned KV Store data. Export any review
or scan reports needed for retention and follow the supported uninstall process
for your Splunk deployment. The app does not modify the customer knowledge
objects it inventories.

## Initial verification

- All six navigation pages load without browser-console errors.
- **Settings & Scan Status** identifies the data source as live Splunk data.
- A bounded scan completes or reports actionable permission warnings.
- A complete scan persists objects, relationships, findings, owners, and scan
  metadata.
- A usage scan persists only derived activity counts, timestamps, source
  coverage, and provenance in app-local KV Store. It does not persist raw SPL
  or actor lists.
- A test review record can be saved, reloaded, exported, and removed.
- Removing the review record does not change the referenced Splunk object.
