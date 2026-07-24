# Splunk Content Hygiene

Splunk Content Hygiene is a customer-content read-only beta application for
inventorying Splunk content, reviewing evidence-backed cleanup candidates,
tracing dependencies, and identifying ownership gaps.

This beta does not delete, disable, reassign, archive, or rewrite customer
objects. Settings includes an explicit bounded metadata inventory that persists
normalized records and scan status in application-owned KV Store collections.
The complete scan paginates supported REST endpoints, extracts explicit SPL and
dashboard dependencies, and stores conservative findings. Every view reads the
latest live KV Store snapshot. Missing usage evidence is displayed as unknown;
the production app does not fall back to sample data.

Review stages, notes, and assignees are persisted only in the app-local
`ch_reviews` collection. Review records do not change the referenced Splunk
objects.

## Requirements

- Splunk Enterprise 10.x
- KV Store enabled on the search head
- An administrative user for installation and inventory scans

## Support

Developed by Leiter Consulting. Record beta issues and known limitations in the
project repository.
