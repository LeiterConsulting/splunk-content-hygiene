# Contributing

Thank you for helping improve Splunk Content Hygiene.

## Before opening a change

- Use GitHub Issues for reproducible bugs and narrowly scoped feature proposals.
- Do not include customer data, Splunk credentials, session tokens, private app
  content, or exported scan results.
- Use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities.
- Keep the beta customer-content read-only. A change that deletes, disables,
  reassigns, rewrites, or otherwise mutates Splunk customer content requires a
  separate design and explicit maintainer approval.
- Do not introduce demo or fallback data into production interfaces or logic.

## Local setup

```bash
cd app
yarn install --frozen-lockfile
yarn validate
```

Node.js 22 or newer and Yarn 1.22 are required. `yarn validate` runs the Jest
suite, linting, TypeScript compilation, production build, archive creation, and
archive-policy verification.

## Change expectations

- Add or update tests for behavior changes.
- Preserve scan provenance and evidence for new collectors or classifications.
- Treat missing permissions and incomplete catalogs as “unknown” or partial,
  never as proof that an object is safe to remove.
- Keep app-local review writes separate from customer content.
- Update public documentation and the changelog when behavior changes.
- Do not commit `.env`, Splunk installation details, build output, local KV
  exports, AppInspect reports, macOS metadata, or release archives.

Pull requests should explain the user-visible outcome, validation performed,
known limitations, and any effect on permissions, KV Store, or packaging.
