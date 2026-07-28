# Installation

## Compatibility

The `0.2.1-beta` package has been built, AppInspect pre-certified, installed,
and browser-smoke-tested on Splunk Enterprise 10.0.1. Broader Splunk Enterprise
10.x and Splunk Cloud certification remains pending.

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
3. Upload `content_hygiene-0.2.1-beta.tar.gz`.
4. Restart Splunk only if the installation workflow requests it.
5. Open **Splunk Content Hygiene > Settings & Scan Status**.
6. Confirm that the app reports no cached data rather than sample results.
7. Run a bounded live scan.
8. Review collector warnings, then run a complete live scan.

## Upgrade

Install the newer archive through Splunk's app-management workflow and allow the
existing app to be upgraded. Do not delete the installed app directory first:
the app-owned KV Store contains scan and review state that should survive an
upgrade.

Back up the Splunk deployment according to your normal change-control process
before upgrading. Afterward, confirm the displayed app version, load the
existing Review Library, and run a fresh bounded scan.

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
- A test review record can be saved, reloaded, exported, and removed.
- Removing the review record does not change the referenced Splunk object.
