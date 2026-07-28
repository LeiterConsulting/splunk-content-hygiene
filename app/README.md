# Splunk Content Hygiene application

This directory contains the production Splunk UI Toolkit workspace and package
resources for the `content_hygiene` Splunk app.

## Requirements

- Node.js 22 or newer
- Yarn 1.22

## Commands

- `yarn install` — install the locked development toolchain.
- `yarn start` — rebuild the Splunk app pages in watch mode.
- `yarn test` — run component tests.
- `yarn lint` — run TypeScript/React and styled-component linting.
- `yarn build` — compile the React pages into the app staging directory.
- `yarn package` — build `dist/content_hygiene-0.2.1-beta.tar.gz`.
- `yarn package:verify` — verify the release archive layout and exclusions.
- `yarn validate` — run tests, lint, build, package, and package verification.
- `yarn release:prepare` — validate and update the repository SHA-256 manifest.

Settings can run a bounded scan of 100 records per collector or a complete
paginated scan capped at 10,000 records per collector. Complete scans extract
supported SPL and dashboard dependencies, classify conservative health states,
and persist findings in the application-owned KV Store. Every view reads the
latest live snapshot. Usage timestamps remain unknown until measured telemetry
is implemented; there is no production sample-data fallback.

Dependency Explorer derives a read-only removal-impact simulation from the
complete, unfiltered relationship graph. It shows direct and transitive
dependents, likely failure modes, cross-app scope, evidence blockers,
post-removal orphan follow-ups, and an ordered change-control plan. It does not
perform removal or modify customer content.

This project is licensed under the MIT License.
