# Release process

## Prepare the source tree

1. Update the version in `VERSION`, package manifests, Splunk `app.conf`, and
   `CHANGELOG.md`.
2. Confirm that public documentation describes the current behavior and
   limitations.
3. Confirm that no `.env`, customer data, local Splunk state, generated output,
   or internal planning material is tracked.
4. Install the locked dependency tree with `yarn install --frozen-lockfile`.

## Build and verify

From `app/`:

```bash
yarn release:prepare
```

This runs the full test, lint, type-check, build, package, and package-policy
sequence, then updates the repository `SHA256SUMS`.

The archive is produced as
`app/dist/content_hygiene-<version>.tar.gz`. Packaging starts from a clean stage,
sets `COPYFILE_DISABLE=1`, removes `.DS_Store`, AppleDouble `._*`, and
`__MACOSX` entries recursively, and verifies their absence after compression.

Inspect the archive before signing off:

```bash
tar -tzf app/dist/content_hygiene-0.2.1-beta.tar.gz
shasum -a 256 app/dist/content_hygiene-0.2.1-beta.tar.gz
```

It must have exactly one top-level `content_hygiene/` directory and must not
contain `local/`, credentials, tests, dependencies, source maps, repository
metadata, or development files.

## Certification and smoke test

Run the current Splunk AppInspect CLI in pre-cert mode against the archive.
Record failures and warnings outside the public repository; release only with
zero errors and zero failures, and review every warning.

Install the exact inspected archive on a non-production target Splunk version.
Run a bounded scan, a complete scan, cross-view drill-through, filters, all
exports, and review save/reload/remove. Confirm that the final verification
state contains no temporary review records and that no customer object changed.

## Stage the GitHub release

1. Commit and push the validated source and checksum.
2. Create a draft prerelease tag named `v<version>` from the validated commit.
3. Attach the `.tar.gz` and `SHA256SUMS`.
4. Include compatibility, validation results, known limitations, and the exact
   SHA-256 in the release notes.
5. Review the draft before publishing it.

Release archives and local validation reports remain untracked; GitHub release
assets are the distribution channel.
