# Development and testing

## Requirements

- Node.js 22 or newer
- Yarn 1.22
- Python 3.9 or newer for standard-library coordinator tests
- A supported `tar` command for release packaging
- Splunk AppInspect for pre-release certification checks
- A non-production Splunk Enterprise environment for integration testing

The project does not require an `.env` file to build. Keep any local Splunk URL
or credential configuration outside version control.

## Install and validate

```bash
cd app
yarn install --frozen-lockfile
yarn validate
```

The validation sequence runs:

1. Reproducible branding verification
2. Jest component, host/theme, and service tests plus Python coordinator tests
3. ESLint and Stylelint
4. TypeScript compilation
5. Production webpack builds
6. `.tar.gz` package creation
7. Package-policy verification, including native hosts and PNG placement/dimensions

The verifier requires a single `content_hygiene/` top-level directory and
rejects dependencies, repository metadata, local Splunk configuration, tests,
coverage, source maps, demonstration markers, and macOS metadata.

## Workspace layout

```text
app/
  packages/overview/          React UI, data services, analysis, tests
  packages/content-hygiene/   Splunk resources and page entry points
  scripts/                    packaging, verification, checksums
schemas/                      normalized-record JSON Schemas
docs/                         public user, operator, and contributor docs
```

Generated `stage`, `types`, `dist`, coverage, test reports, and dependency
directories are intentionally ignored.

## Testing principles

- Test parser behavior with realistic but synthetic strings that contain no
  customer data.
- Add component tests for filters, drill-through, review state, empty states,
  warning states, and exports.
- Treat incomplete visibility as unknown or partial.
- Confirm that app review writes use the coordinator and insert only into
  `ch_review_revisions`, leaving legacy `ch_reviews` unchanged.
- Test the coordinator against a fake store that accepts duplicate keys, and
  verify real interprocess lock exclusion. KV key uniqueness is not an atomicity
  guarantee. Live tests must include concurrent creates/edits and role checks.
- Verify a production package before installing it.
- Use real Splunk data for integration and browser testing; production code
  must never use a demo-data fallback.

## Local Splunk testing

Build the app with `yarn package`, install the resulting archive through the
supported Splunk workflow, and run bounded then complete scans. Do not commit
local Splunk paths, credentials, generated KV data, support bundles, AppInspect
reports, or browser exports.
