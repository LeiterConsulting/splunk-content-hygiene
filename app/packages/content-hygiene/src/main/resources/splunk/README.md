# Splunk Content Hygiene

Splunk Content Hygiene is a customer-content read-only application for
inventorying Splunk content, reviewing evidence-backed cleanup candidates,
tracing dependencies, and identifying ownership gaps.

This app does not delete, disable, reassign, archive, or rewrite customer
objects. Settings includes an explicit bounded metadata inventory that persists
normalized records and scan status in application-owned KV Store collections.
The complete scan paginates supported REST endpoints, extracts explicit SPL and
dashboard dependencies, native automatic lookup rules and bounded shared
event-type/tag/field metadata, and stores conservative findings. Every view reads the
latest live KV Store snapshot. On-demand usage scans can add attributable
saved-search and dashboard observations plus explicit source coverage from
native Splunk telemetry. Missing or partial evidence remains unknown; the
production app does not fall back to sample data.

Review stages, notes, and assignees are persisted only in the app-local
`ch_review_revisions` journal. Legacy `ch_reviews` decisions are preserved unchanged.
Back up both collections together. Concurrent edits reject a stale successor and
preserve its draft for comparison. Removing a Library entry archives its app-local
decision; restore and revision history remain available. This is application
history, not a tamper-proof audit against privileged direct KV changes.
Saves use an authenticated server-side coordinator on a standalone POSIX search
head. The coordinator uses the caller's existing permissions, receives no system
token, and has only fixed app-local review/policy journal insert destinations. SHC and Windows
coordinated writes are unsupported. KV key uniqueness alone is not
used as an atomic concurrency guarantee.
Derived usage evidence is persisted in
`ch_usage_evidence`; raw SPL and actor lists are not stored. Review records and
usage scans do not change the referenced Splunk objects.

Review evidence is tracked independently of saved decisions. Review Library
and Dependency Explorer expose Current, Needs re-review, and Cannot verify
states, explain observed changes, and export comparison evidence. Existing
decisions are not rewritten by scans. After upgrading, run a complete scan for
configuration/relationship fingerprints; explicitly capture or reaffirm review
evidence after investigating it. Four object-scoped coverage dimensions explain
returned configuration/ACL and declared outbound/potential inbound references.
Partial object coverage cannot establish Current,
and stale confirmations cannot qualify an object for change planning.

Version 1.2 adds native read-only `LOOKUP-*` rule inventory, configured
lookup-definition/file chains and potential caller links from positive exact
event selectors. “May apply”/“may use” paths are configuration possibilities,
not observed execution. That distinction propagates through required-content,
removal-impact and CSV/JSON reports. That original increment did not establish
pattern scopes, props precedence, renames, input fields, reusable invocation
context or other props families. Run a complete scan after upgrading. Saved decisions, notes,
assignees and evidence baselines are preserved; changed evidence needs explicit
investigation/reaffirmation. No customer objects or permissions are changed.

The 1.3 candidate adds shared Event Type and Tag Binding identities with bounded
literal include/exclude relationships, plus Field Extraction, Field Alias,
Calculated Field and Field Transform inventory. Ordered REPORT targets and
phase-qualified declared field inputs are potential, not execution evidence.
Field paths respect extraction -> alias -> parallel calculated fields -> lookup;
alias and EVAL chains are not invented. Existing object details and CSV/JSON show
compact names, scope, positions, provenance and limitations. Raw expressions,
regex, lookup rows and field values are not cached as lineage evidence.

Coverage policy shared-static-v3 reads earlier v1/v2 reviews without migrating or
reaffirming them. Run a new complete scan, inspect expanded evidence and explicitly
reaffirm only after investigation. Unknown enabled state, private/system
inheritance, pattern scopes, opaque PCRE, unsupported expressions, props precedence
and effective field availability remain unverified. Empty field-name lists are
not proof a declaration produces or consumes nothing. Build-specific runtime and
theme qualification is documented in the repository compatibility policy.

## Configuration contexts and app policies

Version 1.5 adds literal automatic-lookup OUTPUT/OUTPUTNEW/AS mappings and
possible configuration contexts in the existing field/relationship details.
Only configured names are retained; lookup rows and event values are never read.
Local/private source overrides withhold guessed exported bindings. Supported
multivalue calculated inputs are lexical facts, not evaluated expressions.

Review Library also provides explicit exact-app retention policies for current
and future shared content. Policies use the independent `ch_app_policy_revisions`
journal, not bulk edits to individual decisions. Operators preview and confirm
scope, then can disable, archive or reactivate it with retained history. Policy
retention is separate from activity, dependency completeness and impact scoring;
an individual Confirmed eligible stage does not override it. App identity or
configuration/ACL uncertainty blocks cleanup planning pending scope confirmation.
Back up policy history as well as both review collections. Direct privileged KV
changes are outside the coordinator's conflict-safety contract. Workflow actions,
navigation menus and full effective props evaluation remain outside coverage.

## Requirements

- Splunk Enterprise 10.2.5 or later on a standalone Linux x86-64 search head;
  representative browser qualification covers 10.2.5, 10.2.8 and 10.4.4
- KV Store enabled on the search head
- An administrative user for installation and inventory scans

Assign trusted users an explicit `content_hygiene_viewer`,
`content_hygiene_reviewer`, or `content_hygiene_operator` role. Administrators
retain access. Private objects are excluded from the shared inventory. After
upgrading from a pre-0.4 beta, run a complete scan to establish a verified
immutable baseline; existing review records are preserved.

Usage evidence is historical for decisions after seven days, after an inventory
change, or when the object was modified after the window. It never authorizes
removal. The workspace uses a standard Simple XML host with native Splunk
chrome and semantic modern-navigation icons, not a custom Mako template. It
does not require a server-wide template exception. Broader release, Cloud,
and search-head-cluster certification is not complete.

## Support

Developed by Leiter Consulting. Record issues and known limitations in the
project repository.
