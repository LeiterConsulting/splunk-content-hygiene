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

`0.3.0-beta` is the current evaluation release and receives best-effort security
updates. It is not yet certified for production use or Splunk Cloud.

## Security boundaries

The beta does not provide customer-content mutation endpoints. It reads the
Splunk REST resources available to the signed-in user and writes only to
application-owned KV Store collections. Review records may contain notes and
assignee names, so administrators should treat them as internal operational
data.

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
