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

`0.2.0-beta` is the current evaluation release and receives best-effort security
updates. It is not yet certified for production use or Splunk Cloud.

## Security boundaries

The beta does not provide customer-content mutation endpoints. It reads the
Splunk REST resources available to the signed-in user and writes only to
application-owned KV Store collections. Review records may contain notes and
assignee names, so administrators should treat them as internal operational
data.

Release packaging excludes credentials, local configuration, source maps,
tests, dependency trees, repository metadata, and macOS metadata. Never attach
an `.env` file, Splunk support bundle, raw KV export, or customer object content
to a public report.
