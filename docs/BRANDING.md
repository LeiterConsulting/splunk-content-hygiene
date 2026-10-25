# Branding and native navigation

![Content Hygiene](images/content-hygiene.svg)

The original app mark combines a small dependency graph with a magnifier. It
represents investigation, not automatic deletion. The vector sources and
geometric lettering are included under this repository's MIT license; there
are no external fonts or stock-art dependencies.

## Classic launcher and app bar

The app ships these RGBA PNGs in both `static/` (launcher/package metadata) and
`appserver/static/` (Splunk Web). Each pair is byte-identical.

| File | Dimensions | Placement |
| --- | --- | --- |
| `appIcon.png` | 36 × 36 | App icon |
| `appIcon_2x.png` | 72 × 72 | High-density app icon |
| `appIconAlt.png` | 36 × 36 | Alternate menu placement |
| `appIconAlt_2x.png` | 72 × 72 | High-density alternate placement |
| `appLogo.png` | 160 × 40 | App-bar wordmark |
| `appLogo_2x.png` | 320 × 80 | High-density wordmark |

`Alt` denotes Splunk's alternate placement, not a dark-mode switch. The
packaged wordmark has its own navy surface and white lettering, so it remains
readable on either native theme. Separate transparent light/dark SVG wordmarks
are available in `appserver/static/brand/` for appropriately themed uses.

## Modern navigation (10.4+)

Splunk owns the native header and navigation. The app does not draw a legacy
header over modern navigation or hide native chrome. `default.xml` supplies
semantic icons from the lowercase 10.4-compatible icon list: overview,
investigation, relationships, required-content report (`filechart`), review
notebook, ownership, and settings.
Classic Splunk retains its normal text navigation.

The React workspace mounts into a standard Simple XML HTML panel. It inherits
the signed-in user's theme and does not require a custom Mako template or a
server-wide template/security exception. The host contains no search panel or
automatic search; inventory and usage collection remain explicit actions.

## Validation and asset-cache troubleshooting

Classic branding delivery is verified on Splunk Enterprise 10.2.8. The seven
modern navigation-item icons (including the 1.1 required-content report),
expanded/collapsed sidebar, home launcher, app switcher, and light/dark workspace
are browser-verified on 10.4.4. All six
native branding variants match the packaged PNGs through both shared and
signed-in-user namespaces; the Web static copies also match.

One tested installation retained cached system fallback images after the app's
branding was installed. Correct file bytes, permissions, and Web delivery were
verified first. An app-scoped metadata reload and a static cache refresh did
not resolve the native endpoint; an administrator-approved Splunk restart did.
This is an installation-specific observation, not a requirement to restart
every 10.4 system.

If launcher images remain generic after an update, verify the root `static/`
files and their readability before arranging an approved restart. The app does
not automatically clear shared caches, restart Splunk, replace native chrome,
or change server-wide security settings.

## Reproducibility

From `app/`, run `yarn branding` to regenerate the assets from
`assets/branding/icon.svg` and `scripts/branding.mjs`. Run
`yarn branding:verify` to check that every versioned output matches its source.
Package verification additionally checks all PNG dimensions, transparency,
directory placement, and the native dashboard-host contract.

## References

- [Splunk app properties and icon locations](https://dev.splunk.com/enterprise/docs/developapps/manageknowledge/configureappproperties/)
- [Splunk 10.4 modern navigation and supported icons](https://help.splunk.com/en/splunk-enterprise/release-notes-and-updates/release-notes/10.4/modern-navigation-ui-changes)
- [Simple XML dashboard reference](https://help.splunk.com/en/splunk-enterprise/create-dashboards-and-reports/simple-xml-dashboards/9.1/simple-xml-reference/simple-xml-reference)
- [Splunk customization and asset caches](https://help.splunk.com/en/splunk-enterprise/developing-views-and-apps-for-splunk-web/10.4/customize-splunk-web/customization-options-and-caching)

See [Installation](INSTALLATION.md) for the versions actually validated; native
navigation support is not a claim of certification on every later version.
