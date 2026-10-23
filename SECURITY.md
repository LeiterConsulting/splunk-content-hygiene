# Security policy

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue. Use
[GitHub's private vulnerability reporting flow](https://github.com/LeiterConsulting/splunk-content-hygiene/security/advisories/new)
and include:

- the affected version;
- the Splunk deployment type and version;
- reproduction steps with secrets and customer data removed;
- the security impact; and
- any suggested mitigation.

Please allow maintainers time to investigate before public disclosure.

## Supported versions

The `1.0.x` release line receives best-effort security updates. Validation covers
standalone POSIX Splunk Enterprise search heads, not Splunk Cloud, Windows review
coordination, or search-head clustering.

## Security boundaries

The app does not provide customer-content mutation endpoints. It reads the
Splunk REST resources available to the signed-in user and writes only to
application-owned KV Store collections. Review records may contain notes and
assignee names, so administrators should treat them as internal operational
data.

Shared caches and review notes are server-restricted to explicit hygiene roles
and administrators. Private objects are excluded from new inventory snapshots.
App/global metadata collected by an operator is visible to the assigned hygiene
audience; it is not re-filtered by each viewer's source-object permissions.
Grant these roles only to appropriately authorized users. Legacy derived cache
is retired after a verified post-upgrade scan; durable reviews are preserved.

The review endpoint requires the named hygiene role and review capability, uses
the caller's existing session/collection permissions, and receives no system
token. It accepts only review revisions and has one fixed app-local KV insert
destination. An interprocess POSIX lock serializes parent/origin checks and
inserts on a standalone search head; KV duplicate-key rejection alone is not
assumed atomic. The app never updates/deletes accepted revisions. Collection
write permissions can still be used through direct REST outside the coordinator;
such access is trusted, outside its concurrency contract, and not tamper-proof.
Legacy origins, sequence gaps, or duplicate revisions fail closed. Keep all app
editors on the matching release and back up both review collections together.

On-demand usage collection runs bounded searches against native Splunk
telemetry visible to the signed-in user. It persists aggregate activity counts,
timestamps, coverage, and provenance only; raw user SPL and actor lists are not
written to KV Store. Usage evidence and exports can still reveal sensitive
object names, applications, activity patterns, and ownership context and should
be protected accordingly.

Release packaging excludes credentials, local configuration, source maps,
tests, dependency trees, repository metadata, and macOS metadata. Never attach
an `.env` file, Splunk support bundle, raw KV export, or customer object content
to a public report.
